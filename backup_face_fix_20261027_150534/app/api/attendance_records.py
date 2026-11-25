from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, get_current_teacher
from app.models import AttendanceRecord, Student, Teacher, User
from app.schemas.attendance_record import (
    AttendanceRecordCreate,
    AttendanceRecordUpdate,
    AttendanceRecordResponse,
)


router = APIRouter()

VALID_STATUSES = {"present", "absent", "late"}


def _get_teacher_profile(
    current_user: User,
    db: Session,
) -> Teacher:
    teacher = (
        db.query(Teacher)
        .filter(Teacher.email == current_user.email)
        .first()
    )

    if teacher is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Teacher profile not found.",
        )

    if not teacher.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Teacher profile is inactive.",
        )

    return teacher


def _get_student_profile(
    current_user: User,
    db: Session,
) -> Student:
    student = (
        db.query(Student)
        .filter(Student.email == current_user.email)
        .first()
    )

    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student profile not found.",
        )

    if not student.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Student profile is inactive.",
        )

    return student


def _scope_records(
    query,
    current_user: User,
    db: Session,
):
    """Logged-in user ke role ke mutabik records restrict karta hai."""
    role = str(current_user.role).lower()

    if role == "admin":
        return query

    if role == "teacher":
        teacher = _get_teacher_profile(current_user, db)

        return query.filter(
            AttendanceRecord.teacher_id == teacher.id
        )

    if role == "student":
        student = _get_student_profile(current_user, db)

        return query.filter(
            AttendanceRecord.student_id == student.id
        )

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Access denied.",
    )


def _check_status(attendance_status: str):
    normalized = str(attendance_status).strip().lower()

    if normalized not in VALID_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Status must be present, absent, or late.",
        )

    return normalized


def _check_teacher_ownership(
    current_user: User,
    record: AttendanceRecord,
    db: Session,
):
    """Teacher ko sirf apne records edit karne deta hai."""
    if str(current_user.role).lower() == "admin":
        return

    teacher = _get_teacher_profile(current_user, db)

    if record.teacher_id != teacher.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only manage your own attendance records.",
        )


@router.post(
    "/",
    response_model=AttendanceRecordResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_attendance(
    data: AttendanceRecordCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    role = str(current_user.role).lower()
    attendance_status = _check_status(data.status)

    # Teacher ko apni profile ke naam se hi attendance mark karni hogi.
    if role == "teacher":
        teacher = _get_teacher_profile(current_user, db)

        if data.teacher_id != teacher.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only mark attendance for your own teacher profile.",
            )

    # Student profile ka existence verify karein.
    student = (
        db.query(Student)
        .filter(Student.id == data.student_id)
        .first()
    )

    if student is None or not student.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Active student not found.",
        )

    # Teacher profile ka existence verify karein.
    teacher = (
        db.query(Teacher)
        .filter(Teacher.id == data.teacher_id)
        .first()
    )

    if teacher is None or not teacher.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Active teacher not found.",
        )

    # Duplicate record check.
    existing = (
        db.query(AttendanceRecord)
        .filter(
            AttendanceRecord.student_id == data.student_id,
            AttendanceRecord.subject_id == data.subject_id,
            AttendanceRecord.class_id == data.class_id,
            AttendanceRecord.attendance_date == data.attendance_date,
        )
        .first()
    )

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Attendance already marked for this student, subject, class and date.",
        )

    record = AttendanceRecord(
        student_id=data.student_id,
        teacher_id=data.teacher_id,
        subject_id=data.subject_id,
        class_id=data.class_id,
        attendance_date=data.attendance_date,
        status=attendance_status,
        remarks=data.remarks,
    )

    try:
        db.add(record)
        db.commit()
        db.refresh(record)
        return record
    except Exception:
        db.rollback()
        raise


@router.get(
    "/",
    response_model=list[AttendanceRecordResponse],
)
def get_attendance_records(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(AttendanceRecord)

    query = _scope_records(
        query,
        current_user,
        db,
    )

    return (
        query
        .order_by(
            AttendanceRecord.attendance_date.desc(),
            AttendanceRecord.id.desc(),
        )
        .all()
    )


@router.get(
    "/student/{student_id}",
    response_model=list[AttendanceRecordResponse],
)
def get_student_attendance(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    role = str(current_user.role).lower()

    if role == "student":
        student = _get_student_profile(current_user, db)

        if student.id != student_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only view your own attendance.",
            )

    query = db.query(AttendanceRecord).filter(
        AttendanceRecord.student_id == student_id
    )

    query = _scope_records(
        query,
        current_user,
        db,
    )

    return (
        query
        .order_by(AttendanceRecord.attendance_date.desc())
        .all()
    )


@router.get(
    "/{attendance_id}",
    response_model=AttendanceRecordResponse,
)
def get_attendance(
    attendance_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(AttendanceRecord).filter(
        AttendanceRecord.id == attendance_id
    )

    query = _scope_records(
        query,
        current_user,
        db,
    )

    record = query.first()

    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attendance record not found.",
        )

    return record


@router.put(
    "/{attendance_id}",
    response_model=AttendanceRecordResponse,
)
def update_attendance(
    attendance_id: int,
    data: AttendanceRecordUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    record = (
        db.query(AttendanceRecord)
        .filter(AttendanceRecord.id == attendance_id)
        .first()
    )

    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attendance record not found.",
        )

    _check_teacher_ownership(
        current_user,
        record,
        db,
    )

    if data.status is not None:
        record.status = _check_status(data.status)

    if data.remarks is not None:
        record.remarks = data.remarks

    try:
        db.commit()
        db.refresh(record)
        return record
    except Exception:
        db.rollback()
        raise


@router.delete("/{attendance_id}")
def delete_attendance(
    attendance_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    record = (
        db.query(AttendanceRecord)
        .filter(AttendanceRecord.id == attendance_id)
        .first()
    )

    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attendance record not found.",
        )

    _check_teacher_ownership(
        current_user,
        record,
        db,
    )

    try:
        db.delete(record)
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "message": "Attendance record deleted successfully."
    }