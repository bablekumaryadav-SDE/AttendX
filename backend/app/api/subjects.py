from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_admin, get_current_user
from app.models import Subject, TeacherAssignment
from app.schemas.subject import SubjectCreate, SubjectUpdate, SubjectResponse


router = APIRouter()


@router.post("/", response_model=SubjectResponse, status_code=status.HTTP_201_CREATED)
def create_subject(
    data: SubjectCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_admin),
):
    name = data.name.strip()
    code = data.code.strip().upper()
    if not name or not code:
        raise HTTPException(status_code=422, detail="Subject name and code cannot be empty.")
    existing = db.query(Subject).filter(Subject.code.ilike(code)).first()

    if existing:
        raise HTTPException(
            status_code=400,
            detail="Subject code already exists",
        )

    subject = Subject(
        name=name,
        code=code,
        department=data.department,
    )

    try:
        db.add(subject)
        db.commit()
        db.refresh(subject)
    except Exception:
        db.rollback()
        raise

    return subject


@router.get("/", response_model=list[SubjectResponse])
def get_subjects(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return db.query(Subject).order_by(Subject.id.desc()).all()


@router.get("/{subject_id}", response_model=SubjectResponse)
def get_subject(
    subject_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    subject = db.query(Subject).filter(Subject.id == subject_id).first()

    if not subject:
        raise HTTPException(
            status_code=404,
            detail="Subject not found",
        )

    return subject


@router.put("/{subject_id}", response_model=SubjectResponse)
def update_subject(
    subject_id: int,
    data: SubjectUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_admin),
):
    subject = db.query(Subject).filter(Subject.id == subject_id).first()

    if not subject:
        raise HTTPException(
            status_code=404,
            detail="Subject not found",
        )

    update_data = data.model_dump(exclude_unset=True)

    for field in ("name", "code"):
        if field in update_data and update_data[field] is None:
            raise HTTPException(status_code=422, detail=f"Subject {field} cannot be empty.")
        if field in update_data:
            update_data[field] = update_data[field].strip()
            if not update_data[field]:
                raise HTTPException(status_code=422, detail=f"Subject {field} cannot be empty.")

    if "code" in update_data and update_data["code"] is not None:
        update_data["code"] = update_data["code"].strip().upper()

    if "code" in update_data:
        existing = (
            db.query(Subject)
            .filter(
                Subject.code.ilike(update_data["code"]),
                Subject.id != subject_id,
            )
            .first()
        )

        if existing:
            raise HTTPException(
                status_code=400,
                detail="Subject code already exists",
            )

    for key, value in update_data.items():
        setattr(subject, key, value)

    try:
        db.commit()
        db.refresh(subject)
    except Exception:
        db.rollback()
        raise

    return subject


@router.delete("/{subject_id}")
def delete_subject(
    subject_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_admin),
):
    subject = db.query(Subject).filter(Subject.id == subject_id).first()

    if not subject:
        raise HTTPException(
            status_code=404,
            detail="Subject not found",
        )

    subject.is_active = False
    for assignment in db.query(TeacherAssignment).filter(
        TeacherAssignment.subject_id == subject_id,
        TeacherAssignment.is_active.is_(True),
    ):
        assignment.is_active = False
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "message": "Subject deactivated successfully"
    }
