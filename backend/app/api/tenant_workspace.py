"""Read-only College Admin views for verified guardian links and notification records."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import NotificationEvent, Student, StudentGuardian
from app.schemas.tenant_workspace import (
    TenantGuardianItem,
    TenantGuardianPage,
    TenantNotificationEventItem,
    TenantNotificationEventPage,
)
from app.tenant_context import resolve_tenant_context


router = APIRouter(prefix="/tenant", tags=["Tenant Admin Workspace"])
_ADMIN_ROLE = frozenset({"college_admin"})


def _context(db: Session, current_user, college_id: int | None):
    try:
        return resolve_tenant_context(
            db,
            current_user,
            allowed_roles=_ADMIN_ROLE,
            requested_college_id=college_id,
        )
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="College workspace data is temporarily unavailable.",
        ) from exc


def _unavailable(db: Session, exc: SQLAlchemyError):
    db.rollback()
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="College workspace data is temporarily unavailable. Required schema may be unavailable.",
    ) from exc


@router.get("/guardians", response_model=TenantGuardianPage)
def list_tenant_guardians(
    college_id: int | None = Query(default=None, gt=0),
    search: str | None = Query(default=None, max_length=120),
    student_status: str | None = Query(default=None, pattern="^(active|inactive)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """List only existing guardian rows linked to a Student owned by this College."""
    context = _context(db, current_user, college_id)
    query = (
        db.query(StudentGuardian, Student)
        .join(Student, Student.id == StudentGuardian.student_id)
        .filter(Student.college_id == context.college_id)
    )
    if student_status == "active":
        query = query.filter(Student.is_active.is_(True))
    elif student_status == "inactive":
        query = query.filter(Student.is_active.is_(False))
    if search and search.strip():
        term = f"%{search.strip()}%"
        query = query.filter(or_(
            Student.name.ilike(term),
            Student.roll_number.ilike(term),
            StudentGuardian.guardian_name.ilike(term),
            StudentGuardian.father_name.ilike(term),
            StudentGuardian.mother_name.ilike(term),
            StudentGuardian.guardian_mobile.ilike(term),
            StudentGuardian.parent_email.ilike(term),
        ))
    try:
        total = query.count()
        rows = (
            query.order_by(Student.name.asc(), Student.id.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
    except SQLAlchemyError as exc:
        _unavailable(db, exc)
    items = [
        TenantGuardianItem(
            student_id=student.id,
            student_name=student.name,
            student_roll_number=student.roll_number,
            student_active=student.is_active,
            guardian_name=guardian.guardian_name or guardian.father_name or guardian.mother_name,
            guardian_relationship=guardian.guardian_relationship,
            guardian_mobile=guardian.guardian_mobile or guardian.alternate_mobile,
            parent_email=guardian.parent_email,
        )
        for guardian, student in rows
    ]
    return TenantGuardianPage(items=items, total=total, page=page, page_size=page_size)


@router.get("/notification-events", response_model=TenantNotificationEventPage)
def list_tenant_notification_events(
    college_id: int | None = Query(default=None, gt=0),
    search: str | None = Query(default=None, max_length=120),
    record_status: str | None = Query(default=None, max_length=20),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """List stored College event records; this is not proof of provider delivery."""
    context = _context(db, current_user, college_id)
    query = db.query(NotificationEvent).filter(NotificationEvent.college_id == context.college_id)
    if search and search.strip():
        term = f"%{search.strip()}%"
        query = query.filter(or_(
            NotificationEvent.title.ilike(term),
            NotificationEvent.message.ilike(term),
            NotificationEvent.event_type.ilike(term),
            NotificationEvent.recipient.ilike(term),
        ))
    if record_status and record_status.strip():
        query = query.filter(NotificationEvent.delivery_status == record_status.strip())
    try:
        total = query.count()
        rows = (
            query.order_by(NotificationEvent.created_at.desc(), NotificationEvent.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
    except SQLAlchemyError as exc:
        _unavailable(db, exc)
    items = [
        TenantNotificationEventItem(
            id=row.id,
            student_id=row.student_id,
            event_type=row.event_type,
            channel=row.channel,
            title=row.title,
            message=row.message,
            record_status=row.delivery_status,
            read_at=row.read_at,
            created_at=row.created_at,
            sent_at=row.sent_at,
        )
        for row in rows
    ]
    return TenantNotificationEventPage(items=items, total=total, page=page, page_size=page_size)
