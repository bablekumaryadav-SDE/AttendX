"""Recipient-scoped in-app notification API, mounted after schema verification.

This API reports persisted in-app events only. It does not report email/SMS
delivery. It depends on the reviewed College-scoped notification schema.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import NotificationEvent
from app.schemas.tenant_notifications import (
    TenantNotificationPageResponse,
    TenantNotificationResponse,
    TenantNotificationUnreadCountResponse,
)
from app.tenant_context import resolve_tenant_context


router = APIRouter(prefix="/tenant/notifications", tags=["Tenant Notifications"])
_INBOX_ROLES = frozenset({"college_admin", "teacher", "student"})


def _context(db, user, college_id):
    try:
        return resolve_tenant_context(
            db, user, allowed_roles=_INBOX_ROLES, requested_college_id=college_id
        )
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="Tenant notifications are unavailable.") from exc


@router.get("", response_model=TenantNotificationPageResponse)
def list_notifications(
    college_id: int | None = Query(default=None, gt=0),
    unread: bool | None = None,
    event_type: str | None = Query(default=None, min_length=1, max_length=64),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _context(db, current_user, college_id)
    try:
        query = db.query(NotificationEvent).filter(
            NotificationEvent.college_id == context.college_id,
            NotificationEvent.user_id == context.user_id,
        )
        if unread is True:
            query = query.filter(NotificationEvent.read_at.is_(None))
        elif unread is False:
            query = query.filter(NotificationEvent.read_at.is_not(None))
        if event_type:
            query = query.filter(NotificationEvent.event_type == event_type)
        total = query.count()
        items = query.order_by(NotificationEvent.created_at.desc(), NotificationEvent.id.desc()).offset(offset).limit(limit).all()
        return TenantNotificationPageResponse(items=items, total=total, limit=limit, offset=offset)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="Tenant notifications are unavailable.") from exc


@router.get("/unread-count", response_model=TenantNotificationUnreadCountResponse)
def unread_notification_count(
    college_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _context(db, current_user, college_id)
    try:
        unread_count = db.query(NotificationEvent).filter(
            NotificationEvent.college_id == context.college_id,
            NotificationEvent.user_id == context.user_id,
            NotificationEvent.read_at.is_(None),
        ).count()
        return TenantNotificationUnreadCountResponse(unread_count=unread_count)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="Tenant notifications are unavailable.") from exc


@router.patch("/{notification_id}/read", response_model=TenantNotificationResponse)
def mark_notification_read(
    notification_id: int,
    college_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _context(db, current_user, college_id)
    try:
        event = db.query(NotificationEvent).filter(
            NotificationEvent.id == notification_id,
            NotificationEvent.college_id == context.college_id,
            NotificationEvent.user_id == context.user_id,
        ).with_for_update().one_or_none()
        if event is None:
            raise HTTPException(status_code=404, detail="Notification not found.")
        if event.read_at is None:
            event.read_at = datetime.now(timezone.utc)
            db.commit()
            db.refresh(event)
        return event
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="Tenant notifications are unavailable.") from exc


@router.post("/read-all", response_model=dict[str, int])
def mark_all_notifications_read(
    college_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _context(db, current_user, college_id)
    try:
        count = db.query(NotificationEvent).filter(
            NotificationEvent.college_id == context.college_id,
            NotificationEvent.user_id == context.user_id,
            NotificationEvent.read_at.is_(None),
        ).update({NotificationEvent.read_at: datetime.now(timezone.utc)}, synchronize_session=False)
        db.commit()
        return {"updated": int(count)}
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="Tenant notifications are unavailable.") from exc
