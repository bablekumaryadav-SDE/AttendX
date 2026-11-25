from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.schemas.attendance import StudentQrAttendanceRequest
from app.services.attendance_core import (
    haversine_m,
    log_audit,
    utcnow,
    verify_qr_token,
)

router = APIRouter(
    prefix="/attendance/student",
    tags=["Student Attendance"],
)


def _get_student_id(db: Session, user_id: int):
    student_id = db.execute(
        text(
            """
            SELECT s.id
            FROM students s
            JOIN users u ON u.email = s.email
            WHERE u.id = :user_id
              AND s.is_active = TRUE
            """
        ),
        {"user_id": user_id},
    ).scalar()

    if not student_id:
        raise HTTPException(
            status_code=404,
            detail="Active student profile not found.",
        )

    return int(student_id)


def _get_session(db: Session, session_id: int):
    row = db.execute(
        text(
            """
            SELECT
                s.id,
                s.title,
                s.subject_id,
                s.class_id,
                s.teacher_id,
                s.starts_at,
                s.ends_at,
                s.status,
                s.latitude,
                s.longitude,
                s.radius_m,
                s.qr_secret,
                s.qr_expires_at,
                sub.name AS subject_name,
                sub.code AS subject_code,
                c.name AS class_name,
                c.section
            FROM attendance_sessions s
            JOIN subjects sub
                ON sub.id = s.subject_id
            JOIN classes c
                ON c.id = s.class_id
            WHERE s.id = :session_id
            """
        ),
        {"session_id": session_id},
    ).mappings().first()

    if not row:
        raise HTTPException(
            status_code=404,
            detail="Attendance session not found.",
        )

    return row


@router.get("/active-sessions")
def active_sessions(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if current_user.get("role") != "student":
        raise HTTPException(
            status_code=403,
            detail="Student access required.",
        )

    student_id = _get_student_id(
        db,
        int(current_user["sub"]),
    )

    now = utcnow()

    rows = db.execute(
        text(
            """
            SELECT
                s.id,
                s.title,
                s.subject_id,
                s.class_id,
                s.teacher_id,
                s.starts_at,
                s.ends_at,
                s.status,
                s.latitude,
                s.longitude,
                s.radius_m,
                sub.name AS subject_name,
                sub.code AS subject_code,
                c.name AS class_name,
                c.section,
                t.name AS teacher_name,
                CASE
                    WHEN e.id IS NOT NULL THEN TRUE
                    ELSE FALSE
                END AS already_attended
            FROM attendance_sessions s
            JOIN subjects sub
                ON sub.id = s.subject_id
            JOIN classes c
                ON c.id = s.class_id
            LEFT JOIN teachers t
                ON t.id = s.teacher_id
            LEFT JOIN attendance_events e
                ON e.session_id = s.id
               AND e.student_id = :student_id
            WHERE s.status = 'active'
              AND s.starts_at <= :now
              AND s.ends_at >= :now
            ORDER BY s.starts_at ASC
            """
        ),
        {
            "student_id": student_id,
            "now": now,
        },
    ).mappings().all()

    return [dict(row) for row in rows]


@router.post("/sessions/{session_id}/qr")
def submit_qr_attendance(
    session_id: int,
    body: StudentQrAttendanceRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if current_user.get("role") != "student":
        raise HTTPException(
            status_code=403,
            detail="Only students can submit attendance.",
        )

    student_id = _get_student_id(
        db,
        int(current_user["sub"]),
    )

    session = _get_session(
        db,
        session_id,
    )

    now = utcnow()

    if session["status"] != "active":
        raise HTTPException(
            status_code=400,
            detail="This attendance session is closed.",
        )

    if now < session["starts_at"] or now > session["ends_at"]:
        raise HTTPException(
            status_code=400,
            detail="Attendance session is not currently open.",
        )

    if not verify_qr_token(
        body.token.strip(),
        session_id,
        session["qr_secret"],
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired QR code.",
        )

    if session["qr_expires_at"] is not None:
        if session["qr_expires_at"] < now:
            raise HTTPException(
                status_code=400,
                detail="QR code has expired. Ask the teacher to refresh it.",
            )

    distance = haversine_m(
        session["latitude"],
        session["longitude"],
        body.latitude,
        body.longitude,
    )

    if (
        session["latitude"] is not None
        and session["longitude"] is not None
    ):
        if distance is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Location permission is required "
                    "for this attendance session."
                ),
            )

        if distance > float(session["radius_m"]):
            raise HTTPException(
                status_code=403,
                detail=(
                    f"You are outside the attendance zone "
                    f"({round(distance)} m away)."
                ),
            )

    duplicate = db.execute(
        text(
            """
            SELECT id
            FROM attendance_events
            WHERE session_id = :session_id
              AND student_id = :student_id
            LIMIT 1
            """
        ),
        {
            "session_id": session_id,
            "student_id": student_id,
        },
    ).scalar()

    if duplicate:
        raise HTTPException(
            status_code=409,
            detail="Attendance has already been recorded for this session.",
        )

    db.execute(
        text(
            """
            INSERT INTO attendance_events (
                session_id,
                student_id,
                method,
                status,
                latitude,
                longitude,
                distance_m,
                verification_reason
            )
            VALUES (
                :session_id,
                :student_id,
                'qr',
                'present',
                :latitude,
                :longitude,
                :distance_m,
                :verification_reason
            )
            """
        ),
        {
            "session_id": session_id,
            "student_id": student_id,
            "latitude": body.latitude,
            "longitude": body.longitude,
            "distance_m": distance,
            "verification_reason": (
                "Dynamic QR + session validation + geo-fence"
            ),
        },
    )

    log_audit(
        db,
        int(current_user["sub"]),
        "attendance.student_qr_verified",
        "attendance_session",
        session_id,
        {
            "student_id": student_id,
            "method": "qr",
            "distance_m": distance,
        },
    )

    db.commit()

    return {
        "success": True,
        "message": "Attendance recorded successfully.",
        "session_id": session_id,
        "student_id": student_id,
        "method": "qr",
        "status": "present",
        "distance_m": distance,
    }