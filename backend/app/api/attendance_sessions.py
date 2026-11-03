from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.schemas.attendance import (
    AttendanceSessionCreate,
    QRVerifyRequest,
    ManualAttendanceRequest,
)
from app.services.attendance_core import (
    build_qr_token,
    ensure_teacher_or_admin,
    get_teacher_for_user,
    haversine_m,
    log_audit,
    new_qr_secret,
    utcnow,
    verify_current_qr_token,
)


router = APIRouter(
    prefix="/attendance",
    tags=["Attendance Sessions"],
)


# ============================================================
# Helpers
# ============================================================

def _teacher_id(db: Session, payload: dict):
    """
    Get the teacher profile ID belonging to the logged-in user.

    Admin returns None because admin is not tied to a teacher
    profile for normal teacher attendance operations.
    """
    role = payload.get("role")

    if role == "admin":
        return None

    teacher = get_teacher_for_user(
        db,
        int(payload["sub"]),
    )

    if not teacher:
        raise HTTPException(
            status_code=404,
            detail="Teacher profile not found.",
        )

    return teacher["id"]


def _session(db: Session, session_id: int):
    """
    Load one attendance session.
    """
    row = db.execute(
        text(
            """
            SELECT *
            FROM attendance_sessions
            WHERE id = :id
            """
        ),
        {
            "id": session_id,
        },
    ).mappings().first()

    if not row:
        raise HTTPException(
            status_code=404,
            detail="Attendance session not found.",
        )

    return row


def _session_response(row):
    """Remove the server-side QR signing secret from API payloads."""
    payload = dict(row)
    payload.pop("qr_secret", None)
    return payload


def _require_teacher_session_access(
    db: Session,
    session_row,
    current_user: dict,
):
    """
    Make sure the current teacher owns the session.
    Admin is allowed.
    """
    role = current_user.get("role")

    if role == "admin":
        return

    if role != "teacher":
        raise HTTPException(
            status_code=403,
            detail="Teacher or admin access required.",
        )

    teacher_id = _teacher_id(
        db,
        current_user,
    )

    if session_row["teacher_id"] != teacher_id:
        raise HTTPException(
            status_code=403,
            detail="You cannot access another teacher's session.",
        )


def _get_student_for_user(
    db: Session,
    current_user: dict,
):
    """
    Find the active student profile associated with
    the authenticated user email.
    """
    student = db.execute(
        text(
            """
            SELECT
                s.id,
                s.student_code,
                s.name,
                s.email,
                s.roll_number
            FROM students s
            JOIN users u
                ON LOWER(u.email) = LOWER(s.email)
            WHERE u.id = :user_id
              AND s.is_active = TRUE
            LIMIT 1
            """
        ),
        {
            "user_id": int(current_user["sub"]),
        },
    ).mappings().first()

    if not student:
        raise HTTPException(
            status_code=404,
            detail="Active student profile not found.",
        )

    return student


def _queue_absence_notification(
    db: Session,
    session_id: int,
    student_id: int,
    student_name: str,
    session_title: str,
    subject_name: str | None,
    class_name: str | None,
):
    """
    Queue an absence notification.

    IMPORTANT:
    This does NOT pretend that SMS/email has been sent.

    It creates one in-app event marked queued. No SMS or email
    delivery is claimed by this application.
    """

    schema = inspect(db.get_bind())
    if not schema.has_table("notification_events") or not schema.has_table("student_guardians"):
        return False

    recipient_user = db.execute(
        text(
            """
            SELECT u.id
            FROM users u
            JOIN students s ON LOWER(s.email) = LOWER(u.email)
            WHERE s.id = :student_id
              AND s.is_active = TRUE
              AND u.is_active = TRUE
              AND LOWER(u.role) = 'student'
            LIMIT 1
            """
        ),
        {"student_id": student_id},
    ).scalar()
    if not recipient_user:
        return False

    guardian = db.execute(
        text(
            """
            SELECT
                guardian_name,
                guardian_mobile,
                alternate_mobile,
                notify_absence,
                notification_channel
            FROM student_guardians
            WHERE student_id = :student_id
            LIMIT 1
            """
        ),
        {
            "student_id": student_id,
        },
    ).mappings().first()

    # No guardian record.
    if not guardian:
        return False

    # Guardian explicitly disabled absence alerts.
    if not guardian["notify_absence"]:
        return False

    channel = (
        guardian["notification_channel"]
        or "email"
    ).strip().lower()

    mobile = (
        guardian["guardian_mobile"]
        or guardian["alternate_mobile"]
    )

    subject = (
        f"AttendX Absence Alert - {student_name}"
    )

    message = (
        f"Dear {guardian['guardian_name']},\n\n"
        f"AttendX attendance alert for {student_name}.\n\n"
        f"Attendance session: {session_title}\n"
        f"Subject: {subject_name or 'Not specified'}\n"
        f"Class: {class_name or 'Not specified'}\n\n"
        f"The student was marked ABSENT after the attendance "
        f"session was closed.\n\n"
        f"This notification is queued by AttendX."
    )

    # Guardian email is not captured by the existing guardian form.
    # Keep the configured channel and mobile only when that channel uses it.
    recipient = mobile if channel in {"sms", "whatsapp", "phone", "sms_email"} else None
    idempotency_key = f"attendance_absent:{session_id}:{student_id}"
    already_queued = db.execute(
        text("SELECT id FROM notification_events WHERE idempotency_key = :key"),
        {"key": idempotency_key},
    ).scalar()
    if already_queued:
        return False

    result = db.execute(
        text(
            """
            INSERT INTO notification_events
            (
                user_id,
                student_id,
                channel,
                recipient,
                event_type,
                title,
                message,
                delivery_status,
                idempotency_key
            )
            VALUES
            (
                :user_id,
                :student_id,
                :channel,
                :recipient,
                'attendance_absent',
                :title,
                :message,
                'queued',
                :idempotency_key
            )
            ON CONFLICT (idempotency_key) DO NOTHING
            RETURNING id
            """
        ),
        {
            "user_id": recipient_user,
            "student_id": student_id,
            "channel": channel,
            "recipient": recipient,
            "title": subject,
            "message": message,
            "idempotency_key": idempotency_key,
        },
    )
    return result.scalar_one_or_none() is not None


def _finalize_absent_students(
    db: Session,
    session_row,
):
    """
    Phase 1 core logic.

    When a teacher closes a session:

    1. Load active students assigned to this session's class.
    2. Check attendance_events for this session.
    3. Students without present/late attendance become ABSENT.
    4. Create real attendance_events records.
    5. Queue configured guardian absence notifications.
    """

    session_id = session_row["id"]

    students = db.execute(
        text(
            """
            SELECT
                s.id,
                s.student_code,
                s.name,
                s.email,
                s.roll_number
            FROM students s
            WHERE s.is_active = TRUE
              AND EXISTS (
                  SELECT 1
                  FROM student_class_assignments sca
                  WHERE sca.student_id = s.id
                    AND sca.class_id = :class_id
                    AND sca.is_active = TRUE
              )
            ORDER BY s.roll_number,
                s.name
            """
        ),
        {"class_id": session_row["class_id"]},
    ).mappings().all()

    if not students:
        return {
            "total_students": 0,
            "present": 0,
            "late": 0,
            "absent": 0,
            "notifications_queued": 0,
        }

    # Get subject/class names for notification message.
    session_info = db.execute(
        text(
            """
            SELECT
                s.title,
                sub.name AS subject_name,
                c.name AS class_name,
                c.section
            FROM attendance_sessions s
            LEFT JOIN subjects sub
                ON sub.id = s.subject_id
            LEFT JOIN classes c
                ON c.id = s.class_id
            WHERE s.id = :session_id
            """
        ),
        {
            "session_id": session_id,
        },
    ).mappings().first()

    session_title = (
        session_info["title"]
        if session_info
        else session_row["title"]
    )

    subject_name = (
        session_info["subject_name"]
        if session_info
        else None
    )

    class_name = None

    if session_info:
        class_name = session_info["class_name"]

        if session_info["section"]:
            class_name = (
                f"{class_name} - "
                f"{session_info['section']}"
            )

    present_count = 0
    late_count = 0
    absent_count = 0
    notification_count = 0

    for student in students:

        existing = db.execute(
            text(
                """
                SELECT
                    id,
                    status
                FROM attendance_events
                WHERE session_id = :session_id
                  AND student_id = :student_id
                LIMIT 1
                """
            ),
            {
                "session_id": session_id,
                "student_id": student["id"],
            },
        ).mappings().first()

        if existing:
            current_status = (
                existing["status"] or ""
            ).lower()

            if current_status == "present":
                present_count += 1

            elif current_status == "late":
                late_count += 1

            elif current_status == "absent":
                absent_count += 1

            continue

        # Student never checked in.
        db.execute(
            text(
                """
                INSERT INTO attendance_events
                (
                    session_id,
                    student_id,
                    method,
                    status,
                    verification_reason
                )
                VALUES
                (
                    :session_id,
                    :student_id,
                    'session_close',
                    'absent',
                    'Automatically marked absent when teacher closed the session.'
                )
                """
            ),
            {
                "session_id": session_id,
                "student_id": student["id"],
            },
        )

        absent_count += 1

        queued = _queue_absence_notification(
            db=db,
            session_id=session_id,
            student_id=student["id"],
            student_name=student["name"],
            session_title=session_title,
            subject_name=subject_name,
            class_name=class_name,
        )

        if queued:
            notification_count += 1

    return {
        "total_students": len(students),
        "present": present_count,
        "late": late_count,
        "absent": absent_count,
        "notifications_queued": notification_count,
    }


# ============================================================
# Create Attendance Session
# ============================================================

@router.post(
    "/sessions",
    status_code=status.HTTP_201_CREATED,
)
def create_session(
    body: AttendanceSessionCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Teacher starts a new attendance session.
    """

    if current_user.get("role") not in {
        "teacher",
        "admin",
    }:
        raise HTTPException(
            status_code=403,
            detail="Teacher or admin access required.",
        )

    teacher = ensure_teacher_or_admin(
        db,
        current_user,
    )

    teacher_id = (
        teacher["id"]
        if teacher
        else None
    )

    # Admin-created sessions currently still require
    # a real teacher profile.
    if teacher_id is None:

        teacher_id = int(
            current_user["sub"]
        )

        exists = db.execute(
            text(
                """
                SELECT id
                FROM teachers
                WHERE id = :id
                """
            ),
            {
                "id": teacher_id,
            },
        ).scalar()

        if not exists:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Admin-created sessions require "
                    "a teacher profile."
                ),
            )

    # Verify teacher assignment.
    valid_assignment = db.execute(
        text(
            """
            SELECT ta.id
            FROM teacher_assignments ta
            JOIN subjects sub ON sub.id = ta.subject_id
            JOIN classes c ON c.id = ta.class_id
            JOIN teachers t ON t.id = ta.teacher_id
            WHERE ta.teacher_id = :teacher_id
              AND ta.subject_id = :subject_id
              AND ta.class_id = :class_id
              AND ta.is_active = TRUE
              AND sub.is_active = TRUE
              AND c.is_active = TRUE
              AND t.is_active = TRUE
            LIMIT 1
            """
        ),
        {
            "teacher_id": teacher_id,
            "subject_id": body.subject_id,
            "class_id": body.class_id,
        },
    ).scalar()

    if not valid_assignment:
        raise HTTPException(
            status_code=400,
            detail=(
                "The teacher is not assigned to "
                "this subject and class."
            ),
        )

    now = utcnow()

    qr_expires = min(
        body.ends_at,
        now + timedelta(seconds=60),
    )

    result = db.execute(
        text(
            """
            INSERT INTO attendance_sessions
            (
                teacher_id,
                subject_id,
                class_id,
                title,
                starts_at,
                ends_at,
                status,
                qr_secret,
                qr_expires_at,
                latitude,
                longitude,
                radius_m
            )
            VALUES
            (
                :teacher_id,
                :subject_id,
                :class_id,
                :title,
                :starts_at,
                :ends_at,
                'active',
                :secret,
                :qr_expires,
                :lat,
                :lon,
                :radius
            )
            RETURNING id
            """
        ),
        {
            "teacher_id": teacher_id,
            "subject_id": body.subject_id,
            "class_id": body.class_id,
            "title": body.title.strip(),
            "starts_at": body.starts_at,
            "ends_at": body.ends_at,
            "secret": new_qr_secret(),
            "qr_expires": qr_expires,
            "lat": body.latitude,
            "lon": body.longitude,
            "radius": body.radius_m,
        },
    )

    session_id = result.scalar_one()

    log_audit(
        db,
        int(current_user["sub"]),
        "attendance_session.created",
        "attendance_session",
        session_id,
    )

    db.commit()

    # Return the persisted row after commit so the caller receives the
    # canonical database ID and timestamps.
    return _session_response(_session(db, session_id))


# ============================================================
# List Attendance Sessions
# ============================================================

@router.get("/sessions")
def list_sessions(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    role = current_user.get("role")

    if role == "teacher":

        teacher_id = _teacher_id(
            db,
            current_user,
        )

        rows = db.execute(
            text(
                """
                SELECT
                    s.*,
                    sub.name AS subject_name,
                    c.name AS class_name,
                    c.section
                FROM attendance_sessions s
                JOIN subjects sub
                    ON sub.id = s.subject_id
                JOIN classes c
                    ON c.id = s.class_id
                WHERE s.teacher_id = :teacher_id
                ORDER BY s.starts_at DESC
                LIMIT 100
                """
            ),
            {
                "teacher_id": teacher_id,
            },
        ).mappings().all()

    elif role == "admin":

        rows = db.execute(
            text(
                """
                SELECT
                    s.*,
                    sub.name AS subject_name,
                    c.name AS class_name,
                    c.section
                FROM attendance_sessions s
                JOIN subjects sub
                    ON sub.id = s.subject_id
                JOIN classes c
                    ON c.id = s.class_id
                ORDER BY s.starts_at DESC
                LIMIT 100
                """
            )
        ).mappings().all()

    else:
        raise HTTPException(
            status_code=403,
            detail="Teacher or admin access required.",
        )

    return [_session_response(row) for row in rows]


# ============================================================
# Close Session
# ============================================================

@router.post(
    "/sessions/{session_id}/close"
)
def close_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Close attendance session and automatically mark
    all active registered students who did not attend
    as ABSENT.
    """

    if current_user.get("role") not in {
        "teacher",
        "admin",
    }:
        raise HTTPException(
            status_code=403,
            detail="Teacher or admin access required.",
        )

    row = _session(
        db,
        session_id,
    )

    _require_teacher_session_access(
        db,
        row,
        current_user,
    )

    if row["status"] != "active":
        raise HTTPException(
            status_code=400,
            detail="This attendance session is already closed.",
        )

    # --------------------------------------------------------
    # PHASE 1:
    # Finalize attendance before closing the session.
    # --------------------------------------------------------

    summary = _finalize_absent_students(
        db,
        row,
    )

    # Now close session.
    db.execute(
        text(
            """
            UPDATE attendance_sessions
            SET
                status = 'closed',
                closed_at = :closed_at
            WHERE id = :id
            """
        ),
        {
            "id": session_id,
            "closed_at": utcnow(),
        },
    )

    log_audit(
        db,
        int(current_user["sub"]),
        "attendance_session.closed",
        "attendance_session",
        session_id,
        {
            "total_students": summary["total_students"],
            "present": summary["present"],
            "late": summary["late"],
            "absent": summary["absent"],
            "notifications_queued": summary[
                "notifications_queued"
            ],
        },
    )

    db.commit()

    return {
        "success": True,
        "message": (
            "Attendance session closed and "
            "attendance finalized."
        ),
        "session": _session_response(
            _session(db, session_id)
        ),
        "summary": summary,
    }


# ============================================================
# Refresh Dynamic QR
# ============================================================

@router.post(
    "/sessions/{session_id}/qr/refresh"
)
def refresh_qr(
    session_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = _session(
        db,
        session_id,
    )

    _require_teacher_session_access(
        db,
        row,
        current_user,
    )

    if row["status"] != "active":
        raise HTTPException(
            status_code=400,
            detail="This session is not active.",
        )

    expires = min(
        row["ends_at"],
        utcnow() + timedelta(seconds=60),
    )
    # Rotate the signing secret as well as the expiry. Expiry timestamps are
    # encoded as whole seconds, so two rapid refreshes can otherwise produce
    # identical tokens and leave the previous QR valid.
    qr_secret = new_qr_secret()

    db.execute(
        text(
            """
            UPDATE attendance_sessions
            SET qr_expires_at = :expires,
                qr_secret = :qr_secret
            WHERE id = :id
            """
        ),
        {
            "expires": expires,
            "qr_secret": qr_secret,
            "id": session_id,
        },
    )

    db.commit()

    token = build_qr_token(
        session_id,
        qr_secret,
        expires,
    )

    return {
        "session_id": session_id,
        "token": token,
        "expires_at": expires,
        "ttl_seconds": max(
            0,
            int(
                (
                    expires - utcnow()
                ).total_seconds()
            ),
        ),
    }


# ============================================================
# Get Dynamic QR
# ============================================================

@router.get(
    "/sessions/{session_id}/qr"
)
def get_qr(
    session_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = _session(
        db,
        session_id,
    )

    _require_teacher_session_access(
        db,
        row,
        current_user,
    )

    if row["status"] != "active":
        raise HTTPException(
            status_code=400,
            detail="This session is not active.",
        )

    expires = row["qr_expires_at"]

    if (
        not expires
        or expires <= utcnow()
    ):
        expires = min(
            row["ends_at"],
            utcnow() + timedelta(seconds=60),
        )

        db.execute(
            text(
                """
                UPDATE attendance_sessions
                SET qr_expires_at = :expires
                WHERE id = :id
                """
            ),
            {
                "expires": expires,
                "id": session_id,
            },
        )

        db.commit()

    token = build_qr_token(
        session_id,
        row["qr_secret"],
        expires,
    )

    return {
        "session_id": session_id,
        "token": token,
        "expires_at": expires,
        "ttl_seconds": max(
            0,
            int(
                (
                    expires - utcnow()
                ).total_seconds()
            ),
        ),
    }


# ============================================================
# Student QR Attendance
# ============================================================

@router.post(
    "/sessions/{session_id}/qr/verify"
)
def verify_qr(
    session_id: int,
    body: QRVerifyRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if current_user.get("role") != "student":
        raise HTTPException(
            status_code=403,
            detail="Only students can submit QR attendance.",
        )

    student = _get_student_for_user(
        db,
        current_user,
    )

    row = _session(
        db,
        session_id,
    )

    membership = db.execute(
        text(
            """
            SELECT id
            FROM student_class_assignments
            WHERE student_id = :student_id
              AND class_id = :class_id
              AND is_active = TRUE
            LIMIT 1
            """
        ),
        {"student_id": student["id"], "class_id": row["class_id"]},
    ).scalar()
    if not membership:
        raise HTTPException(status_code=403, detail="You are not assigned to this class.")

    valid_assignment = db.execute(
        text(
            """
            SELECT ta.id
            FROM teacher_assignments ta
            JOIN teachers t ON t.id = ta.teacher_id
            JOIN subjects sub ON sub.id = ta.subject_id
            JOIN classes c ON c.id = ta.class_id
            WHERE ta.teacher_id = :teacher_id
              AND ta.subject_id = :subject_id
              AND ta.class_id = :class_id
              AND ta.is_active = TRUE
              AND t.is_active = TRUE
              AND sub.is_active = TRUE
              AND c.is_active = TRUE
            LIMIT 1
            """
        ),
        {"teacher_id": row["teacher_id"], "subject_id": row["subject_id"], "class_id": row["class_id"]},
    ).scalar()
    if not valid_assignment:
        raise HTTPException(status_code=403, detail="The session's class or subject assignment is no longer active.")

    now = utcnow()

    if (
        row["status"] != "active"
        or now < row["starts_at"]
        or now > row["ends_at"]
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Attendance session is "
                "not currently open."
            ),
        )

    if not verify_current_qr_token(
        body.token,
        session_id,
        row["qr_secret"],
        row["qr_expires_at"],
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired QR code.",
        )

    distance = haversine_m(
        row["latitude"],
        row["longitude"],
        body.latitude,
        body.longitude,
    )

    if (
        row["latitude"] is not None
        and row["longitude"] is not None
    ):

        if distance is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Location permission is required "
                    "for this attendance session."
                ),
            )

        if distance > row["radius_m"]:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Outside attendance zone "
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
            "student_id": student["id"],
        },
    ).scalar()

    if duplicate:
        raise HTTPException(
            status_code=409,
            detail=(
                "Attendance has already been "
                "recorded for this session."
            ),
        )

    try:
        db.execute(
            text(
                """
                INSERT INTO attendance_events
                (session_id, student_id, method, status, latitude, longitude, distance_m, verification_reason, device_hash)
                VALUES (:session_id, :student_id, 'qr', 'present', :latitude, :longitude, :distance_m,
                        'QR + session verification', :device_hash)
                """
            ),
            {
                "session_id": session_id,
                "student_id": student["id"],
                "latitude": body.latitude,
                "longitude": body.longitude,
                "distance_m": distance,
                "device_hash": body.device_hash,
            },
        )
        log_audit(
            db,
            int(current_user["sub"]),
            "attendance.verified",
            "attendance_session",
            session_id,
            {"student_id": student["id"], "method": "qr", "distance_m": distance},
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Attendance has already been recorded for this session.") from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Unable to save attendance. Please try again.") from exc

    return {
        "success": True,
        "message": "Attendance recorded successfully.",
        "student_id": student["id"],
        "student_name": student["name"],
        "method": "qr",
        "status": "present",
        "distance_m": distance,
    }


# ============================================================
# Teacher Manual Attendance
# ============================================================

@router.post(
    "/sessions/{session_id}/manual"
)
def manual_attendance(
    session_id: int,
    body: ManualAttendanceRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if current_user.get("role") not in {
        "teacher",
        "admin",
    }:
        raise HTTPException(
            status_code=403,
            detail="Teacher or admin access required.",
        )

    row = _session(
        db,
        session_id,
    )

    _require_teacher_session_access(
        db,
        row,
        current_user,
    )

    student = db.execute(
        text(
            """
            SELECT
                id,
                name
            FROM students
            WHERE id = :id
              AND is_active = TRUE
            LIMIT 1
            """
        ),
        {
            "id": body.student_id,
        },
    ).mappings().first()

    if not student:
        raise HTTPException(
            status_code=404,
            detail="Active student not found.",
        )

    enrolled = db.execute(
        text(
            """
            SELECT id
            FROM student_class_assignments
            WHERE student_id = :student_id
              AND class_id = :class_id
              AND is_active = TRUE
            LIMIT 1
            """
        ),
        {"student_id": body.student_id, "class_id": row["class_id"]},
    ).scalar()
    if not enrolled:
        raise HTTPException(status_code=403, detail="Student is not assigned to this session's class.")

    exists = db.execute(
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
            "student_id": body.student_id,
        },
    ).scalar()

    if exists:

        db.execute(
            text(
                """
                UPDATE attendance_events
                SET
                    status = :status,
                    method = 'manual',
                    verification_reason = :remarks,
                    verified_at = NOW()
                WHERE id = :id
                """
            ),
            {
                "status": body.status,
                "remarks": body.remarks,
                "id": exists,
            },
        )

    else:

        db.execute(
            text(
                """
                INSERT INTO attendance_events
                (
                    session_id,
                    student_id,
                    method,
                    status,
                    verification_reason
                )
                VALUES
                (
                    :session_id,
                    :student_id,
                    'manual',
                    :status,
                    :remarks
                )
                """
            ),
            {
                "session_id": session_id,
                "student_id": body.student_id,
                "status": body.status,
                "remarks": body.remarks,
            },
        )

    log_audit(
        db,
        int(current_user["sub"]),
        "attendance.manual_update",
        "attendance_session",
        session_id,
        {
            "student_id": body.student_id,
            "status": body.status,
        },
    )

    db.commit()

    return {
        "success": True,
        "student_id": body.student_id,
        "student_name": student["name"],
        "status": body.status,
    }


# ============================================================
# Live Attendance
# ============================================================

@router.get(
    "/sessions/{session_id}/live"
)
def live_attendance(
    session_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if current_user.get("role") not in {
        "teacher",
        "admin",
    }:
        raise HTTPException(
            status_code=403,
            detail="Teacher or admin access required.",
        )

    row = _session(
        db,
        session_id,
    )

    _require_teacher_session_access(
        db,
        row,
        current_user,
    )

    rows = db.execute(
        text(
            """
            SELECT
                s.id AS student_id,
                s.student_code,
                s.name,
                s.roll_number,

                CASE
                    WHEN e.id IS NULL THEN 'pending'
                    ELSE e.status
                END AS status,

                e.id AS attendance_id,
                e.method,
                e.verified_at,
                e.distance_m

            FROM students s
            LEFT JOIN attendance_events e
                ON e.student_id = s.id
               AND e.session_id = :session_id
            WHERE s.is_active = TRUE
              AND EXISTS (
                  SELECT 1
                  FROM student_class_assignments sca
                  WHERE sca.student_id = s.id
                    AND sca.class_id = :class_id
                    AND sca.is_active = TRUE
              )

            ORDER BY
                s.roll_number,
                s.name
            """
        ),
        {
            "session_id": session_id,
            "class_id": row["class_id"],
        },
    ).mappings().all()

    return [
        dict(row)
        for row in rows
    ]


# ============================================================
# Student Attendance History
# ============================================================

@router.get(
    "/student/me"
)
def my_attendance(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if current_user.get("role") != "student":
        raise HTTPException(
            status_code=403,
            detail="Student access required.",
        )

    student = _get_student_for_user(
        db,
        current_user,
    )

    rows = db.execute(
        text(
            """
            SELECT
                e.id,
                e.status,
                e.method,
                e.verified_at,
                e.distance_m,

                s.title,
                s.starts_at,
                s.ends_at,

                sub.name AS subject_name,

                c.name AS class_name,
                c.section

            FROM attendance_events e

            JOIN attendance_sessions s
                ON s.id = e.session_id

            JOIN subjects sub
                ON sub.id = s.subject_id

            JOIN classes c
                ON c.id = s.class_id

            WHERE e.student_id = :student_id

            ORDER BY
                e.verified_at DESC

            LIMIT 100
            """
        ),
        {
            "student_id": student["id"],
        },
    ).mappings().all()

    return [
        dict(row)
        for row in rows
    ]
