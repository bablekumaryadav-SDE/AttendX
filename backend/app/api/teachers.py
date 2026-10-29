from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_admin
from app.models import (
    Class,
    Subject,
    Teacher,
    TeacherAssignment,
    User,
)
from app.security import get_password_hash


router = APIRouter()


# =========================================================
# SCHEMAS
# =========================================================


class TeacherCreate(BaseModel):
    """
    Create a real teacher profile + teacher login account.
    """

    name: str = Field(
        min_length=2,
        max_length=100,
    )

    email: EmailStr

    employee_id: str | None = Field(
        default=None,
        max_length=50,
    )

    department: str | None = Field(
        default=None,
        max_length=100,
    )

    password: str = Field(
        min_length=8,
        max_length=72,
    )


class TeacherUpdate(BaseModel):
    """
    Update an existing teacher profile.
    """

    name: str = Field(
        min_length=2,
        max_length=100,
    )

    email: EmailStr

    employee_id: str = Field(
        min_length=2,
        max_length=50,
    )

    department: str | None = Field(
        default=None,
        max_length=100,
    )


class TeacherResponse(BaseModel):
    """
    Public teacher response returned to the admin frontend.
    """

    model_config = ConfigDict(
        from_attributes=True
    )

    id: int
    name: str
    email: str
    employee_id: str
    department: str | None
    is_active: bool
    created_at: datetime | None


class AssignmentSummary(BaseModel):
    """
    Joined teacher assignment information.
    """

    assignment_id: int
    subject_id: int
    subject_name: str
    subject_code: str
    class_id: int
    class_name: str
    section: str | None
    academic_year: str | None
    semester: int | None


# =========================================================
# HELPERS
# =========================================================


def _clean(value: str | None) -> str | None:
    """
    Normalize optional text fields.
    """

    if value is None:
        return None

    value = " ".join(
        value.strip().split()
    )

    return value or None


def _next_teacher_id(db: Session) -> str:
    """
    Generate a readable AttendX teacher ID.

    Example:
        ATX-TCH-2026-0001
        ATX-TCH-2026-0002
    """

    year = datetime.now(
        timezone.utc
    ).year

    prefix = f"ATX-TCH-{year}-"

    last = (
        db.query(Teacher)
        .filter(
            Teacher.employee_id.like(
                f"{prefix}%"
            )
        )
        .order_by(
            Teacher.id.desc()
        )
        .first()
    )

    number = 0

    if last and last.employee_id:
        try:
            number = int(
                last.employee_id.rsplit(
                    "-",
                    1,
                )[-1]
            )
        except ValueError:
            number = 0

    return (
        f"{prefix}"
        f"{number + 1:04d}"
    )


def _teacher_or_404(
    db: Session,
    teacher_id: int,
) -> Teacher:
    """
    Get teacher or raise HTTP 404.
    """

    teacher = (
        db.query(Teacher)
        .filter(
            Teacher.id == teacher_id
        )
        .first()
    )

    if not teacher:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Teacher not found",
        )

    return teacher


# =========================================================
# GET ALL TEACHERS
# =========================================================


@router.get(
    "/",
    response_model=list[TeacherResponse],
)
def get_teachers(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_admin),
):
    """
    Return all teachers for the admin directory.
    """

    return (
        db.query(Teacher)
        .order_by(
            Teacher.id.desc()
        )
        .all()
    )


# =========================================================
# GET SINGLE TEACHER
# =========================================================


@router.get(
    "/{teacher_id}",
    response_model=TeacherResponse,
)
def get_teacher(
    teacher_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_admin),
):
    """
    Return one teacher profile.
    """

    return _teacher_or_404(
        db,
        teacher_id,
    )


# =========================================================
# CREATE TEACHER
# =========================================================


@router.post(
    "/",
    response_model=TeacherResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_teacher(
    data: TeacherCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_admin),
):
    """
    Create:

    1. Teacher profile
    2. Teacher login account

    No default/fake password is generated.
    The admin must provide the initial password.
    """

    email = (
        str(data.email)
        .strip()
        .lower()
    )

    name = _clean(
        data.name
    )

    department = _clean(
        data.department
    )

    employee_id = (
        _clean(data.employee_id)
        or _next_teacher_id(db)
    )

    # -----------------------------------------------------
    # Duplicate teacher email
    # -----------------------------------------------------

    existing_teacher = (
        db.query(Teacher)
        .filter(
            Teacher.email == email
        )
        .first()
    )

    if existing_teacher:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Teacher email already exists",
        )

    # -----------------------------------------------------
    # Duplicate login email
    # -----------------------------------------------------

    existing_user = (
        db.query(User)
        .filter(
            User.email == email
        )
        .first()
    )

    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "A login account already "
                "exists for this email"
            ),
        )

    # -----------------------------------------------------
    # Duplicate Teacher ID
    # -----------------------------------------------------

    existing_id = (
        db.query(Teacher)
        .filter(
            Teacher.employee_id
            == employee_id
        )
        .first()
    )

    if existing_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Teacher ID already exists",
        )

    # -----------------------------------------------------
    # Build records
    # -----------------------------------------------------

    teacher = Teacher(
        name=name,
        email=email,
        employee_id=employee_id,
        department=department,
        is_active=True,
    )

    user = User(
        name=name,
        email=email,
        hashed_password=get_password_hash(
            data.password
        ),
        role="teacher",
        is_active=True,
    )

    try:
        db.add(teacher)
        db.add(user)

        db.commit()

        db.refresh(teacher)

    except IntegrityError:
        db.rollback()

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Teacher details conflict "
                "with an existing record"
            ),
        )

    return teacher


# =========================================================
# UPDATE TEACHER
# =========================================================


@router.put(
    "/{teacher_id}",
    response_model=TeacherResponse,
)
def update_teacher(
    teacher_id: int,
    data: TeacherUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_admin),
):
    """
    Update teacher profile.

    The linked login account is also synchronized
    when one exists.
    """

    teacher = _teacher_or_404(
        db,
        teacher_id,
    )

    email = (
        str(data.email)
        .strip()
        .lower()
    )

    employee_id = _clean(
        data.employee_id
    )

    name = _clean(
        data.name
    )

    department = _clean(
        data.department
    )

    # -----------------------------------------------------
    # Duplicate teacher email
    # -----------------------------------------------------

    duplicate_teacher = (
        db.query(Teacher)
        .filter(
            Teacher.email == email,
            Teacher.id != teacher_id,
        )
        .first()
    )

    if duplicate_teacher:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Teacher email already exists",
        )

    # -----------------------------------------------------
    # Duplicate Teacher ID
    # -----------------------------------------------------

    duplicate_id = (
        db.query(Teacher)
        .filter(
            Teacher.employee_id
            == employee_id,
            Teacher.id != teacher_id,
        )
        .first()
    )

    if duplicate_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Teacher ID already exists",
        )

    # -----------------------------------------------------
    # Locate linked user using OLD teacher email
    # -----------------------------------------------------

    linked_user = (
        db.query(User)
        .filter(
            User.email == teacher.email
        )
        .first()
    )

    # -----------------------------------------------------
    # Check whether the new email belongs
    # to another login account
    # -----------------------------------------------------

    linked_user_id = (
        linked_user.id
        if linked_user
        else -1
    )

    email_owner = (
        db.query(User)
        .filter(
            User.email == email,
            User.id != linked_user_id,
        )
        .first()
    )

    if email_owner:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "A login account already "
                "uses this email"
            ),
        )

    # -----------------------------------------------------
    # Update teacher
    # -----------------------------------------------------

    teacher.name = name
    teacher.email = email
    teacher.employee_id = employee_id
    teacher.department = department

    # -----------------------------------------------------
    # Keep linked login account synchronized
    # -----------------------------------------------------

    if linked_user:
        linked_user.name = name
        linked_user.email = email

    try:
        db.commit()
        db.refresh(teacher)

    except IntegrityError:
        db.rollback()

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Unable to update teacher because "
                "the email or ID is already in use"
            ),
        )

    return teacher


# =========================================================
# DEACTIVATE TEACHER
# =========================================================


@router.delete(
    "/{teacher_id}"
)
def deactivate_teacher(
    teacher_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_admin),
):
    """
    Soft deactivate teacher.

    Teacher record remains in PostgreSQL.
    Login access is disabled.
    """

    teacher = _teacher_or_404(
        db,
        teacher_id,
    )

    teacher.is_active = False

    user = (
        db.query(User)
        .filter(
            User.email == teacher.email
        )
        .first()
    )

    if user:
        user.is_active = False

    db.commit()

    return {
        "message": (
            "Teacher deactivated successfully"
        )
    }


# =========================================================
# ACTIVATE TEACHER
# =========================================================


@router.post(
    "/{teacher_id}/activate",
    response_model=TeacherResponse,
)
def activate_teacher(
    teacher_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_admin),
):
    """
    Reactivate teacher and linked login account.
    """

    teacher = _teacher_or_404(
        db,
        teacher_id,
    )

    teacher.is_active = True

    user = (
        db.query(User)
        .filter(
            User.email == teacher.email
        )
        .first()
    )

    if user:
        user.is_active = True

    db.commit()
    db.refresh(teacher)

    return teacher


# =========================================================
# GET TEACHER ASSIGNMENTS
# =========================================================


@router.get(
    "/{teacher_id}/assignments",
    response_model=list[AssignmentSummary],
)
def get_teacher_assignments(
    teacher_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_admin),
):
    """
    Return active subject/class assignments
    for a teacher.
    """

    _teacher_or_404(
        db,
        teacher_id,
    )

    rows = (
        db.query(
            TeacherAssignment,
            Subject,
            Class,
        )
        .join(
            Subject,
            TeacherAssignment.subject_id
            == Subject.id,
        )
        .join(
            Class,
            TeacherAssignment.class_id
            == Class.id,
        )
        .filter(
            TeacherAssignment.teacher_id
            == teacher_id,
            TeacherAssignment.is_active.is_(True),
        )
        .order_by(
            TeacherAssignment.id.desc()
        )
        .all()
    )

    return [
        AssignmentSummary(
            assignment_id=assignment.id,
            subject_id=subject.id,
            subject_name=subject.name,
            subject_code=subject.code,
            class_id=class_item.id,
            class_name=class_item.name,
            section=class_item.section,
            academic_year=assignment.academic_year,
            semester=assignment.semester,
        )
        for (
            assignment,
            subject,
            class_item,
        ) in rows
    ]