from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_admin, get_current_user
from app.models import Class
from app.schemas.class_ import ClassCreate, ClassUpdate, ClassResponse


router = APIRouter()


@router.post("/", response_model=ClassResponse, status_code=status.HTTP_201_CREATED)
def create_class(
    data: ClassCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_admin),
):
    duplicate = db.query(Class).filter(
        Class.name.ilike(data.name.strip()),
        Class.section == data.section,
        Class.academic_year == data.academic_year,
        Class.is_active.is_(True),
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="An active class with this name, section and year already exists.")
    class_obj = Class(
        name=data.name.strip(),
        section=data.section,
        department=data.department,
        semester=data.semester,
        academic_year=data.academic_year,
    )

    db.add(class_obj)
    try:
        db.commit()
        db.refresh(class_obj)
    except Exception:
        db.rollback()
        raise

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
    current_user=Depends(get_current_admin),
):
    class_obj = db.query(Class).filter(Class.id == class_id).first()

    if not class_obj:
        raise HTTPException(
            status_code=404,
            detail="Class not found",
        )

    update_data = data.model_dump(exclude_unset=True)

    candidate_name = update_data.get("name", class_obj.name)
    candidate_section = update_data.get("section", class_obj.section)
    candidate_year = update_data.get("academic_year", class_obj.academic_year)
    duplicate = db.query(Class).filter(
        Class.name.ilike(str(candidate_name).strip()),
        Class.section == candidate_section,
        Class.academic_year == candidate_year,
        Class.is_active.is_(True),
        Class.id != class_id,
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="An active class with this name, section and year already exists.")

    for key, value in update_data.items():
        setattr(class_obj, key, value)

    try:
        db.commit()
        db.refresh(class_obj)
    except Exception:
        db.rollback()
        raise

    return class_obj


@router.delete("/{class_id}")
def delete_class(
    class_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_admin),
):
    class_obj = db.query(Class).filter(Class.id == class_id).first()

    if not class_obj:
        raise HTTPException(
            status_code=404,
            detail="Class not found",
        )

    class_obj.is_active = False
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "message": "Class deactivated successfully"
    }
