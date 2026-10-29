from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user


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
              ON u.email = t.email
            WHERE u.id = :uid
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

    total_students = db.execute(
        text(
            """
            SELECT COUNT(*)
            FROM students
            WHERE is_active = TRUE
            """
        )
    ).scalar() or 0

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