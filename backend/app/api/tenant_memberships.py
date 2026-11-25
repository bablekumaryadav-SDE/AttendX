"""Authenticated discovery of the current user's active College memberships."""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.database_diagnostics import safe_database_diagnostics
from app.dependencies import get_current_user
from app.models import College, CollegeMembership
from app.schemas.tenant_membership import CollegeMembershipOption


router = APIRouter(prefix="/tenant", tags=["Tenant Membership Selection"])
logger = logging.getLogger(__name__)


@router.get("/memberships", response_model=list[CollegeMembershipOption])
def list_my_active_college_memberships(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return only safe selection fields for the authenticated user's active grants."""
    user_id = current_user.get("id")
    role = str(current_user.get("role") or "").strip().lower()
    if role == "super_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="College membership required.")

    try:
        rows = (
            db.query(
                CollegeMembership.college_id,
                CollegeMembership.role,
                College.display_name,
                College.official_name,
            )
            .join(College, College.id == CollegeMembership.college_id)
            .filter(
                CollegeMembership.user_id == user_id,
                CollegeMembership.status == "active",
                College.status == "active",
            )
            .order_by(College.display_name.asc(), College.official_name.asc(), College.id.asc())
            .all()
        )
        return [
            CollegeMembershipOption(
                college_id=college_id,
                college_name=display_name or official_name,
                membership_role=membership_role,
            )
            for college_id, membership_role, display_name, official_name in rows
        ]
    except SQLAlchemyError as exc:
        db.rollback()
        error_type, sqlstate, constraint, schema_name, relation_name, column_name, failure_class = safe_database_diagnostics(exc)
        logger.error(
            "tenant_membership_database_unavailable failure_class=%s error_type=%s sqlstate=%s constraint=%s schema=%s relation=%s column=%s stage=%s",
            failure_class,
            error_type,
            sqlstate or "unknown",
            constraint or "unknown",
            schema_name or "unknown",
            relation_name or "unknown",
            column_name or "unknown",
            "membership_and_college_list_query",
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="College membership selection is unavailable.",
        ) from exc
