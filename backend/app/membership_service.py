"""Internal membership grant lifecycle; deliberately not exposed as a public API."""

from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.models import College, CollegeMembership, User
from app.tenant_context import TenantContext


def _actor(db, authenticated_user) -> User:
    user_id = authenticated_user.get("id") if isinstance(authenticated_user, dict) else getattr(authenticated_user, "id", None)
    actor = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).one_or_none()
    if actor is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Active account required.")
    return actor


def _verify_college_admin_context(db, actor: User, context: TenantContext, college_id: int) -> None:
    membership = (
        db.query(CollegeMembership)
        .join(College, College.id == CollegeMembership.college_id)
        .filter(
            CollegeMembership.id == context.membership_id,
            CollegeMembership.user_id == actor.id,
            CollegeMembership.college_id == college_id,
            CollegeMembership.role == "college_admin",
            CollegeMembership.status == "active",
            College.status == "active",
        )
        .one_or_none()
    )
    if membership is None or context.college_id != college_id or context.user_id != actor.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Active college administrator membership required.")


def create_college_membership(
    db,
    authenticated_actor,
    *,
    user_id: int,
    college_id: int,
    role: str,
    college_context: TenantContext | None = None,
) -> CollegeMembership:
    """Create a pending grant; only a verified platform or college admin can do so."""
    actor = _actor(db, authenticated_actor)
    college = db.query(College).filter(College.id == college_id).one_or_none()
    target = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).one_or_none()
    if college is None or target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account or college not found.")

    if actor.role == "super_admin":
        if role != "college_admin":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Platform provisioning is limited to college administrators.")
    else:
        if college_context is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Active college administrator membership required.")
        _verify_college_admin_context(db, actor, college_context, college_id)
        if college.status != "active" or role not in {"teacher", "student"}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="College administrators may invite teachers or students to their active college.")

    if role not in {"college_admin", "teacher", "student"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported college membership role.")
    if db.query(CollegeMembership.id).filter_by(user_id=user_id, college_id=college_id).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Membership already exists; review its existing status.")

    membership = CollegeMembership(
        user_id=user_id,
        college_id=college_id,
        role=role,
        status="pending",
        created_by_user_id=actor.id,
    )
    db.add(membership)
    db.flush()
    return membership


def activate_college_membership(
    db,
    authenticated_actor,
    *,
    membership_id: int,
    college_context: TenantContext | None = None,
) -> CollegeMembership:
    actor = _actor(db, authenticated_actor)
    membership = db.query(CollegeMembership).filter_by(id=membership_id).one_or_none()
    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found.")
    college = db.query(College).filter_by(id=membership.college_id, status="active").one_or_none()
    if college is None or membership.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only pending memberships in active colleges can be activated.")

    if actor.role == "super_admin":
        pass  # Explicit platform provisioning operation; this grants no college access to the actor.
    else:
        if college_context is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Active college administrator membership required.")
        _verify_college_admin_context(db, actor, college_context, membership.college_id)
        if membership.role not in {"teacher", "student"}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="College administrators cannot activate another college administrator.")

    membership.status = "active"
    membership.activated_by_user_id = actor.id
    membership.activated_at = datetime.now(timezone.utc)
    membership.status_reason = None
    db.flush()
    return membership


def revoke_college_membership(
    db,
    authenticated_actor,
    *,
    membership_id: int,
    reason: str,
    college_context: TenantContext | None = None,
) -> CollegeMembership:
    actor = _actor(db, authenticated_actor)
    membership = db.query(CollegeMembership).filter_by(id=membership_id).one_or_none()
    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found.")
    reason = str(reason or "").strip()
    if not reason or len(reason) > 500:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A short revocation reason is required.")

    if actor.role == "super_admin":
        pass  # Platform lifecycle operation; no tenant context is inferred.
    else:
        if college_context is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Active college administrator membership required.")
        _verify_college_admin_context(db, actor, college_context, membership.college_id)
        if membership.role not in {"teacher", "student"}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="College administrators cannot revoke another college administrator.")

    if membership.status == "revoked":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Membership is already revoked.")
    membership.status = "revoked"
    membership.revoked_by_user_id = actor.id
    membership.revoked_at = datetime.now(timezone.utc)
    membership.status_reason = reason
    db.flush()
    return membership
