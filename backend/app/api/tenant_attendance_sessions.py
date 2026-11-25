"""Tenant-safe teacher session lifecycle and live attendance views."""

import json
import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import String, and_, case, cast, func
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import (
    AttendanceAuditLog,
    AttendanceEvent,
    AttendanceSession,
    Class,
    Student,
    StudentClassAssignment,
    TeacherAccountLink,
    Subject,
    Teacher,
    TeacherAssignment,
    User,
)
from app.schemas.attendance_gis import AttendanceSessionGISCreate
from app.services.attendance_core import (
    build_qr_token, new_qr_secret, utcnow,
    get_college_gps_accuracy_limit, haversine_m, validate_geofence_fix,
)
from app.tenant_context import TenantContext, resolve_tenant_context
from app.tenant_relationship_history import active_relationship_at, has_effective_date_columns
from app.api.tenant_teachers import require_verified_teacher_profile


router = APIRouter(prefix="/tenant/attendance/sessions", tags=["Tenant Attendance Sessions"])
attendance_events_router = APIRouter(prefix="/tenant/attendance/events", tags=["Tenant Attendance Events"])
_READ_ROLES = frozenset({"college_admin", "teacher"})
_UNAVAILABLE = "College attendance sessions are unavailable."
_logger = logging.getLogger(__name__)


def _log_geofence_rejection(stage, context, class_row, subject, body, *, accuracy_limit=None, distance=None):
    """Emit rejection-stage metrics without retaining precise coordinates."""
    diagnostic = {
        "event": "teacher_lecture_geofence_rejected",
        "stage": stage,
        "college_id": context.college_id,
        "class_id": class_row.id,
        "subject_id": subject.id,
        "classroom_radius_m": class_row.radius_m,
        "gps_accuracy_m": body.teacher_accuracy_m,
        "college_accuracy_limit_m": accuracy_limit,
        "haversine_distance_m": round(distance, 2) if distance is not None else None,
    }
    _logger.warning("attendx_geofence_diagnostic %s", json.dumps(diagnostic, separators=(",", ":")))


def _context(db: Session, user, college_id: Optional[int]) -> TenantContext:
    try:
        return resolve_tenant_context(db, user, allowed_roles=_READ_ROLES, requested_college_id=college_id)
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=_UNAVAILABLE) from exc


def _teacher_for_context(db: Session, context: TenantContext):
    if context.membership_role != "teacher":
        raise HTTPException(status_code=403, detail="An active Teacher membership is required.")
    account = db.query(User).filter(User.id == context.user_id, User.is_active.is_(True)).one_or_none()
    if account is None:
        raise HTTPException(status_code=403, detail="The signed-in account is no longer active. Sign in again.")
    link = db.query(TeacherAccountLink).filter(
        TeacherAccountLink.user_id == context.user_id,
        TeacherAccountLink.college_id == context.college_id,
        TeacherAccountLink.link_status == "active",
    ).one_or_none()
    if link is None:
        raise HTTPException(status_code=403, detail="An active, verified Teacher profile link is required in this College.")
    teacher = db.query(Teacher).filter(
        Teacher.id == link.teacher_id,
        Teacher.college_id == context.college_id,
        Teacher.college_id.is_not(None),
        Teacher.is_active.is_(True),
    ).with_for_update().one_or_none()
    if teacher is None:
        raise HTTPException(status_code=403, detail="An active College Teacher profile is required.")
    require_verified_teacher_profile(db, teacher, context.college_id)
    return teacher


def _session_location_statuses(db: Session, college_id: int, session_ids: list[int]) -> dict[int, str]:
    """Read explicit creation-mode evidence persisted with the creation audit event."""
    if not session_ids:
        return {}
    rows = db.query(AttendanceAuditLog).filter(
        AttendanceAuditLog.college_id == college_id,
        AttendanceAuditLog.action == "attendance_session.created",
        AttendanceAuditLog.entity_type == "attendance_session",
        AttendanceAuditLog.entity_id.in_(session_ids),
    ).order_by(AttendanceAuditLog.id.desc()).all()
    statuses = {}
    for row in rows:
        if row.entity_id in statuses:
            continue
        metadata = row.event_metadata
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata)
            except (TypeError, ValueError):
                metadata = {}
        status_value = metadata.get("location_verification_status") if isinstance(metadata, dict) else None
        statuses[row.entity_id] = status_value if status_value in {"verified", "not_verified"} else "unknown"
    return statuses


def _session_payload(db: Session, session: AttendanceSession, location_status: str = "unknown") -> dict:
    class_row = db.query(Class).filter(Class.id == session.class_id, Class.college_id == session.college_id).one()
    subject = db.query(Subject).filter(Subject.id == session.subject_id, Subject.college_id == session.college_id).one()
    return {
        "id": session.id,
        "teacher_id": session.teacher_id,
        "subject_id": session.subject_id,
        "class_id": session.class_id,
        "title": session.title,
        "starts_at": session.starts_at,
        "ends_at": session.ends_at,
        "status": session.status,
        "location_verification_status": location_status,
        "qr_expires_at": session.qr_expires_at,
        "latitude": session.latitude,
        "longitude": session.longitude,
        "radius_m": session.radius_m,
        "created_at": session.created_at,
        "subject_name": subject.name,
        "class_name": class_row.name,
        "section": class_row.section,
        "location_name": class_row.location_name,
    }


def _authorize_session(db: Session, session_id: int, context: TenantContext, *, lock=False):
    query = db.query(AttendanceSession).filter(
        AttendanceSession.id == session_id,
        AttendanceSession.college_id == context.college_id,
        AttendanceSession.college_id.is_not(None),
    )
    if lock:
        query = query.with_for_update()
    session = query.one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Attendance session not found.")
    if context.membership_role == "teacher":
        teacher = _teacher_for_context(db, context)
        if session.teacher_id != teacher.id:
            raise HTTPException(status_code=404, detail="Attendance session not found.")
    return session


def _tenant_event_query(db: Session, college_id: int):
    return (
        db.query(AttendanceEvent, Student, AttendanceSession, Class, Subject, Teacher)
        .join(AttendanceSession, and_(
            AttendanceSession.id == AttendanceEvent.session_id,
            AttendanceSession.college_id == AttendanceEvent.college_id,
        ))
        .join(Student, and_(Student.id == AttendanceEvent.student_id, Student.college_id == AttendanceEvent.college_id))
        .join(Class, and_(Class.id == AttendanceSession.class_id, Class.college_id == AttendanceEvent.college_id))
        .join(Subject, and_(Subject.id == AttendanceSession.subject_id, Subject.college_id == AttendanceEvent.college_id))
        .join(Teacher, and_(Teacher.id == AttendanceSession.teacher_id, Teacher.college_id == AttendanceEvent.college_id))
        .join(TeacherAssignment, and_(
            TeacherAssignment.teacher_id == AttendanceSession.teacher_id,
            TeacherAssignment.class_id == AttendanceSession.class_id,
            TeacherAssignment.subject_id == AttendanceSession.subject_id,
            TeacherAssignment.college_id == AttendanceEvent.college_id,
        ))
        .join(StudentClassAssignment, and_(
            StudentClassAssignment.student_id == AttendanceEvent.student_id,
            StudentClassAssignment.class_id == AttendanceSession.class_id,
            StudentClassAssignment.college_id == AttendanceEvent.college_id,
        ))
        .filter(AttendanceEvent.college_id == college_id, AttendanceEvent.college_id.is_not(None))
        .distinct()
    )


def _event_payload(row):
    event, student, session, class_row, subject, teacher = row
    return {
        "id": event.id,
        "student_id": student.id,
        "student_name": student.name,
        "student_code": student.student_code,
        "roll_number": student.roll_number,
        "teacher_id": teacher.id,
        "teacher_name": teacher.name,
        "class_id": class_row.id,
        "class_name": class_row.name,
        "subject_id": subject.id,
        "subject_name": subject.name,
        "session_id": session.id,
        "session_title": session.title,
        "attendance_date": event.verified_at,
        "status": event.status,
        "method": event.method,
        "source": "verified_event",
    }


@attendance_events_router.get("")
def list_tenant_attendance_events(
    college_id: Optional[int] = Query(default=None, gt=0),
    status_filter: Optional[str] = Query(default=None, alias="status", pattern="^(present|late|absent)$"),
    student_id: Optional[int] = Query(default=None, gt=0),
    teacher_id: Optional[int] = Query(default=None, gt=0),
    class_id: Optional[int] = Query(default=None, gt=0),
    subject_id: Optional[int] = Query(default=None, gt=0),
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    search: Optional[str] = Query(default=None, max_length=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _context(db, current_user, college_id)
    if context.membership_role != "college_admin":
        raise HTTPException(status_code=403, detail="College administrator membership required.")
    if date_from and date_to and date_to < date_from:
        raise HTTPException(status_code=422, detail="End date must not be earlier than start date.")
    try:
        query = _tenant_event_query(db, context.college_id)
        if status_filter:
            query = query.filter(AttendanceEvent.status == status_filter)
        if student_id:
            query = query.filter(AttendanceEvent.student_id == student_id)
        if teacher_id:
            query = query.filter(AttendanceSession.teacher_id == teacher_id)
        if class_id:
            query = query.filter(AttendanceSession.class_id == class_id)
        if subject_id:
            query = query.filter(AttendanceSession.subject_id == subject_id)
        if date_from:
            query = query.filter(AttendanceEvent.verified_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc))
        if date_to:
            query = query.filter(AttendanceEvent.verified_at < datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=timezone.utc))
        if search and search.strip():
            term = f"%{search.strip()}%"
            query = query.filter(
                Student.name.ilike(term)
                | Student.roll_number.ilike(term)
                | Student.student_code.ilike(term)
                | Teacher.name.ilike(term)
                | Class.name.ilike(term)
                | Subject.name.ilike(term)
                | cast(AttendanceEvent.id, String).ilike(term)
            )
        total = query.count()
        rows = query.order_by(AttendanceEvent.verified_at.desc(), AttendanceEvent.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
        return {"items": [_event_payload(row) for row in rows], "total": total, "page": page, "page_size": page_size}
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="College attendance history is unavailable.") from exc


@attendance_events_router.get("/{event_id}")
def read_tenant_attendance_event(
    event_id: int,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _context(db, current_user, college_id)
    if context.membership_role != "college_admin":
        raise HTTPException(status_code=403, detail="College administrator membership required.")
    try:
        row = _tenant_event_query(db, context.college_id).filter(AttendanceEvent.id == event_id).one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="Attendance record not found.")
        return _event_payload(row)
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="College attendance history is unavailable.") from exc


def _qr_payload(session: AttendanceSession, *, rotate: bool) -> dict:
    now = utcnow()
    ends_at = session.ends_at
    expires_at = session.qr_expires_at
    if ends_at.tzinfo is None:
        ends_at = ends_at.replace(tzinfo=timezone.utc)
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if session.status != "active" or ends_at <= now:
        raise HTTPException(status_code=409, detail="This attendance session is no longer active.")
    if rotate or expires_at is None or expires_at <= now:
        session.qr_secret = new_qr_secret()
        session.qr_expires_at = min(ends_at, now + timedelta(seconds=60))
        expires_at = session.qr_expires_at
    expires = expires_at
    return {
        "session_id": session.id,
        "token": build_qr_token(session.id, session.qr_secret, expires),
        "expires_at": expires,
        "ttl_seconds": max(0, int((expires - now).total_seconds())),
    }


@router.get("/assignments")
def my_teacher_assignments(
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _context(db, current_user, college_id)
    teacher = _teacher_for_context(db, context)
    try:
        date_tracking = has_effective_date_columns(db, TeacherAssignment)
        rows = db.query(TeacherAssignment, Class, Subject).join(
            Class, and_(Class.id == TeacherAssignment.class_id, Class.college_id == context.college_id)
        ).join(
            Subject, and_(Subject.id == TeacherAssignment.subject_id, Subject.college_id == context.college_id)
        ).filter(
            TeacherAssignment.teacher_id == teacher.id,
            TeacherAssignment.college_id == context.college_id,
            TeacherAssignment.college_id.is_not(None),
            active_relationship_at(db, TeacherAssignment, utcnow()),
            Class.is_active.is_(True),
            Subject.is_active.is_(True),
        ).order_by(Class.name, Subject.name, TeacherAssignment.id).all()
        return [{
            "id": assignment.id,
            "teacher_id": teacher.id,
            "class_id": class_row.id,
            "class_name": class_row.name,
            "section": class_row.section,
            "department": class_row.department or subject.department,
            "location_name": class_row.location_name,
            "latitude": class_row.latitude,
            "longitude": class_row.longitude,
            "radius_m": class_row.radius_m,
            "subject_id": subject.id,
            "subject_name": subject.name,
            "subject_code": subject.code,
            "academic_year": assignment.academic_year,
            "semester": assignment.semester,
            "is_active": True,
            "effective_from": assignment.effective_from if date_tracking else None,
            "effective_to": assignment.effective_to if date_tracking else None,
        } for assignment, class_row, subject in rows]
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=_UNAVAILABLE) from exc


@router.get("/summary")
def my_teacher_attendance_summary(
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _context(db, current_user, college_id)
    teacher = _teacher_for_context(db, context)
    try:
        session_query = db.query(AttendanceSession.id).filter(
            AttendanceSession.college_id == context.college_id,
            AttendanceSession.college_id.is_not(None),
            AttendanceSession.teacher_id == teacher.id,
        )
        total_sessions = session_query.count()
        active_sessions = session_query.filter(AttendanceSession.status == "active").count()
        total_assignments = db.query(TeacherAssignment.id).filter(
            TeacherAssignment.college_id == context.college_id,
            TeacherAssignment.college_id.is_not(None),
            TeacherAssignment.teacher_id == teacher.id,
            active_relationship_at(db, TeacherAssignment, utcnow()),
        ).count()
        event_counts = db.query(
            func.count(AttendanceEvent.id),
            func.coalesce(func.sum(case((AttendanceEvent.status == "present", 1), else_=0)), 0),
            func.coalesce(func.sum(case((AttendanceEvent.status == "late", 1), else_=0)), 0),
            func.coalesce(func.sum(case((AttendanceEvent.status == "absent", 1), else_=0)), 0),
        ).join(
            AttendanceSession,
            and_(
                AttendanceSession.id == AttendanceEvent.session_id,
                AttendanceSession.college_id == context.college_id,
                AttendanceSession.teacher_id == teacher.id,
            ),
        ).join(
            Student,
            and_(Student.id == AttendanceEvent.student_id, Student.college_id == context.college_id),
        ).join(
            Class,
            and_(Class.id == AttendanceSession.class_id, Class.college_id == context.college_id),
        ).join(
            Subject,
            and_(Subject.id == AttendanceSession.subject_id, Subject.college_id == context.college_id),
        ).join(
            TeacherAssignment,
            and_(
                TeacherAssignment.teacher_id == AttendanceSession.teacher_id,
                TeacherAssignment.class_id == AttendanceSession.class_id,
                TeacherAssignment.subject_id == AttendanceSession.subject_id,
                TeacherAssignment.college_id == context.college_id,
            ),
        ).join(
            StudentClassAssignment,
            and_(
                StudentClassAssignment.student_id == AttendanceEvent.student_id,
                StudentClassAssignment.class_id == AttendanceSession.class_id,
                StudentClassAssignment.college_id == context.college_id,
            ),
        ).filter(
            AttendanceEvent.college_id == context.college_id,
            AttendanceEvent.college_id.is_not(None),
        ).one()
        total_events, present_events, late_events, absent_events = (int(value or 0) for value in event_counts)
        classified = present_events + late_events + absent_events
        return {
            "teacher_name": teacher.name,
            "sessions": total_sessions,
            "active_sessions": active_sessions,
            "total_assignments": total_assignments,
            "verified_attendance_events": total_events,
            "present_events": present_events,
            "late_events": late_events,
            "absent_events": absent_events,
            "classified_events": classified,
            "attendance_percentage": round((present_events + late_events) / classified * 100, 2) if classified else None,
        }
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=_UNAVAILABLE) from exc


@router.get("")
def list_sessions(
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _context(db, current_user, college_id)
    try:
        query = db.query(AttendanceSession).filter(
            AttendanceSession.college_id == context.college_id,
            AttendanceSession.college_id.is_not(None),
        )
        if context.membership_role == "teacher":
            teacher = _teacher_for_context(db, context)
            query = query.filter(AttendanceSession.teacher_id == teacher.id)
        sessions = query.order_by(AttendanceSession.starts_at.desc(), AttendanceSession.id.desc()).limit(100).all()
        location_statuses = _session_location_statuses(db, context.college_id, [item.id for item in sessions])
        return [_session_payload(db, session, location_statuses.get(session.id, "unknown")) for session in sessions]
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=_UNAVAILABLE) from exc


@router.post("", status_code=status.HTTP_201_CREATED)
def create_session(
    body: AttendanceSessionGISCreate,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _context(db, current_user, college_id)
    teacher = _teacher_for_context(db, context)
    try:
        if body.location_verification_mode is None:
            raise HTTPException(status_code=422, detail="Choose whether Teacher location verification is on or off.")
        class_row = db.query(Class).filter(
            Class.id == body.class_id,
            Class.college_id == context.college_id,
            Class.college_id.is_not(None),
            Class.is_active.is_(True),
        ).one_or_none()
        subject = db.query(Subject).filter(
            Subject.id == body.subject_id,
            Subject.college_id == context.college_id,
            Subject.college_id.is_not(None),
            Subject.is_active.is_(True),
        ).one_or_none()
        assignment = db.query(TeacherAssignment.id).filter(
            TeacherAssignment.teacher_id == teacher.id,
            TeacherAssignment.class_id == body.class_id,
            TeacherAssignment.subject_id == body.subject_id,
            TeacherAssignment.college_id == context.college_id,
            TeacherAssignment.college_id.is_not(None),
            active_relationship_at(db, TeacherAssignment, utcnow()),
        ).first()
        if class_row is None or subject is None or assignment is None:
            raise HTTPException(status_code=404, detail="An active assigned Class and Subject were not found.")
        now = utcnow()
        if body.ends_at <= now:
            raise HTTPException(status_code=422, detail="Session end time must be in the future.")
        location_status = "not_verified"
        # Never accept a client-supplied radius as session policy. When GPS is
        # off, retain the class configuration (or the model's historical 100m
        # default) for QR verification without running a Teacher GPS check.
        classroom_radius = float(class_row.radius_m) if class_row.radius_m is not None else 100.0
        if body.location_verification_mode == "gps_on":
            # Only the College Admin-configured point is authoritative in GPS mode.
            if class_row.latitude is None or class_row.longitude is None:
                raise HTTPException(status_code=422, detail="The College Admin must configure this classroom location before starting attendance.")
            if class_row.radius_m is None or float(class_row.radius_m) <= 0:
                raise HTTPException(status_code=503, detail="The classroom geofence radius is not configured. Contact the College Admin.")
            if body.teacher_latitude is None or body.teacher_longitude is None or body.teacher_accuracy_m is None:
                raise HTTPException(status_code=400, detail="Allow fresh GPS location to verify your position before starting the lecture.")
            classroom_radius = float(class_row.radius_m)
            accuracy_limit = get_college_gps_accuracy_limit(db, context.college_id)
            teacher_distance = haversine_m(class_row.latitude, class_row.longitude, body.teacher_latitude, body.teacher_longitude)
            try:
                validate_geofence_fix(body.teacher_latitude, body.teacher_longitude, body.teacher_accuracy_m, classroom_radius, accuracy_limit)
            except HTTPException:
                _log_geofence_rejection("gps_accuracy_or_coordinate_validation", context, class_row, subject, body, accuracy_limit=accuracy_limit, distance=teacher_distance)
                raise
            if teacher_distance is None or teacher_distance > classroom_radius:
                _log_geofence_rejection("classroom_distance_validation", context, class_row, subject, body, accuracy_limit=accuracy_limit, distance=teacher_distance)
                raise HTTPException(
                    status_code=403,
                    detail=(f"The device-reported location is {teacher_distance:.1f} m from the configured classroom point, "
                            f"outside its {classroom_radius:g} m attendance zone. GPS reports {body.teacher_accuracy_m:.1f} m "
                            f"accuracy (College limit {accuracy_limit:g} m). Location can be inaccurate indoors or when "
                            "Windows/browser location estimates from network data. Enable Windows Location and browser "
                            "location access, retry with a fresh fix near a window or on a GPS-capable device, and ask the "
                            "College Admin to verify the class pin if this distance is unexpected."),
                )
            location_status = "verified"

        session = AttendanceSession(
            college_id=context.college_id,
            teacher_id=teacher.id,
            subject_id=subject.id,
            class_id=class_row.id,
            title=body.title.strip(),
            starts_at=body.starts_at,
            ends_at=body.ends_at,
            status="active",
            qr_secret=new_qr_secret(),
            qr_expires_at=min(body.ends_at, now + timedelta(seconds=60)),
            latitude=class_row.latitude,
            longitude=class_row.longitude,
            radius_m=classroom_radius,
        )
        db.add(session)
        db.flush()
        db.add(AttendanceAuditLog(
            user_id=context.user_id,
            college_id=context.college_id,
            action="attendance_session.created",
            entity_type="attendance_session",
            entity_id=session.id,
            event_metadata={"class_id": class_row.id, "subject_id": subject.id, "location_verification_status": location_status},
        ))
        db.commit()
        db.refresh(session)
        return _session_payload(db, session, _session_location_statuses(db, context.college_id, [session.id]).get(session.id, "unknown"))
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Attendance session conflicts with existing records.") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=_UNAVAILABLE) from exc


@router.get("/{session_id}/live")
def live_attendance(
    session_id: int,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _context(db, current_user, college_id)
    try:
        session = _authorize_session(db, session_id, context)
        rows = db.query(Student, AttendanceEvent).outerjoin(
            AttendanceEvent,
            and_(
                AttendanceEvent.student_id == Student.id,
                AttendanceEvent.session_id == session.id,
                AttendanceEvent.college_id == context.college_id,
            ),
        ).join(
            StudentClassAssignment,
            and_(StudentClassAssignment.student_id == Student.id, StudentClassAssignment.college_id == context.college_id),
        ).filter(
            Student.college_id == context.college_id,
            Student.college_id.is_not(None),
            Student.is_active.is_(True),
            StudentClassAssignment.class_id == session.class_id,
            active_relationship_at(db, StudentClassAssignment, session.starts_at),
        ).order_by(Student.roll_number, Student.name).all()
        return [{
            "student_id": student.id,
            "student_code": student.student_code,
            "name": student.name,
            "roll_number": student.roll_number,
            "status": event.status if event else "pending",
            "attendance_id": event.id if event else None,
            "method": event.method if event else None,
            "verified_at": event.verified_at if event else None,
            "distance_m": event.distance_m if event else None,
        } for student, event in rows]
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=_UNAVAILABLE) from exc


@router.get("/{session_id}/qr")
def get_qr(session_id: int, college_id: Optional[int] = Query(default=None, gt=0), db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    context = _context(db, current_user, college_id)
    try:
        session = _authorize_session(db, session_id, context, lock=True)
        result = _qr_payload(session, rotate=False)
        db.commit()
        return result
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=_UNAVAILABLE) from exc


@router.post("/{session_id}/qr/refresh")
def refresh_qr(session_id: int, college_id: Optional[int] = Query(default=None, gt=0), db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    context = _context(db, current_user, college_id)
    try:
        session = _authorize_session(db, session_id, context, lock=True)
        result = _qr_payload(session, rotate=True)
        db.commit()
        return result
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=_UNAVAILABLE) from exc


@router.post("/{session_id}/close")
def close_session(session_id: int, college_id: Optional[int] = Query(default=None, gt=0), db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    context = _context(db, current_user, college_id)
    if context.membership_role != "teacher":
        raise HTTPException(status_code=403, detail="Only the assigned Teacher can close this session.")
    try:
        session = _authorize_session(db, session_id, context, lock=True)
        if session.status != "active":
            raise HTTPException(status_code=409, detail="Attendance session is already closed.")
        roster = db.query(Student).join(
            StudentClassAssignment,
            and_(StudentClassAssignment.student_id == Student.id, StudentClassAssignment.college_id == context.college_id),
        ).filter(
            Student.college_id == context.college_id,
            Student.college_id.is_not(None),
            Student.is_active.is_(True),
            StudentClassAssignment.class_id == session.class_id,
            active_relationship_at(db, StudentClassAssignment, session.starts_at),
        ).with_for_update().all()
        inserted = 0
        now = utcnow()
        for student in roster:
            existing = db.query(AttendanceEvent.id).filter(
                AttendanceEvent.session_id == session.id,
                AttendanceEvent.student_id == student.id,
                AttendanceEvent.college_id == context.college_id,
            ).one_or_none()
            if existing is None:
                db.add(AttendanceEvent(
                    college_id=context.college_id,
                    session_id=session.id,
                    student_id=student.id,
                    method="session_close",
                    status="absent",
                    verified_at=now,
                ))
                inserted += 1
        session.status = "closed"
        session.closed_at = now
        session.qr_secret = new_qr_secret()
        db.add(AttendanceAuditLog(
            user_id=context.user_id,
            college_id=context.college_id,
            action="attendance_session.closed",
            entity_type="attendance_session",
            entity_id=session.id,
            event_metadata={"absent_events_added": inserted},
        ))
        db.commit()
        db.refresh(session)
        location_status = _session_location_statuses(db, context.college_id, [session.id]).get(session.id, "unknown")
        return {"success": True, "session": _session_payload(db, session, location_status), "summary": {"total_students": len(roster), "absent": inserted}}
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Session finalization conflicts with existing attendance records.") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=_UNAVAILABLE) from exc
