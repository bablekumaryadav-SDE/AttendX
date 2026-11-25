from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import Subject
from app.schemas.subject import SubjectCreate, SubjectUpdate, SubjectResponse


router = APIRouter()


@router.post("/", response_model=SubjectResponse, status_code=status.HTTP_201_CREATED)
def create_subject(
    data: SubjectCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    existing = db.query(Subject).filter(Subject.code == data.code).first()

    if existing:
        raise HTTPException(
            status_code=400,
            detail="Subject code already exists",
        )

    subject = Subject(
        name=data.name,
        code=data.code,
        department=data.department,
    )

    db.add(subject)
    db.commit()
    db.refresh(subject)

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
    current_user=Depends(get_current_user),
):
    subject = db.query(Subject).filter(Subject.id == subject_id).first()

    if not subject:
        raise HTTPException(
            status_code=404,
            detail="Subject not found",
        )

    update_data = data.model_dump(exclude_unset=True)

    if "code" in update_data:
        existing = (
            db.query(Subject)
            .filter(
                Subject.code == update_data["code"],
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

    db.commit()
    db.refresh(subject)

    return subject


@router.delete("/{subject_id}")
def delete_subject(
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

    db.delete(subject)
    db.commit()

    return {
        "message": "Subject deleted successfully"
    }