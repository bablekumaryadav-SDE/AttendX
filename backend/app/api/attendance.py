from datetime import datetime, time, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, get_current_teacher
from app.models import Attendance, Student, Teacher
from app.schemas.attendance import (
    AttendanceCreate,
    AttendanceUpdate,
    AttendanceResponse,
)


router = APIRouter()


def _role(current_user):
    value = current_user.get("role") if hasattr(current_user, "get") else current_user.role
    return str(value or "").strip().lower()


def _profile_id(db: Session, current_user, role: str):
    email = current_user.get("email") if hasattr(current_user, "get") else current_user.email
    model = Teacher if role == "teacher" else Student
    query = db.query(model.id).filter(func.lower(model.email) == str(email or "").lower())
    if hasattr(model, "is_active"):
        query = query.filter(model.is_active.is_(True))
    profile_id = query.scalar()
    if not profile_id:
        raise HTTPException(status_code=404, detail=f"Active {role} profile not found.")
    return int(profile_id)


def _scoped_query(db: Session, query, current_user):
    role = _role(current_user)
    if role == "admin":
        return query
    if role == "teacher":
        return query.filter(Attendance.teacher_id == _profile_id(db, current_user, role))
    if role == "student":
        return query.filter(Attendance.student_id == _profile_id(db, current_user, role))
    raise HTTPException(status_code=403, detail="Access denied.")


def _require_teacher_owner(db: Session, record: Attendance, current_user):
    if _role(current_user) == "admin":
        return
    teacher_id = _profile_id(db, current_user, "teacher")
    if record.teacher_id != teacher_id:
        raise HTTPException(status_code=403, detail="You can only manage your own attendance records.")


def _attendance_datetime(value):
    if isinstance(value, datetime):
        return value
    return datetime.combine(value, time.min, tzinfo=timezone.utc)


@router.post(
    "/",
    response_model=AttendanceResponse,
)
def create_attendance(
    attendance: AttendanceCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_teacher),
):
    role = _role(current_user)
    teacher = db.query(Teacher).filter(Teacher.id == attendance.teacher_id, Teacher.is_active.is_(True)).first()
    student = db.query(Student).filter(Student.id == attendance.student_id, Student.is_active.is_(True)).first()
    if not teacher or not student:
        raise HTTPException(status_code=404, detail="Active student and teacher profiles are required.")
    if role == "teacher" and attendance.teacher_id != _profile_id(db, current_user, role):
        raise HTTPException(status_code=403, detail="You can only mark attendance for your own teacher profile.")

    new_attendance = Attendance(
        student_id=attendance.student_id,
        teacher_id=attendance.teacher_id,
        date=_attendance_datetime(attendance.date),
        status=attendance.status,
    )

    try:
        db.add(new_attendance)
        db.commit()
        db.refresh(new_attendance)
    except Exception:
        db.rollback()
        raise

    return new_attendance


@router.get(
    "/",
    response_model=list[AttendanceResponse],
)
def get_attendance(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return _scoped_query(
        db,
        db.query(Attendance),
        current_user,
    ).order_by(Attendance.id.desc()).all()


@router.get(
    "/{attendance_id}",
    response_model=AttendanceResponse,
)
def get_attendance_by_id(
    attendance_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    attendance = _scoped_query(
        db,
        db.query(Attendance).filter(Attendance.id == attendance_id),
        current_user,
    ).first()

    if not attendance:
        raise HTTPException(
            status_code=404,
            detail="Attendance record not found",
        )

    return attendance


@router.put(
    "/{attendance_id}",
    response_model=AttendanceResponse,
)
def update_attendance(
    attendance_id: int,
    attendance_data: AttendanceUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_teacher),
):
    attendance = db.query(Attendance).filter(
        Attendance.id == attendance_id
    ).first()

    if not attendance:
        raise HTTPException(
            status_code=404,
            detail="Attendance record not found",
        )

    update_data = attendance_data.model_dump(
        exclude_unset=True
    )
    if update_data.get("date") is not None:
        update_data["date"] = _attendance_datetime(update_data["date"])

    _require_teacher_owner(db, attendance, current_user)
    if _role(current_user) == "teacher" and update_data.get("teacher_id", attendance.teacher_id) != attendance.teacher_id:
        raise HTTPException(status_code=403, detail="You cannot transfer attendance to another teacher.")
    if "student_id" in update_data and not db.query(Student.id).filter(
        Student.id == update_data["student_id"], Student.is_active.is_(True)
    ).first():
        raise HTTPException(status_code=404, detail="Active student not found.")

    for field, value in update_data.items():
        setattr(attendance, field, value)

    try:
        db.commit()
        db.refresh(attendance)
    except Exception:
        db.rollback()
        raise

    return attendance


@router.delete(
    "/{attendance_id}",
)
def delete_attendance(
    attendance_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_teacher),
):
    attendance = db.query(Attendance).filter(
        Attendance.id == attendance_id
    ).first()

    if not attendance:
        raise HTTPException(
            status_code=404,
            detail="Attendance record not found",
        )

    _require_teacher_owner(db, attendance, current_user)

    try:
        db.delete(attendance)
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "message": "Attendance record deleted successfully"
    }
