from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_teacher
from app.models import (
    User,
    Teacher,
    TeacherAssignment,
    Subject,
    Class,
)
from app.schemas.teacher_dashboard import (
    TeacherDashboardResponse,
    TeacherAssignmentSummary,
)


router = APIRouter(
    prefix="/teacher",
    tags=["Teacher Dashboard"]
)


@router.get(
    "/dashboard",
    response_model=TeacherDashboardResponse
)
def get_teacher_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    teacher = (
        db.query(Teacher)
        .filter(Teacher.email == current_user.email)
        .first()
    )

    if not teacher:
        raise HTTPException(
            status_code=404,
            detail="Teacher profile not found"
        )

    assignments = (
        db.query(TeacherAssignment, Subject, Class)
        .join(
            Subject,
            TeacherAssignment.subject_id == Subject.id
        )
        .join(
            Class,
            TeacherAssignment.class_id == Class.id
        )
        .filter(
            TeacherAssignment.teacher_id == teacher.id
        )
        .all()
    )

    assignment_list = []

    for assignment, subject, class_obj in assignments:
        assignment_list.append(
            TeacherAssignmentSummary(
                assignment_id=assignment.id,
                subject_id=subject.id,
                subject_name=subject.name,
                class_id=class_obj.id,
                class_name=class_obj.name,
            )
        )

    return TeacherDashboardResponse(
        teacher_id=teacher.id,
        teacher_name=teacher.name,
        total_assignments=len(assignment_list),
        assignments=assignment_list,
    )