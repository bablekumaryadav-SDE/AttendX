from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_admin
from app.models import Class, Subject, Teacher, TeacherAssignment
from app.schemas.assignment import (
    AssignmentCreate,
    AssignmentUpdate,
    AssignmentResponse,
)


router = APIRouter()


def _validate_references(db: Session, teacher_id: int, subject_id: int, class_id: int):
    teacher = db.query(Teacher).filter(Teacher.id == teacher_id).first()
    subject = db.query(Subject).filter(Subject.id == subject_id).first()
    class_ = db.query(Class).filter(Class.id == class_id).first()
    if not teacher or not teacher.is_active:
        raise HTTPException(status_code=422, detail="Select an active teacher.")
    if not subject or not subject.is_active:
        raise HTTPException(status_code=422, detail="Select an active subject.")
    if not class_ or not class_.is_active:
        raise HTTPException(status_code=422, detail="Select an active class.")


def _duplicate_query(db: Session, teacher_id: int, subject_id: int, class_id: int,
                     academic_year: str | None, semester: int | None, exclude_id: int | None = None):
    query = db.query(TeacherAssignment).filter(
        TeacherAssignment.teacher_id == teacher_id,
        TeacherAssignment.subject_id == subject_id,
        TeacherAssignment.class_id == class_id,
        TeacherAssignment.academic_year == academic_year,
        TeacherAssignment.semester == semester,
        TeacherAssignment.is_active.is_(True),
    )
    if exclude_id is not None:
        query = query.filter(TeacherAssignment.id != exclude_id)
    return query.first()


@router.post(
    "/",
    response_model=AssignmentResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_assignment(
    data: AssignmentCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_admin),
):
    _validate_references(db, data.teacher_id, data.subject_id, data.class_id)
    existing = _duplicate_query(db, data.teacher_id, data.subject_id, data.class_id,
                                data.academic_year, data.semester)

    if existing:
        raise HTTPException(
            status_code=400,
            detail="This teacher assignment already exists",
        )

    assignment = TeacherAssignment(
        teacher_id=data.teacher_id,
        subject_id=data.subject_id,
        class_id=data.class_id,
        academic_year=data.academic_year,
        semester=data.semester,
    )

    try:
        db.add(assignment)
        db.commit()
        db.refresh(assignment)
    except Exception:
        db.rollback()
        raise

    return assignment


@router.get(
    "/",
    response_model=list[AssignmentResponse],
)
def get_assignments(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_admin),
):
    return (
        db.query(TeacherAssignment)
        .order_by(TeacherAssignment.id.desc())
        .all()
    )


@router.get(
    "/{assignment_id}",
    response_model=AssignmentResponse,
)
def get_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_admin),
):
    assignment = (
        db.query(TeacherAssignment)
        .filter(TeacherAssignment.id == assignment_id)
        .first()
    )

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    return assignment


@router.put(
    "/{assignment_id}",
    response_model=AssignmentResponse,
)
def update_assignment(
    assignment_id: int,
    data: AssignmentUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_admin),
):
    assignment = (
        db.query(TeacherAssignment)
        .filter(TeacherAssignment.id == assignment_id)
        .first()
    )

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    update_data = data.model_dump(exclude_unset=True)

    values = {
        "teacher_id": update_data.get("teacher_id", assignment.teacher_id),
        "subject_id": update_data.get("subject_id", assignment.subject_id),
        "class_id": update_data.get("class_id", assignment.class_id),
        "academic_year": update_data.get("academic_year", assignment.academic_year),
        "semester": update_data.get("semester", assignment.semester),
    }
    _validate_references(db, values["teacher_id"], values["subject_id"], values["class_id"])
    if _duplicate_query(db, values["teacher_id"], values["subject_id"], values["class_id"],
                        values["academic_year"], values["semester"], assignment.id):
        raise HTTPException(status_code=409, detail="This active teacher assignment already exists.")

    for key, value in update_data.items():
        setattr(assignment, key, value)

    try:
        db.commit()
        db.refresh(assignment)
    except Exception:
        db.rollback()
        raise

    return assignment


@router.delete("/{assignment_id}")
def delete_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_admin),
):
    assignment = (
        db.query(TeacherAssignment)
        .filter(TeacherAssignment.id == assignment_id)
        .first()
    )

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    assignment.is_active = False
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "message": "Teacher assignment deactivated successfully"
    }
