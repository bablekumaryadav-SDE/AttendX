
import hashlib
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.dependencies import (
    get_current_admin,
    get_current_user,
)
from app.models import FaceEmbedding, Student, User
from app.schemas.student import (
    StudentCreate,
    StudentUpdate,
    StudentResponse,
)
from app.security import get_password_hash
from app.services.student_module import next_student_code


router = APIRouter()

MAX_FACE_IMAGE_BYTES = 5 * 1024 * 1024

ALLOWED_FACE_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
}


def _student_query(db: Session):
    return db.query(Student).options(
        selectinload(Student.face_registration)
    )


def _normalize_email(value: str) -> str:
    return value.strip().lower()


def _normalize_roll(value: str) -> str:
    return value.strip().upper()


def _student_or_404(db: Session, student_id: int) -> Student:
    student = (
        _student_query(db)
        .filter(Student.id == student_id)
        .first()
    )

    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found.",
        )

    return student


def _linked_student_user(
    db: Session,
    email: str,
) -> User | None:
    return (
        db.query(User)
        .filter(func.lower(User.email) == email.lower())
        .first()
    )


def _validate_face_file(
    content_type: str | None,
    data: bytes,
) -> None:
    if content_type not in ALLOWED_FACE_TYPES:
        raise HTTPException(
            status_code=415,
            detail="Please upload a JPG, PNG, or WEBP face image.",
        )

    if not data:
        raise HTTPException(
            status_code=400,
            detail="Face image is empty.",
        )

    if len(data) > MAX_FACE_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Face image must be smaller than 5 MB.",
        )

    valid_signature = (
        data.startswith(b"\xff\xd8\xff")
        or data.startswith(b"\x89PNG\r\n\x1a\n")
        or (
            data.startswith(b"RIFF")
            and b"WEBP" in data[:16]
        )
    )

    if not valid_signature:
        raise HTTPException(
            status_code=400,
            detail="The uploaded file is not a valid supported image.",
        )


# =========================================================
# GET ALL STUDENTS
# =========================================================

@router.get(
    "/",
    response_model=list[StudentResponse],
)
def get_students(
    search: str | None = Query(default=None, max_length=100),
    active_only: bool = False,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    query = _student_query(db)

    if active_only:
        query = query.filter(Student.is_active.is_(True))

    if search and search.strip():
        term = f"%{search.strip()}%"

        query = query.filter(
            (Student.name.ilike(term))
            | (Student.email.ilike(term))
            | (Student.roll_number.ilike(term))
            | (Student.student_code.ilike(term))
            | (Student.department.ilike(term))
        )

    return query.order_by(Student.id.desc()).all()


# =========================================================
# GET SINGLE STUDENT
# =========================================================

@router.get(
    "/{student_id}",
    response_model=StudentResponse,
)
def get_student(
    student_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return _student_or_404(db, student_id)


# =========================================================
# CREATE STUDENT + LOGIN ACCOUNT
# =========================================================

@router.post(
    "/",
    response_model=StudentResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_student(
    data: StudentCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_admin),
):
    email = _normalize_email(str(data.email))
    roll_number = _normalize_roll(data.roll_number)
    name = data.name.strip()

    if len(name) < 2:
        raise HTTPException(
            status_code=422,
            detail="Student name must contain at least 2 characters.",
        )

    if not data.password.strip():
        raise HTTPException(
            status_code=422,
            detail="Student password cannot be empty.",
        )

    # Check duplicate student email.
    duplicate_email = (
        db.query(Student)
        .filter(func.lower(Student.email) == email)
        .first()
    )

    if duplicate_email:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A student with this email already exists.",
        )

    # Check duplicate student roll number.
    duplicate_roll = (
        db.query(Student)
        .filter(func.upper(Student.roll_number) == roll_number)
        .first()
    )

    if duplicate_roll:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A student with this roll number already exists.",
        )

    # The login email must be unique across all user roles.
    existing_user = _linked_student_user(db, email)

    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A login account already exists for this email.",
        )

    student = Student(
        student_code=next_student_code(db),
        name=name,
        email=email,
        roll_number=roll_number,
        department=(
            data.department.strip()
            if data.department and data.department.strip()
            else None
        ),
        is_active=True,
    )

    user = User(
        name=name,
        email=email,
        hashed_password=get_password_hash(data.password),
        role="student",
        is_active=True,
    )

    try:
        db.add(student)
        db.add(user)
        db.commit()
        db.refresh(student)

    except IntegrityError as exc:
        db.rollback()

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Student registration conflicted with an existing "
                "student or login account. Check the email and roll number."
            ),
        ) from exc

    return student


# =========================================================
# UPDATE STUDENT
# =========================================================

@router.put(
    "/{student_id}",
    response_model=StudentResponse,
)
def update_student(
    student_id: int,
    data: StudentUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_admin),
):
    student = _student_or_404(db, student_id)

    update_data = data.model_dump(exclude_unset=True)

    old_email = _normalize_email(student.email)
    new_email = old_email

    if (
        "email" in update_data
        and update_data["email"] is not None
    ):
        new_email = _normalize_email(str(update_data["email"]))

        duplicate_student = (
            db.query(Student)
            .filter(
                func.lower(Student.email) == new_email,
                Student.id != student_id,
            )
            .first()
        )

        if duplicate_student:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A student with this email already exists.",
            )

        linked_user = _linked_student_user(db, old_email)

        email_owner = _linked_student_user(db, new_email)

        if email_owner and (
            not linked_user or email_owner.id != linked_user.id
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A login account already uses this email.",
            )

        update_data["email"] = new_email

    if (
        "roll_number" in update_data
        and update_data["roll_number"] is not None
    ):
        new_roll = _normalize_roll(update_data["roll_number"])

        duplicate_roll = (
            db.query(Student)
            .filter(
                func.upper(Student.roll_number) == new_roll,
                Student.id != student_id,
            )
            .first()
        )

        if duplicate_roll:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A student with this roll number already exists.",
            )

        update_data["roll_number"] = new_roll

    if (
        "name" in update_data
        and update_data["name"] is not None
    ):
        update_data["name"] = update_data["name"].strip()

        if len(update_data["name"]) < 2:
            raise HTTPException(
                status_code=422,
                detail="Student name must contain at least 2 characters.",
            )

    if (
        "department" in update_data
        and update_data["department"] is not None
    ):
        update_data["department"] = (
            update_data["department"].strip() or None
        )

    try:
        for key, value in update_data.items():
            setattr(student, key, value)

        # Keep the linked login account in sync with the profile.
        linked_user = _linked_student_user(db, old_email)

        if linked_user:
            if "name" in update_data:
                linked_user.name = update_data["name"]

            if "email" in update_data:
                linked_user.email = new_email

            if "is_active" in update_data:
                linked_user.is_active = update_data["is_active"]

        db.commit()
        db.refresh(student)

    except IntegrityError as exc:
        db.rollback()

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Student details conflict with an existing record.",
        ) from exc

    return student


# =========================================================
# DEACTIVATE STUDENT
# =========================================================

@router.delete("/{student_id}")
def deactivate_student(
    student_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_admin),
):
    student = _student_or_404(db, student_id)

    if not student.is_active:
        return {"message": "Student is already inactive."}

    student.is_active = False

    user = _linked_student_user(db, student.email)

    if user:
        user.is_active = False

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Unable to deactivate student.",
        ) from exc

    return {"message": "Student deactivated successfully."}


# =========================================================
# ACTIVATE STUDENT
# =========================================================

@router.post(
    "/{student_id}/activate",
    response_model=StudentResponse,
)
def activate_student(
    student_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_admin),
):
    student = _student_or_404(db, student_id)

    student.is_active = True

    user = _linked_student_user(db, student.email)

    if user:
        user.is_active = True

    try:
        db.commit()
        db.refresh(student)
    except IntegrityError as exc:
        db.rollback()

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Unable to activate student.",
        ) from exc

    return student


# =========================================================
# REGISTER STUDENT FACE
# =========================================================

@router.post(
    "/{student_id}/face",
    response_model=StudentResponse,
)
async def register_student_face(
    student_id: int,
    file: Annotated[UploadFile, File(...)],
    db: Session = Depends(get_db),
    current_user=Depends(get_current_admin),
):
    student = _student_or_404(db, student_id)

    if not student.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Activate the student before registering a face.",
        )

    data = await file.read()

    _validate_face_file(file.content_type, data)

    image_hash = hashlib.sha256(data).hexdigest()

    duplicate_image = (
        db.query(FaceEmbedding)
        .filter(
            FaceEmbedding.image_sha256 == image_hash,
            FaceEmbedding.student_id != student_id,
        )
        .first()
    )

    if duplicate_image:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This face image is already registered to another student.",
        )

    registration = student.face_registration

    if registration is None:
        registration = FaceEmbedding(student_id=student.id)
        db.add(registration)

    registration.image_data = data
    registration.mime_type = file.content_type or "image/jpeg"
    registration.image_sha256 = image_hash
    registration.status = "registered"
    registration.embedding_json = None

    try:
        db.commit()
        db.refresh(student)
    except IntegrityError as exc:
        db.rollback()

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Unable to save face registration.",
        ) from exc

    return student


# =========================================================
# REMOVE STUDENT FACE
# =========================================================

@router.delete("/{student_id}/face")
def remove_student_face(
    student_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_admin),
):
    _student_or_404(db, student_id)

    registration = (
        db.query(FaceEmbedding)
        .filter(FaceEmbedding.student_id == student_id)
        .first()
    )

    if registration:
        db.delete(registration)
        db.commit()

    return {"message": "Face registration removed successfully."}
