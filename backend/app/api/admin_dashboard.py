from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_admin
from app.models import (
    User,
    Student,
    Teacher,
    Subject,
    Class,
    AttendanceRecord,
)
from app.schemas.admin_dashboard import AdminDashboardResponse


router = APIRouter(
    prefix="/admin",
    tags=["Admin Dashboard"]
)


@router.get(
    "/dashboard",
    response_model=AdminDashboardResponse
)
def get_admin_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    return AdminDashboardResponse(
        total_students=db.query(Student).count(),
        total_teachers=db.query(Teacher).count(),
        total_users=db.query(User).count(),
        total_subjects=db.query(Subject).count(),
        total_classes=db.query(Class).count(),
        total_attendance_records=db.query(AttendanceRecord).count(),
    )