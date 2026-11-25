"""Tenant-authorized face enrollment and status APIs.

These endpoints expose neither biometric images nor embeddings. Face attendance
and session management remain separate, fail-closed operations.
"""

import hashlib
import json
import logging
from typing import Optional

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import and_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.database_diagnostics import safe_database_diagnostics
from app.dependencies import get_current_user
from app.models import (
    AttendanceAuditLog, AttendanceEvent, AttendanceSession, Class, College, FaceEmbedding,
    Student, StudentAccountLink, StudentClassAssignment, Subject, Teacher, TeacherAssignment, User,
)
from app.schemas.attendance_gis import StudentQrAttendanceGISRequest
from app.services.attendance_core import haversine_m, utcnow, validate_geofence_fix, verify_current_qr_token
from app.services.face_engine import DEFAULT_THRESHOLD, MAX_IMAGE_BYTES, decode_embedding, embedding_from_image, is_valid_embedding
from app.tenant_context import resolve_tenant_context
from app.tenant_relationship_history import active_relationship_at, has_effective_date_columns


router = APIRouter(prefix="/tenant/face", tags=["Tenant Face Registration"])
_STUDENT_ROLES = frozenset({"student"})
_ADMIN_ROLES = frozenset({"college_admin"})
_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
logger = logging.getLogger(__name__)


def _college_gps_schema_failure_detail(exc):
    error_type, sqlstate, constraint, schema_name, relation_name, column_name, failure_class = safe_database_diagnostics(exc)
    logger.error(
        "tenant_face_database_unavailable failure_class=%s error_type=%s sqlstate=%s constraint=%s schema=%s relation=%s column=%s stage=%s",
        failure_class,
        error_type,
        sqlstate or "unknown",
        constraint or "unknown",
        schema_name or "unknown",
        relation_name or "unknown",
        column_name or "unknown",
        "college_gps_accuracy_read",
    )
    if failure_class == "schema_missing_column" and column_name == "gps_accuracy_limit_m":
        return "College GPS settings schema is unavailable. Apply the reviewed GPS settings migration after approval."
    if failure_class in {"schema_missing_table", "schema_missing_column", "schema_missing_schema"}:
        return "Required College settings schema is unavailable. Contact the administrator."
    if failure_class == "database_connection_failure":
        return "The database is temporarily unavailable. Please retry shortly."
    return "College GPS accuracy settings are unavailable. Contact the administrator."


def _context(db, user, college_id, allowed_roles):
    try:
        return resolve_tenant_context(
            db, user, allowed_roles=allowed_roles, requested_college_id=college_id
        )
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="College face services are unavailable.") from exc


def _face_status(db, student):
    try:
        registration = db.query(FaceEmbedding).filter(FaceEmbedding.student_id == student.id).one_or_none()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="College face services are unavailable.") from exc
    ready = bool(
        registration
        and registration.status == "registered"
        and is_valid_embedding(registration.embedding_json)
    )
    return {
        "student_id": student.id,
        "face_registered": ready,
        "status": "registered" if ready else "not_registered",
        "registered_at": registration.registered_at if ready else None,
    }


def _student_for_admin(db, student_id, college_id, *, require_active=True):
    try:
        query = db.query(Student).filter(
            Student.id == student_id,
            Student.college_id == college_id,
            Student.college_id.is_not(None),
        )
        if require_active:
            query = query.filter(Student.is_active.is_(True))
        student = query.one_or_none()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="College face services are unavailable.") from exc
    if student is None:
        raise HTTPException(status_code=404, detail="Record not found.")
    return student


def _student_for_self(db, context):
    try:
        account = db.query(User).filter(User.id == context.user_id, User.is_active.is_(True)).one_or_none()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="College face services are unavailable.") from exc
    if account is None:
        raise HTTPException(status_code=401, detail="Active account required.")
    try:
        link = db.query(StudentAccountLink).filter(
            StudentAccountLink.user_id == context.user_id,
            StudentAccountLink.college_id == context.college_id,
            StudentAccountLink.link_status == "active",
        ).one_or_none()
        if link is None:
            raise HTTPException(status_code=403, detail="An active, verified Student profile link is required in this College.")
        student = db.query(Student).filter(
            Student.id == link.student_id,
            Student.college_id == context.college_id,
            Student.college_id.is_not(None),
            Student.is_active.is_(True),
        ).one_or_none()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="College face services are unavailable.") from exc
    if student is None:
        raise HTTPException(status_code=404, detail="Active Student profile not found.")
    return student


def _eligible_student_context(db, user, college_id):
    context = _context(db, user, college_id, _STUDENT_ROLES)
    student = _student_for_self(db, context)
    return context, student


def _student_sessions_query(db, context, student):
    now = utcnow()
    rows = (
        db.query(AttendanceSession, Class, Subject, Teacher)
        .join(Class, and_(Class.id == AttendanceSession.class_id, Class.college_id == context.college_id))
        .join(Subject, and_(Subject.id == AttendanceSession.subject_id, Subject.college_id == context.college_id))
        .join(Teacher, and_(Teacher.id == AttendanceSession.teacher_id, Teacher.college_id == context.college_id))
        .join(StudentClassAssignment, and_(
            StudentClassAssignment.student_id == student.id,
            StudentClassAssignment.class_id == AttendanceSession.class_id,
            StudentClassAssignment.college_id == context.college_id,
            active_relationship_at(db, StudentClassAssignment, utcnow()),
        ))
        .join(TeacherAssignment, and_(
            TeacherAssignment.teacher_id == AttendanceSession.teacher_id,
            TeacherAssignment.subject_id == AttendanceSession.subject_id,
            TeacherAssignment.class_id == AttendanceSession.class_id,
            TeacherAssignment.college_id == context.college_id,
            active_relationship_at(db, TeacherAssignment, utcnow()),
        ))
        .filter(
            AttendanceSession.college_id == context.college_id,
            AttendanceSession.status == "active",
            AttendanceSession.starts_at <= now,
            AttendanceSession.ends_at >= now,
            Class.is_active.is_(True), Subject.is_active.is_(True), Teacher.is_active.is_(True),
        )
        .all()
    )
    result = []
    for session, class_row, subject, teacher in rows:
        attended = db.query(AttendanceEvent.id).filter(
            AttendanceEvent.college_id == context.college_id,
            AttendanceEvent.session_id == session.id,
            AttendanceEvent.student_id == student.id,
        ).first() is not None
        result.append({
            "id": session.id, "title": session.title, "subject_id": subject.id,
            "subject_name": subject.name, "class_id": class_row.id,
            "class_name": class_row.name, "section": class_row.section,
            "teacher_id": teacher.id, "teacher_name": teacher.name,
            "starts_at": session.starts_at, "ends_at": session.ends_at,
            "status": session.status, "latitude": session.latitude,
            "longitude": session.longitude, "radius_m": session.radius_m,
            "already_attended": attended,
        })
    return result


def _check_student_session(db, context, student, session_id):
    session = db.query(AttendanceSession).filter(
        AttendanceSession.id == session_id,
        AttendanceSession.college_id == context.college_id,
    ).with_for_update().one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Record not found.")
    assignment = db.query(StudentClassAssignment.id).filter(
        StudentClassAssignment.student_id == student.id,
        StudentClassAssignment.class_id == session.class_id,
        StudentClassAssignment.college_id == context.college_id,
        active_relationship_at(db, StudentClassAssignment, utcnow()),
    ).first()
    teacher_assignment = db.query(TeacherAssignment.id).filter(
        TeacherAssignment.teacher_id == session.teacher_id,
        TeacherAssignment.subject_id == session.subject_id,
        TeacherAssignment.class_id == session.class_id,
        TeacherAssignment.college_id == context.college_id,
        active_relationship_at(db, TeacherAssignment, utcnow()),
    ).first()
    if not assignment or not teacher_assignment:
        raise HTTPException(status_code=403, detail="The active College class assignment is required.")
    now = utcnow()
    starts_at = session.starts_at.replace(tzinfo=timezone.utc) if session.starts_at.tzinfo is None else session.starts_at
    ends_at = session.ends_at.replace(tzinfo=timezone.utc) if session.ends_at.tzinfo is None else session.ends_at
    if session.status != "active":
        raise HTTPException(status_code=400, detail="This attendance session is closed.")
    if now < starts_at:
        raise HTTPException(status_code=400, detail="This attendance session has not started yet.")
    if now > ends_at:
        raise HTTPException(status_code=400, detail="This attendance session has expired.")
    return session


def _save_attendance_event(db, context, student, session, *, method, coordinates, confidence=None):
    duplicate = db.query(AttendanceEvent.id).filter(
        AttendanceEvent.college_id == context.college_id,
        AttendanceEvent.session_id == session.id,
        AttendanceEvent.student_id == student.id,
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="Attendance has already been recorded for this session.")
    if method not in {"qr", "face"}:
        raise HTTPException(status_code=400, detail="Unsupported attendance verification method.")

    latitude = None
    longitude = None
    distance = None

    if method == "qr":
        if session.latitude is None or session.longitude is None:
            raise HTTPException(
                status_code=503,
                detail="Attendance location is not configured for this session.",
            )
        latitude = coordinates.get("latitude") if coordinates else None
        longitude = coordinates.get("longitude") if coordinates else None
        accuracy = coordinates.get("accuracy_m") if coordinates else None
        distance = haversine_m(session.latitude, session.longitude, latitude, longitude)
        try:
            accuracy_limit = db.query(College.gps_accuracy_limit_m).filter(
                College.id == context.college_id,
                College.status == "active",
            ).scalar()
        except SQLAlchemyError as exc:
            db.rollback()
            raise HTTPException(status_code=503, detail=_college_gps_schema_failure_detail(exc)) from exc
        if accuracy_limit is None:
            raise HTTPException(status_code=503, detail="College GPS accuracy settings are unavailable.")
        validate_geofence_fix(latitude, longitude, accuracy, session.radius_m, accuracy_limit)
        if distance is None or distance > float(session.radius_m):
            raise HTTPException(status_code=403, detail="You are outside the attendance zone.")
    else:
        # Face attendance relies on registered face verification, not student GPS.
        accuracy = None
    db.add(AttendanceEvent(
        college_id=context.college_id,
        session_id=session.id,
        student_id=student.id,
        method=method,
        status="present",
        confidence=confidence,
        latitude=latitude,
        longitude=longitude,
        distance_m=distance,
        verification_reason=(
            "Tenant membership, class assignment, active session, and QR GPS geofence verification passed."
            if method == "qr"
            else "Tenant membership, class assignment, active session, and registered face verification passed."
        ),
    ))
    db.add(AttendanceAuditLog(
        college_id=context.college_id,
        user_id=context.user_id,
        action=f"attendance.student_{method}_verified",
        entity_type="attendance_session",
        entity_id=session.id,
        event_metadata={"student_id": student.id, "method": method, "distance_m": distance},
    ))
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Attendance has already been recorded for this session.") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="Attendance could not be saved.") from exc


async def _save_face(db, student, file, consent):
    if consent is not True:
        raise HTTPException(status_code=400, detail="Student face-registration consent is required.")
    if file.content_type not in _IMAGE_TYPES:
        raise HTTPException(status_code=415, detail="Use a JPG, PNG, or WEBP camera image.")
    image_data = await file.read(MAX_IMAGE_BYTES + 1)
    if not image_data or len(image_data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="The face image is empty or exceeds the 5 MB limit.")
    image_hash = hashlib.sha256(image_data).hexdigest()
    duplicate = db.query(FaceEmbedding.id).filter(
        FaceEmbedding.image_sha256 == image_hash,
        FaceEmbedding.student_id != student.id,
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="This image is already registered to another Student.")
    try:
        embedding = embedding_from_image(image_data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (RuntimeError, AttributeError) as exc:
        raise HTTPException(status_code=503, detail="Face recognition models are unavailable.") from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail="The captured image could not be processed.") from exc
    if not is_valid_embedding(embedding):
        raise HTTPException(status_code=422, detail="A valid face embedding could not be generated.")

    registration = db.query(FaceEmbedding).filter(FaceEmbedding.student_id == student.id).one_or_none()
    if registration is None:
        registration = FaceEmbedding(student_id=student.id)
        db.add(registration)
    registration.image_data = image_data
    registration.mime_type = file.content_type
    registration.image_sha256 = image_hash
    registration.embedding_json = json.dumps(embedding, separators=(",", ":"))
    registration.status = "registered"
    try:
        db.commit()
        db.refresh(registration)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="This face image is already registered.") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="Face registration could not be saved.") from exc
    return _face_status(db, student)


@router.get("/me")
def my_face_status(
    college_id: int = Query(gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _context(db, current_user, college_id, _STUDENT_ROLES)
    return _face_status(db, _student_for_self(db, context))


@router.post("/me/register", status_code=status.HTTP_201_CREATED)
async def register_my_face(
    college_id: int = Query(gt=0),
    file: UploadFile = File(...),
    consent: bool = Form(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _context(db, current_user, college_id, _STUDENT_ROLES)
    student = _student_for_self(db, context)
    return await _save_face(db, student, file, consent)


@router.get("/students/{student_id}")
def student_face_status(
    student_id: int,
    college_id: int = Query(gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _context(db, current_user, college_id, _ADMIN_ROLES)
    return _face_status(db, _student_for_admin(db, student_id, context.college_id, require_active=False))


@router.post("/students/{student_id}/register", status_code=status.HTTP_201_CREATED)
async def register_student_face(
    student_id: int,
    college_id: int = Query(gt=0),
    file: UploadFile = File(...),
    consent: bool = Form(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _context(db, current_user, college_id, _ADMIN_ROLES)
    student = _student_for_admin(db, student_id, context.college_id)
    return await _save_face(db, student, file, consent)


@router.get("/student/sessions")
def my_active_sessions(
    college_id: int = Query(gt=0), db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context, student = _eligible_student_context(db, current_user, college_id)
    try:
        return _student_sessions_query(db, context, student)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="College attendance sessions are unavailable.") from exc


@router.get("/student/academics")
def my_student_academics(
    college_id: int = Query(gt=0), db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Return only the caller's current College-owned class and subject assignments."""
    context, student = _eligible_student_context(db, current_user, college_id)
    try:
        date_tracking = has_effective_date_columns(db, StudentClassAssignment)
        enrollments = db.query(StudentClassAssignment, Class).join(
            Class, and_(
                Class.id == StudentClassAssignment.class_id,
                Class.college_id == context.college_id,
                Class.college_id.is_not(None),
                Class.is_active.is_(True),
            )
        ).filter(
            StudentClassAssignment.student_id == student.id,
            StudentClassAssignment.college_id == context.college_id,
            StudentClassAssignment.college_id.is_not(None),
            active_relationship_at(db, StudentClassAssignment, utcnow()),
        ).order_by(Class.name, StudentClassAssignment.id).all()

        result = []
        for enrollment, class_row in enrollments:
            assignment_rows = db.query(TeacherAssignment, Subject).join(
                Subject, and_(
                    Subject.id == TeacherAssignment.subject_id,
                    Subject.college_id == context.college_id,
                    Subject.college_id.is_not(None),
                    Subject.is_active.is_(True),
                )
            ).join(
                Teacher, and_(
                    Teacher.id == TeacherAssignment.teacher_id,
                    Teacher.college_id == context.college_id,
                    Teacher.college_id.is_not(None),
                    Teacher.is_active.is_(True),
                )
            ).filter(
                TeacherAssignment.class_id == class_row.id,
                TeacherAssignment.college_id == context.college_id,
                TeacherAssignment.college_id.is_not(None),
                active_relationship_at(db, TeacherAssignment, utcnow()),
            ).order_by(Subject.name, TeacherAssignment.id).all()
            subjects_by_key = {}
            for assignment, subject in assignment_rows:
                key = (subject.id, assignment.academic_year, assignment.semester)
                subjects_by_key.setdefault(key, {
                    "id": subject.id,
                    "name": subject.name,
                    "code": subject.code,
                    "department": subject.department or class_row.department,
                    "academic_year": assignment.academic_year,
                    "semester": assignment.semester,
                })
            result.append({
                "class_id": class_row.id,
                "class_name": class_row.name,
                "section": class_row.section,
                "department": class_row.department,
                "semester": enrollment.semester or class_row.semester,
                "academic_year": enrollment.academic_year or class_row.academic_year,
                "effective_from": enrollment.effective_from if date_tracking else None,
                "subjects": list(subjects_by_key.values()),
            })
        return {"student_id": student.id, "enrollments": result}
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="College academic assignments are unavailable.") from exc


@router.get("/student/attendance")
def my_attendance(
    college_id: int = Query(gt=0), db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context, student = _eligible_student_context(db, current_user, college_id)
    try:
        rows = (
            db.query(AttendanceEvent, AttendanceSession, Class, Subject)
            .join(AttendanceSession, and_(AttendanceSession.id == AttendanceEvent.session_id, AttendanceSession.college_id == context.college_id))
            .join(Class, and_(Class.id == AttendanceSession.class_id, Class.college_id == context.college_id))
            .join(Subject, and_(Subject.id == AttendanceSession.subject_id, Subject.college_id == context.college_id))
            .filter(AttendanceEvent.student_id == student.id, AttendanceEvent.college_id == context.college_id)
            .order_by(AttendanceEvent.verified_at.desc()).all()
        )
        return [{
            "id": event.id, "session_id": session.id, "session_title": session.title,
            "subject_name": subject.name, "class_name": class_row.name,
            "date": event.verified_at, "status": event.status, "method": event.method,
        } for event, session, class_row, subject in rows]
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="College attendance history is unavailable.") from exc


@router.post("/student/sessions/{session_id}/qr")
def submit_qr_attendance(
    session_id: int, body: StudentQrAttendanceGISRequest,
    college_id: int = Query(gt=0), db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context, student = _eligible_student_context(db, current_user, college_id)
    session = _check_student_session(db, context, student, session_id)
    if session.qr_expires_at is not None and session.qr_expires_at.tzinfo is None:
        session.qr_expires_at = session.qr_expires_at.replace(tzinfo=timezone.utc)
    if not verify_current_qr_token(body.token.strip(), session.id, session.qr_secret, session.qr_expires_at):
        raise HTTPException(status_code=400, detail="Invalid or expired QR code.")
    try:
        _save_attendance_event(db, context, student, session, method="qr", coordinates={
            "latitude": body.latitude, "longitude": body.longitude, "accuracy_m": body.accuracy_m,
        })
    except HTTPException:
        db.rollback()
        raise
    return {"success": True, "message": "Attendance recorded successfully.", "session_id": session.id, "method": "qr", "status": "present"}


@router.post("/student/sessions/{session_id}/face")
async def submit_face_attendance(
    session_id: int, file: UploadFile = File(...), college_id: int = Query(gt=0),
    latitude: Optional[float] = Form(default=None), longitude: Optional[float] = Form(default=None),
    accuracy_m: Optional[float] = Form(default=None), db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context, student = _eligible_student_context(db, current_user, college_id)
    session = _check_student_session(db, context, student, session_id)
    if file.content_type not in _IMAGE_TYPES:
        raise HTTPException(status_code=415, detail="Capture a JPG, PNG, or WEBP image.")
    image_data = await file.read(MAX_IMAGE_BYTES + 1)
    if not image_data or len(image_data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="The captured face image is empty or exceeds 5 MB.")
    registration = db.query(FaceEmbedding.embedding_json).filter(
        FaceEmbedding.student_id == student.id, FaceEmbedding.status == "registered",
    ).one_or_none()
    reference = decode_embedding(registration[0]) if registration and is_valid_embedding(registration[0]) else None
    if reference is None:
        raise HTTPException(status_code=403, detail="No valid face registration is available for this account.")
    try:
        probe = decode_embedding(embedding_from_image(image_data))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (RuntimeError, AttributeError) as exc:
        raise HTTPException(status_code=503, detail="Face recognition models are unavailable.") from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail="The captured face image could not be processed.") from exc
    if probe is None:
        raise HTTPException(status_code=422, detail="A valid face embedding could not be generated.")
    confidence = float(probe @ reference)
    if confidence < DEFAULT_THRESHOLD:
        raise HTTPException(status_code=403, detail="Face did not match the registered Student. Please retry.")
    try:
        _save_attendance_event(db, context, student, session, method="face", coordinates=None, confidence=confidence)
    except HTTPException:
        db.rollback()
        raise
    return {"success": True, "message": "Face verified and attendance recorded.", "session_id": session.id, "method": "face", "status": "present"}
