from fastapi import APIRouter, Depends
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_admin
from app.models import (
    AttendanceRecord,
    Class,
    FaceEmbedding,
    Student,
    Subject,
    Teacher,
    User,
)
from app.schemas.admin_dashboard import AdminDashboardResponse
from app.services.face_engine import is_valid_embedding


router = APIRouter()


def _registered_face_count(db: Session) -> int:
    registrations = (
        db.query(FaceEmbedding.embedding_json)
        .join(Student, FaceEmbedding.student_id == Student.id)
        .filter(
            Student.is_active.is_(True),
            FaceEmbedding.status == "registered",
        )
        .all()
    )
    return sum(is_valid_embedding(embedding_json) for (embedding_json,) in registrations)


def _attendance_record_count(db: Session) -> int:
    """Count legacy records and current session-based attendance events."""
    total = db.query(AttendanceRecord).count()
    if inspect(db.get_bind()).has_table("attendance_events"):
        session_events = db.execute(
            text("SELECT COUNT(*) FROM attendance_events")
        ).scalar_one()
        total += int(session_events or 0)
    return total


@router.get("", response_model=AdminDashboardResponse)
@router.get("/", response_model=AdminDashboardResponse)
def get_admin_dashboard(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_admin),
):
    return AdminDashboardResponse(
        total_students=db.query(Student).count(),
        total_teachers=db.query(Teacher).count(),
        total_users=db.query(User).count(),
        total_subjects=db.query(Subject).count(),
        total_classes=db.query(Class).count(),
        total_attendance_records=_attendance_record_count(db),
        face_registered_count=_registered_face_count(db),
    )
