"""Tenant-scoped read-only Admin dashboard aggregates."""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, case, func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.database_diagnostics import safe_database_diagnostics
from app.dependencies import get_current_user
from app.models import (
    Attendance,
    AttendanceEvent,
    AttendanceRecord,
    AttendanceSession,
    Class,
    College,
    FaceEmbedding,
    Student,
    StudentClassAssignment,
    Subject,
    Teacher,
    TeacherAssignment,
)
from app.schemas.tenant_dashboard import (
    TenantAttendanceSummary,
    TenantDashboardSummary,
    TenantEntityCounts,
)
from app.tenant_context import resolve_tenant_context
from app.tenant_relationship_history import has_effective_date_columns, valid_relationship_on
from app.services.face_engine import is_valid_embedding


router = APIRouter(prefix="/tenant/dashboard", tags=["Tenant Dashboard"])
READ_ROLES = frozenset({"college_admin"})
_SUMMARY_UNAVAILABLE = "College dashboard summary is unavailable."
_ATTENDANCE_UNAVAILABLE = "College attendance summary is unavailable."
_TREND_UNAVAILABLE = (
    "Earliest reliable trend date: not established. This database schema has no verified enrollment or Teacher assignment effective-date fields. Existing created_at timestamps record row creation, not relationship validity; legacy attendance is not backdated or inferred."
)
logger = logging.getLogger(__name__)


def _log_database_failure(exc: Exception, *, stage: str) -> None:
    error_type, sqlstate, constraint, schema_name, relation_name, column_name, failure_class = safe_database_diagnostics(exc)
    logger.error(
        "tenant_dashboard_database_unavailable failure_class=%s error_type=%s sqlstate=%s constraint=%s schema=%s relation=%s column=%s stage=%s",
        failure_class,
        error_type,
        sqlstate or "unknown",
        constraint or "unknown",
        schema_name or "unknown",
        relation_name or "unknown",
        column_name or "unknown",
        stage,
    )


def _context(db: Session, user, college_id: Optional[int], detail: str):
    try:
        return resolve_tenant_context(
            db,
            user,
            allowed_roles=READ_ROLES,
            requested_college_id=college_id,
        )
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        _log_database_failure(exc, stage="tenant_context")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail) from exc


def _owned_entity_counts(db: Session, model, college_id: int) -> TenantEntityCounts:
    row = (
        db.query(
            func.count(model.id),
            func.coalesce(func.sum(case((model.is_active.is_(True), 1), else_=0)), 0),
        )
        .filter(model.college_id == college_id, model.college_id.is_not(None))
        .one()
    )
    total, active = int(row[0] or 0), int(row[1] or 0)
    return TenantEntityCounts(total=total, active=active, inactive=total - active)


def _face_registration_counts(db: Session, college_id: int, student_total: int) -> tuple[int, int]:
    registrations = db.query(
        FaceEmbedding.status,
        FaceEmbedding.embedding_json,
    ).join(Student, Student.id == FaceEmbedding.student_id).filter(
        Student.college_id == college_id,
        Student.college_id.is_not(None),
    ).all()
    registered = sum(
        1 for face_status, embedding_json in registrations
        if face_status == "registered" and is_valid_embedding(embedding_json)
    )
    return registered, max(0, student_total - registered)


def _attendance_rows(db: Session, college_id: int):
    return (
        db.query(Attendance.id.label("id"))
        .join(Student, and_(Student.id == Attendance.student_id, Student.college_id == Attendance.college_id))
        .join(Teacher, and_(Teacher.id == Attendance.teacher_id, Teacher.college_id == Attendance.college_id))
        .filter(Attendance.college_id == college_id, Attendance.college_id.is_not(None))
        .distinct()
        .subquery()
    )


def _attendance_record_rows(db: Session, college_id: int):
    # These are the exact relationship predicates used by Phase 14A.15.
    return (
        db.query(
            AttendanceRecord.id.label("id"),
            func.lower(AttendanceRecord.status).label("status"),
        )
        .join(Student, and_(Student.id == AttendanceRecord.student_id, Student.college_id == AttendanceRecord.college_id))
        .join(Teacher, and_(Teacher.id == AttendanceRecord.teacher_id, Teacher.college_id == AttendanceRecord.college_id))
        .join(Subject, and_(Subject.id == AttendanceRecord.subject_id, Subject.college_id == AttendanceRecord.college_id))
        .join(Class, and_(Class.id == AttendanceRecord.class_id, Class.college_id == AttendanceRecord.college_id))
        .join(
            TeacherAssignment,
            and_(
                TeacherAssignment.teacher_id == AttendanceRecord.teacher_id,
                TeacherAssignment.subject_id == AttendanceRecord.subject_id,
                TeacherAssignment.class_id == AttendanceRecord.class_id,
                TeacherAssignment.college_id == AttendanceRecord.college_id,
            ),
        )
        .join(
            StudentClassAssignment,
            and_(
                StudentClassAssignment.student_id == AttendanceRecord.student_id,
                StudentClassAssignment.class_id == AttendanceRecord.class_id,
                StudentClassAssignment.college_id == AttendanceRecord.college_id,
            ),
        )
        .filter(AttendanceRecord.college_id == college_id, AttendanceRecord.college_id.is_not(None))
        .distinct()
        .subquery()
    )


def _verified_attendance_event_rows(db: Session, college_id: int):
    # AttendanceEvent is the canonical QR/face/manual session evidence. Check
    # every relationship against this College; legacy NULL ownership is out.
    return (
        db.query(
            AttendanceEvent.id.label("id"),
            func.lower(AttendanceEvent.status).label("status"),
        )
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
        .subquery()
    )


def _historical_trend_rows(db: Session, college_id: int):
    """Return attendance rows only when both relationships cover that instant."""
    return db.query(
        AttendanceRecord.attendance_date.label("attendance_date"),
        func.lower(AttendanceRecord.status).label("status"),
    ).join(
        Student, and_(Student.id == AttendanceRecord.student_id, Student.college_id == AttendanceRecord.college_id)
    ).join(
        Teacher, and_(Teacher.id == AttendanceRecord.teacher_id, Teacher.college_id == AttendanceRecord.college_id)
    ).join(
        Subject, and_(Subject.id == AttendanceRecord.subject_id, Subject.college_id == AttendanceRecord.college_id)
    ).join(
        Class, and_(Class.id == AttendanceRecord.class_id, Class.college_id == AttendanceRecord.college_id)
    ).join(
        TeacherAssignment,
        and_(
            TeacherAssignment.teacher_id == AttendanceRecord.teacher_id,
            TeacherAssignment.subject_id == AttendanceRecord.subject_id,
            TeacherAssignment.class_id == AttendanceRecord.class_id,
            TeacherAssignment.college_id == AttendanceRecord.college_id,
            valid_relationship_on(TeacherAssignment, AttendanceRecord.attendance_date),
        ),
    ).join(
        StudentClassAssignment,
        and_(
            StudentClassAssignment.student_id == AttendanceRecord.student_id,
            StudentClassAssignment.class_id == AttendanceRecord.class_id,
            StudentClassAssignment.college_id == AttendanceRecord.college_id,
            valid_relationship_on(StudentClassAssignment, AttendanceRecord.attendance_date),
        ),
    ).filter(
        AttendanceRecord.college_id == college_id,
        AttendanceRecord.college_id.is_not(None),
    ).distinct().all()


def _trend_summary(rows):
    buckets = {}
    for attendance_date, raw_status in rows:
        period = attendance_date.strftime("%Y-%m")
        bucket = buckets.setdefault(period, {"records": 0, "present": 0, "late": 0, "absent": 0, "unclassified": 0})
        bucket["records"] += 1
        value = str(raw_status or "").lower()
        bucket[value if value in {"present", "late", "absent"} else "unclassified"] += 1
    trends = []
    for period, counts in sorted(buckets.items()):
        denominator = counts["present"] + counts["late"] + counts["absent"]
        trends.append({
            "period": period,
            **counts,
            "presence_rate_percent": round(100 * (counts["present"] + counts["late"]) / denominator, 2) if denominator else None,
        })
    return trends


@router.get("/summary", response_model=TenantDashboardSummary)
def dashboard_summary(
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _context(db, current_user, college_id, _SUMMARY_UNAVAILABLE)
    try:
        college = db.query(College.display_name, College.official_name).filter(
            College.id == context.college_id,
            College.status == "active",
        ).one_or_none()
        if college is None:
            raise HTTPException(status_code=503, detail=_SUMMARY_UNAVAILABLE)
        students = _owned_entity_counts(db, Student, context.college_id)
        face_registered, face_not_registered = _face_registration_counts(db, context.college_id, students.total)
        return TenantDashboardSummary(
            college_name=(college.display_name or "").strip() or college.official_name,
            students=students,
            teachers=_owned_entity_counts(db, Teacher, context.college_id),
            classes=_owned_entity_counts(db, Class, context.college_id),
            subjects=_owned_entity_counts(db, Subject, context.college_id),
            face_registered_count=face_registered,
            face_not_registered_count=face_not_registered,
        )
    except SQLAlchemyError as exc:
        db.rollback()
        _log_database_failure(exc, stage="ownership_metrics_query")
        raise HTTPException(status_code=503, detail=_SUMMARY_UNAVAILABLE) from exc


@router.get("/attendance-summary", response_model=TenantAttendanceSummary)
def attendance_summary(
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _context(db, current_user, college_id, _ATTENDANCE_UNAVAILABLE)
    try:
        college_id_value = context.college_id
        legacy_rows = _attendance_rows(db, college_id_value)
        legacy_count = int(db.query(func.count(legacy_rows.c.id)).scalar() or 0)

        event_rows = _verified_attendance_event_rows(db, college_id_value)
        event_totals = db.query(
            func.count(event_rows.c.id),
            func.coalesce(func.sum(case((event_rows.c.status == "present", 1), else_=0)), 0),
            func.coalesce(func.sum(case((event_rows.c.status == "late", 1), else_=0)), 0),
            func.coalesce(func.sum(case((event_rows.c.status == "absent", 1), else_=0)), 0),
        ).select_from(event_rows).one()
        event_total, event_present, event_late, event_absent = [int(value or 0) for value in event_totals]
        event_classified = event_present + event_late + event_absent

        record_rows = _attendance_record_rows(db, college_id_value)
        status_query = db.query(
            func.count(record_rows.c.id),
            func.coalesce(func.sum(case((record_rows.c.status == "present", 1), else_=0)), 0),
            func.coalesce(func.sum(case((record_rows.c.status == "late", 1), else_=0)), 0),
            func.coalesce(func.sum(case((record_rows.c.status == "absent", 1), else_=0)), 0),
        ).select_from(record_rows)
        total, present, late, absent = [int(value or 0) for value in status_query.one()]
        classified = present + late + absent
        unknown = total - classified
        rate = round(100 * (present + late) / classified, 2) if classified else None
        tracked_rows = []
        trends = []
        trend_start_date = None
        trend_partial = False
        trend_excluded_records = 0
        trend_available = False
        trend_reason = _TREND_UNAVAILABLE
        if has_effective_date_columns(db, TeacherAssignment) and has_effective_date_columns(db, StudentClassAssignment):
            tracked_rows = _historical_trend_rows(db, college_id_value)
            trends = _trend_summary(tracked_rows)
            if tracked_rows:
                trend_start_date = min(row[0] for row in tracked_rows).date().isoformat()
                trend_excluded_records = max(0, total - len(tracked_rows))
                trend_partial = trend_excluded_records > 0
                trend_available = True
                trend_reason = (
                    f"Trends start at {trend_start_date}. {trend_excluded_records} otherwise qualified records lack verified effective-date relationships and are excluded."
                    if trend_partial else ""
                )
            else:
                trend_reason = "No attendance records have verified enrollment and Teacher assignment intervals. Earliest reliable trend date: not established."
        return TenantAttendanceSummary(
            legacy_attendance_rows=legacy_count,
            attendance_record_rows=total,
            verified_attendance_event_rows=event_total,
            verified_present_events=event_present,
            verified_late_events=event_late,
            verified_absent_events=event_absent,
            verified_unclassified_events=event_total - event_classified,
            verified_classified_events_denominator=event_classified,
            verified_presence_rate_percent=round(100 * (event_present + event_late) / event_classified, 2) if event_classified else None,
            present_records=present,
            late_records=late,
            absent_records=absent,
            unclassified_status_records=unknown,
            classified_records_denominator=classified,
            recorded_presence_rate_percent=rate,
            trend_available=trend_available,
            trend_start_date=trend_start_date,
            trend_partial=trend_partial,
            trend_excluded_records=trend_excluded_records,
            trends=trends,
            trend_unavailable_reason=trend_reason,
        )
    except SQLAlchemyError as exc:
        db.rollback()
        _log_database_failure(exc, stage="attendance_qualification_query")
        raise HTTPException(status_code=503, detail=_ATTENDANCE_UNAVAILABLE) from exc
