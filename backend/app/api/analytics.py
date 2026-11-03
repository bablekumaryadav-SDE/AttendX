from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.services.attendance_core import get_teacher_for_user


router = APIRouter(
    prefix="/analytics",
    tags=["Analytics"],
)


def _teacher_id(db, user_id):
    return db.execute(
        text(
            """
            SELECT t.id
            FROM teachers t
            JOIN users u
              ON LOWER(u.email) = LOWER(t.email)
            WHERE u.id = :uid
              AND u.is_active = TRUE
              AND t.is_active = TRUE
            """
        ),
        {"uid": user_id},
    ).scalar()


@router.get("/overview")
def overview(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    role = current_user.get("role")

    if role not in {
        "admin",
        "teacher",
        "student",
    }:
        raise HTTPException(
            status_code=403,
            detail="Access denied.",
        )

    params = {}
    session_filter = ""
    event_filter = ""

    if role == "teacher":
        teacher_id = _teacher_id(
            db,
            int(current_user["sub"]),
        )

        if not teacher_id:
            raise HTTPException(
                status_code=404,
                detail="Teacher profile not found.",
            )

        params["teacher_id"] = teacher_id

        session_filter = (
            " AND s.teacher_id = :teacher_id"
        )

        event_filter = (
            " AND s.teacher_id = :teacher_id"
        )

    elif role == "student":
        student_id = db.execute(
            text(
                """
                SELECT id
                FROM students
                WHERE email = (
                    SELECT email
                    FROM users
                    WHERE id = :uid
                )
                """
            ),
            {
                "uid": int(current_user["sub"]),
            },
        ).scalar()

        if not student_id:
            raise HTTPException(
                status_code=404,
                detail="Student profile not found.",
            )

        params["student_id"] = student_id

        event_filter = (
            " AND e.student_id = :student_id"
        )

    if role == "admin":
        total_students = db.execute(
            text("SELECT COUNT(*) FROM students WHERE is_active = TRUE")
        ).scalar() or 0
    elif role == "teacher":
        total_students = db.execute(
            text(
                """
                SELECT COUNT(DISTINCT sca.student_id)
                FROM student_class_assignments sca
                JOIN students st ON st.id = sca.student_id AND st.is_active = TRUE
                JOIN teacher_assignments ta ON ta.class_id = sca.class_id AND ta.is_active = TRUE
                JOIN classes c ON c.id = ta.class_id AND c.is_active = TRUE
                JOIN subjects sub ON sub.id = ta.subject_id AND sub.is_active = TRUE
                WHERE sca.is_active = TRUE
                  AND ta.teacher_id = :teacher_id
                """
            ),
            params,
        ).scalar() or 0
    else:
        total_students = 1

    if role == "student":
        session_filter = " AND EXISTS (SELECT 1 FROM student_class_assignments sca WHERE sca.student_id = :student_id AND sca.class_id = s.class_id AND sca.is_active = TRUE)"

    sessions = db.execute(
        text(
            f"""
            SELECT COUNT(*)
            FROM attendance_sessions s
            WHERE 1=1
            {session_filter}
            """
        ),
        params,
    ).scalar() or 0

    present = db.execute(
        text(
            f"""
            SELECT COUNT(*)
            FROM attendance_events e
            JOIN attendance_sessions s
              ON s.id = e.session_id
            WHERE e.status IN ('present', 'late')
            {event_filter}
            """
        ),
        params,
    ).scalar() or 0

    absent = db.execute(
        text(
            f"""
            SELECT COUNT(*)
            FROM attendance_events e
            JOIN attendance_sessions s
              ON s.id = e.session_id
            WHERE e.status = 'absent'
            {event_filter}
            """
        ),
        params,
    ).scalar() or 0

    total_events = present + absent

    percentage = (
        round(
            (present / total_events) * 100,
            2,
        )
        if total_events
        else 0
    )

    return {
        "role": role,
        "active_students": total_students,
        "sessions": sessions,
        "present_events": present,
        "absent_events": absent,
        "attendance_percentage": percentage,
    }


@router.get("/records")
def attendance_report_records(
    date_from: date | None = None,
    date_to: date | None = None,
    status: str | None = None,
    class_id: int | None = None,
    subject_id: int | None = None,
    student_id: int | None = None,
    teacher_id: int | None = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Return session-based attendance records scoped to the current role."""
    role = current_user.get("role")
    if role not in {"admin", "teacher", "student"}:
        raise HTTPException(status_code=403, detail="Access denied.")
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="date_from must not be after date_to.")
    normalized_status = status.strip().lower() if status else None
    if normalized_status and normalized_status not in {"present", "absent", "late"}:
        raise HTTPException(status_code=422, detail="status must be present, absent, or late.")

    clauses = []
    params = {}
    if role == "teacher":
        teacher = get_teacher_for_user(db, int(current_user["sub"]))
        clauses.append("s.teacher_id = :teacher_id")
        params["teacher_id"] = teacher["id"]
    elif role == "student":
        student_id = db.execute(
            text(
                """
                SELECT st.id
                FROM students st JOIN users u ON LOWER(u.email) = LOWER(st.email)
                WHERE u.id = :user_id AND st.is_active = TRUE
                """
            ),
            {"user_id": int(current_user["sub"])},
        ).scalar()
        if not student_id:
            raise HTTPException(status_code=404, detail="Active student profile not found.")
        clauses.append("e.student_id = :student_id")
        params["student_id"] = student_id

    if date_from:
        clauses.append("DATE(e.verified_at) >= :date_start")
        params["date_start"] = date_from
    if date_to:
        clauses.append("DATE(e.verified_at) <= :date_end")
        params["date_end"] = date_to
    if normalized_status:
        clauses.append("LOWER(e.status) = :status")
        params["status"] = normalized_status
    for column, value, parameter in (
        ("s.class_id", class_id, "class_id"),
        ("s.subject_id", subject_id, "subject_id"),
        ("e.student_id", student_id, "student_id"),
        ("s.teacher_id", teacher_id, "teacher_id"),
    ):
        if value is not None:
            clauses.append(f"{column} = :{parameter}")
            params[parameter] = value

    where = "WHERE " + " AND ".join(clauses) if clauses else ""
    rows = db.execute(
        text(
            f"""
            SELECT e.id, e.session_id, e.student_id, st.name AS student_name,
                   st.roll_number, s.teacher_id, t.name AS teacher_name,
                   s.subject_id, sub.name AS subject_name, s.class_id,
                   c.name AS class_name, c.section, e.status, e.method,
                   e.verified_at AS date, e.verification_reason AS remarks
            FROM attendance_events e
            JOIN attendance_sessions s ON s.id = e.session_id
            JOIN students st ON st.id = e.student_id
            JOIN teachers t ON t.id = s.teacher_id
            JOIN subjects sub ON sub.id = s.subject_id
            JOIN classes c ON c.id = s.class_id
            {where}
            ORDER BY e.verified_at DESC, e.id DESC
            LIMIT 5000
            """
        ),
        params,
    ).mappings().all()
    return [dict(row) for row in rows]


@router.get("/low-attendance")
def low_attendance(
    threshold: float = 75,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if current_user.get("role") not in {
        "admin",
        "teacher",
    }:
        raise HTTPException(
            status_code=403,
            detail="Admin or teacher access required.",
        )

    teacher_filter = ""
    params = {
        "threshold": threshold,
    }

    if current_user.get("role") == "teacher":
        teacher_id = _teacher_id(
            db,
            int(current_user["sub"]),
        )

        if not teacher_id:
            raise HTTPException(
                status_code=404,
                detail="Teacher profile not found.",
            )

        params["teacher_id"] = teacher_id

        teacher_filter = (
            " AND s.teacher_id = :teacher_id"
        )

    rows = db.execute(
        text(
            f"""
            SELECT
                st.id,
                st.student_code,
                st.name,
                st.roll_number,

                COUNT(e.id)
                    FILTER (
                        WHERE e.status IN ('present', 'late')
                    ) AS present_count,

                COUNT(e.id) AS total_count,

                ROUND(
                    CASE
                        WHEN COUNT(e.id) = 0
                        THEN 0
                        ELSE
                            100.0 *
                            COUNT(e.id)
                            FILTER (
                                WHERE e.status IN ('present', 'late')
                            )
                            /
                            COUNT(e.id)
                    END,
                    2
                ) AS attendance_percentage

            FROM students st

            JOIN attendance_events e
              ON e.student_id = st.id

            JOIN attendance_sessions s
              ON s.id = e.session_id

            WHERE st.is_active = TRUE

            {teacher_filter}

            GROUP BY
                st.id

            HAVING
                CASE
                    WHEN COUNT(e.id) = 0
                    THEN 0
                    ELSE
                        100.0 *
                        COUNT(e.id)
                        FILTER (
                            WHERE e.status IN ('present', 'late')
                        )
                        /
                        COUNT(e.id)
                END < :threshold

            ORDER BY
                attendance_percentage ASC,
                st.name ASC
            """
        ),
        params,
    ).mappings().all()

    return [
        dict(row)
        for row in rows
    ]
