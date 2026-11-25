"""Read-only, College-scoped views over legacy attendance tables."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_
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
from app.schemas.tenant_attendance import (
    TenantAttendanceRecordResponse,
    TenantAttendanceResponse,
)
from app.tenant_context import resolve_tenant_context


attendance_router = APIRouter()
attendance_records_router = APIRouter()
READ_ROLES = frozenset({"college_admin"})
_ATTENDANCE_UNAVAILABLE = "College-scoped attendance history is unavailable."
_RECORDS_UNAVAILABLE = "College-scoped attendance records are unavailable."
_NOT_FOUND = "Record not found."


def _context(db: Session, user, college_id: Optional[int], unavailable: str):
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
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=unavailable) from exc


def _unavailable(message: str, exc: Exception):
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=message)


def _attendance_query(db: Session, college_id: int):
    # Inner joins deliberately omit records with missing, NULL, or differently
    # owned Student/Teacher parents, even if production constraints are absent.
    return (
        db.query(Attendance)
        .join(Student, and_(Student.id == Attendance.student_id, Student.college_id == Attendance.college_id))
        .join(Teacher, and_(Teacher.id == Attendance.teacher_id, Teacher.college_id == Attendance.college_id))
        .filter(Attendance.college_id == college_id, Attendance.college_id.is_not(None))
    )


def _record_query(db: Session, college_id: int):
    # All four linked entities must independently carry the same explicit
    # College ownership. No name/email/ID-only inference is used.
    return (
        db.query(AttendanceRecord)
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
    )


@attendance_router.get("/", response_model=list[TenantAttendanceResponse])
def list_tenant_attendance(
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _context(db, current_user, college_id, _ATTENDANCE_UNAVAILABLE)
    try:
        return _attendance_query(db, context.college_id).order_by(Attendance.date.desc(), Attendance.id.desc()).all()
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable(_ATTENDANCE_UNAVAILABLE, exc)


@attendance_router.get("/{attendance_id}", response_model=TenantAttendanceResponse)
def read_tenant_attendance(
    attendance_id: int,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _context(db, current_user, college_id, _ATTENDANCE_UNAVAILABLE)
    try:
        row = _attendance_query(db, context.college_id).filter(Attendance.id == attendance_id).one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail=_NOT_FOUND)
        return row
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable(_ATTENDANCE_UNAVAILABLE, exc)


@attendance_records_router.get("/", response_model=list[TenantAttendanceRecordResponse])
def list_tenant_attendance_records(
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _context(db, current_user, college_id, _RECORDS_UNAVAILABLE)
    try:
        return _record_query(db, context.college_id).order_by(AttendanceRecord.attendance_date.desc(), AttendanceRecord.id.desc()).all()
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable(_RECORDS_UNAVAILABLE, exc)


@attendance_records_router.get("/{record_id}", response_model=TenantAttendanceRecordResponse)
def read_tenant_attendance_record(
    record_id: int,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _context(db, current_user, college_id, _RECORDS_UNAVAILABLE)
    try:
        row = _record_query(db, context.college_id).filter(AttendanceRecord.id == record_id).one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail=_NOT_FOUND)
        return row
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable(_RECORDS_UNAVAILABLE, exc)
