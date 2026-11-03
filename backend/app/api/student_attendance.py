from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import FaceEmbedding, Student, StudentClassAssignment
from app.schemas.attendance import StudentQrAttendanceRequest
from app.services.attendance_core import (
    haversine_m,
    log_audit,
    utcnow,
    verify_current_qr_token,
)
from app.services.face_engine import DEFAULT_THRESHOLD, decode_embedding, embedding_from_image, is_valid_embedding

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
            JOIN users u ON LOWER(u.email) = LOWER(s.email)
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


def _ensure_student_class_membership(db: Session, student_id: int, class_id: int):
    membership = db.query(StudentClassAssignment.id).filter(
        StudentClassAssignment.student_id == student_id,
        StudentClassAssignment.class_id == class_id,
        StudentClassAssignment.is_active.is_(True),
    ).first()
    if membership is None:
        raise HTTPException(status_code=403, detail="You are not assigned to this class.")


def _validate_session_assignment(db: Session, session):
    valid = db.execute(
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
        {
            "teacher_id": session["teacher_id"],
            "subject_id": session["subject_id"],
            "class_id": session["class_id"],
        },
    ).scalar()
    if not valid:
        raise HTTPException(status_code=403, detail="The session's class or subject assignment is no longer active.")


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

    has_active_enrollment = db.query(StudentClassAssignment.id).filter(
        StudentClassAssignment.student_id == student_id,
        StudentClassAssignment.is_active.is_(True),
    ).first()
    if has_active_enrollment is None:
        raise HTTPException(
            status_code=409,
            detail=(
                "No active class enrollment is linked to your student profile. "
                "Ask an administrator to assign your class before attending."
            ),
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
            JOIN student_class_assignments sca
                ON sca.class_id = s.class_id
               AND sca.student_id = :student_id
               AND sca.is_active = TRUE
            JOIN teacher_assignments ta
                ON ta.teacher_id = s.teacher_id
               AND ta.subject_id = s.subject_id
               AND ta.class_id = s.class_id
               AND ta.is_active = TRUE
            LEFT JOIN teachers t
                ON t.id = s.teacher_id
            LEFT JOIN attendance_events e
                ON e.session_id = s.id
               AND e.student_id = :student_id
            WHERE s.status = 'active'
              AND sub.is_active = TRUE
              AND c.is_active = TRUE
              AND t.is_active = TRUE
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

    _ensure_student_class_membership(db, student_id, session["class_id"])
    _validate_session_assignment(db, session)

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

    if not verify_current_qr_token(
        body.token.strip(),
        session_id,
        session["qr_secret"],
        session["qr_expires_at"],
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

    try:
        db.execute(
            text(
                """
                INSERT INTO attendance_events (
                    session_id, student_id, method, status, latitude, longitude,
                    distance_m, verification_reason
                ) VALUES (
                    :session_id, :student_id, 'qr', 'present', :latitude, :longitude,
                    :distance_m, :verification_reason
                )
                """
            ),
            {
                "session_id": session_id,
                "student_id": student_id,
                "latitude": body.latitude,
                "longitude": body.longitude,
                "distance_m": distance,
                "verification_reason": "Dynamic QR + session validation + geo-fence",
            },
        )
        log_audit(
            db,
            int(current_user["sub"]),
            "attendance.student_qr_verified",
            "attendance_session",
            session_id,
            {"student_id": student_id, "method": "qr", "distance_m": distance},
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
        "session_id": session_id,
        "student_id": student_id,
        "method": "qr",
        "status": "present",
        "distance_m": distance,
    }


@router.post("/sessions/{session_id}/face")
async def submit_face_attendance(
    session_id: int,
    file: UploadFile = File(...),
    latitude: float | None = Form(default=None),
    longitude: float | None = Form(default=None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if current_user.get("role") != "student":
        raise HTTPException(status_code=403, detail="Only students can submit face attendance.")

    student_id = _get_student_id(db, int(current_user["sub"]))
    session = _get_session(db, session_id)
    _ensure_student_class_membership(db, student_id, session["class_id"])
    _validate_session_assignment(db, session)

    now = utcnow()
    if session["status"] != "active" or now < session["starts_at"] or now > session["ends_at"]:
        raise HTTPException(status_code=400, detail="This attendance session is not currently active.")

    if file.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="Capture a JPG, PNG, or WEBP image.")
    image_data = await file.read(5 * 1024 * 1024 + 1)
    if not image_data or len(image_data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="The captured face image is empty or exceeds 5 MB.")

    registration = (
        db.query(FaceEmbedding.embedding_json)
        .join(Student, FaceEmbedding.student_id == Student.id)
        .filter(
            FaceEmbedding.student_id == student_id,
            FaceEmbedding.status == "registered",
            Student.is_active.is_(True),
        )
        .first()
    )
    reference = (
        decode_embedding(registration[0])
        if registration and is_valid_embedding(registration[0])
        else None
    )
    if reference is None:
        raise HTTPException(status_code=403, detail="No valid face registration is available for this account.")

    try:
        probe = decode_embedding(embedding_from_image(image_data))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (RuntimeError, AttributeError) as exc:
        raise HTTPException(status_code=503, detail="Face recognition models are unavailable.") from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail="The captured image could not be processed.") from exc

    if probe is None:
        raise HTTPException(status_code=422, detail="A valid face embedding could not be generated.")
    confidence = float(probe @ reference)
    if confidence < DEFAULT_THRESHOLD:
        raise HTTPException(status_code=403, detail="Face did not match the registered student. Please retry.")

    distance = haversine_m(session["latitude"], session["longitude"], latitude, longitude)
    if session["latitude"] is not None and session["longitude"] is not None:
        if distance is None:
            raise HTTPException(status_code=400, detail="Location permission is required for this attendance session.")
        if distance > float(session["radius_m"]):
            raise HTTPException(status_code=403, detail=f"You are outside the attendance zone ({round(distance)} m away).")

    try:
        db.execute(
            text(
                """
                INSERT INTO attendance_events (
                    session_id, student_id, method, status, confidence,
                    latitude, longitude, distance_m, verification_reason
                ) VALUES (
                    :session_id, :student_id, 'face', 'present', :confidence,
                    :latitude, :longitude, :distance_m, 'SFace match + active session + class and geo-fence validation'
                )
                """
            ),
            {
                "session_id": session_id,
                "student_id": student_id,
                "confidence": confidence,
                "latitude": latitude,
                "longitude": longitude,
                "distance_m": distance,
            },
        )
        log_audit(
            db,
            int(current_user["sub"]),
            "attendance.student_face_verified",
            "attendance_session",
            session_id,
            {"student_id": student_id, "method": "face", "distance_m": distance},
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
        "message": "Face recognized successfully. Your attendance has been marked.",
        "session_id": session_id,
        "student_id": student_id,
        "method": "face",
        "status": "present",
        "distance_m": distance,
    }
