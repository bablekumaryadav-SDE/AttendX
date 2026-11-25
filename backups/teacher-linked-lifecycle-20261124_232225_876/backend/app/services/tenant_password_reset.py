"""College-scoped administrative password reset with secret-free audit data."""

from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models import AttendanceAuditLog, CollegeMembership, User
from app.security import get_password_hash
from app.tenant_context import TenantContext


def reset_tenant_account_password(
    db: Session,
    *,
    account_email: str,
    expected_global_role: str,
    profile_type: str,
    profile_id: int,
    profile_is_active: bool,
    context: TenantContext,
    password: str,
) -> None:
    if not profile_is_active:
        raise HTTPException(status_code=409, detail="Inactive accounts cannot have their password reset.")
    try:
        account = db.query(User).filter(
            User.email == account_email,
            User.role == expected_global_role,
        ).with_for_update().one_or_none()
        if account is None:
            raise HTTPException(status_code=404, detail="Record not found.")
        membership = db.query(CollegeMembership.id).filter(
            CollegeMembership.user_id == account.id,
            CollegeMembership.college_id == context.college_id,
            CollegeMembership.role == expected_global_role,
            CollegeMembership.status == "active",
        ).one_or_none()
        if membership is None:
            raise HTTPException(status_code=409, detail="No active account membership is available for password reset.")
        account.hashed_password = get_password_hash(password)
        db.add(AttendanceAuditLog(
            college_id=context.college_id,
            user_id=context.user_id,
            action="college_admin_password_reset",
            entity_type=profile_type,
            entity_id=profile_id,
            event_metadata={"target_user_id": account.id, "membership_id": membership.id},
        ))
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="College account security operation is unavailable.") from exc
