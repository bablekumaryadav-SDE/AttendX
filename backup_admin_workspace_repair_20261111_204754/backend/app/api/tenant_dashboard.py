"""Tenant-scoped read-only Admin dashboard aggregates."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, case, func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import (
    Attendance,
    AttendanceRecord,
    Class,
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


router = APIRouter(prefix="/tenant/dashboard", tags=["Tenant Dashboard"])
READ_ROLES = frozenset({"college_admin"})
_SUMMARY_UNAVAILABLE = "College dashboard summary is unavailable."
_ATTENDANCE_UNAVAILABLE = "College attendance summary is unavailable."
_TREND_UNAVAILABLE = (
    "Attendance trends are unavailable because assignment and enrollment effective dates are not recorded."
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


@router.get("/summary", response_model=TenantDashboardSummary)
def dashboard_summary(
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _context(db, current_user, college_id, _SUMMARY_UNAVAILABLE)
    try:
        return TenantDashboardSummary(
            students=_owned_entity_counts(db, Student, context.college_id),
            teachers=_owned_entity_counts(db, Teacher, context.college_id),
            classes=_owned_entity_counts(db, Class, context.college_id),
            subjects=_owned_entity_counts(db, Subject, context.college_id),
        )
    except SQLAlchemyError as exc:
        db.rollback()
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
        return TenantAttendanceSummary(
            legacy_attendance_rows=legacy_count,
            attendance_record_rows=total,
            present_records=present,
            late_records=late,
            absent_records=absent,
            unclassified_status_records=unknown,
            classified_records_denominator=classified,
            recorded_presence_rate_percent=rate,
            trend_available=False,
            trend_unavailable_reason=_TREND_UNAVAILABLE,
        )
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=_ATTENDANCE_UNAVAILABLE) from exc
