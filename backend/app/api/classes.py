from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import Class
from app.schemas.class_ import ClassCreate, ClassUpdate, ClassResponse


router = APIRouter()


@router.post("/", response_model=ClassResponse, status_code=status.HTTP_201_CREATED)
def create_class(
    data: ClassCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    class_obj = Class(
        name=data.name,
        section=data.section,
        department=data.department,
        semester=data.semester,
        academic_year=data.academic_year,
    )

    db.add(class_obj)
    db.commit()
    db.refresh(class_obj)

    return class_obj


@router.get("/", response_model=list[ClassResponse])
def get_classes(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return db.query(Class).order_by(Class.id.desc()).all()


@router.get("/{class_id}", response_model=ClassResponse)
def get_class(
    class_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    class_obj = db.query(Class).filter(Class.id == class_id).first()

    if not class_obj:
        raise HTTPException(
            status_code=404,
            detail="Class not found",
        )

    return class_obj


@router.put("/{class_id}", response_model=ClassResponse)
def update_class(
    class_id: int,
    data: ClassUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    class_obj = db.query(Class).filter(Class.id == class_id).first()

    if not class_obj:
        raise HTTPException(
            status_code=404,
            detail="Class not found",
        )

    update_data = data.model_dump(exclude_unset=True)

    for key, value in update_data.items():
        setattr(class_obj, key, value)

    db.commit()
    db.refresh(class_obj)

    return class_obj


@router.delete("/{class_id}")
def delete_class(
    class_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    class_obj = db.query(Class).filter(Class.id == class_id).first()

    if not class_obj:
        raise HTTPException(
            status_code=404,
            detail="Class not found",
        )

    db.delete(class_obj)
    db.commit()

    return {
        "message": "Class deleted successfully"
    }