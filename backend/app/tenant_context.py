"""Fail-closed tenant context resolution for future college-scoped operations.

Legacy routes do not use this dependency yet. A route adopting it must still
scope every query by the returned college_id.
"""

from dataclasses import dataclass
from typing import FrozenSet, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import College, CollegeMembership, User


@dataclass(frozen=True)
class TenantContext:
    user_id: int
    college_id: int
    membership_id: int
    membership_role: str


def _principal_value(principal, key: str):
    if isinstance(principal, dict):
        return principal.get(key)
    return getattr(principal, key, None)


def resolve_tenant_context(
    db: Session,
    authenticated_user,
    *,
    allowed_roles: FrozenSet[str],
    requested_college_id: Optional[int] = None,
) -> TenantContext:
    """Resolve one currently active, explicit membership for an authenticated user.

    A supplied college ID is only a selector among this user's verified active
    memberships. It never establishes authorization by itself.
    """
    user_id = _principal_value(authenticated_user, "id")
    if not isinstance(user_id, int) or isinstance(user_id, bool):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authenticated user required.")

    principal = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).one_or_none()
    if principal is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Active account required.")
    global_role = str(principal.role or "").strip().lower()

    # Platform operators use separate platform dependencies, never this path.
    if global_role == "super_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="College membership required.")

    query = (
        db.query(
            CollegeMembership.id,
            CollegeMembership.user_id,
            CollegeMembership.college_id,
            CollegeMembership.role,
        )
        .join(College, College.id == CollegeMembership.college_id)
        .filter(
            CollegeMembership.user_id == user_id,
            CollegeMembership.status == "active",
            College.status == "active",
        )
    )
    if requested_college_id is not None:
        if not isinstance(requested_college_id, int) or isinstance(requested_college_id, bool):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid college selector.")
        query = query.filter(CollegeMembership.college_id == requested_college_id)

    matches = query.all()
    if not matches:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Active college membership required.")
    if requested_college_id is None and len(matches) != 1:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Select one active college membership.")
    if len(matches) != 1:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Active college membership required.")

    membership_id, member_user_id, college_id, membership_role = matches[0]
    if membership_role not in allowed_roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="College operation is not permitted.")

    return TenantContext(
        user_id=member_user_id,
        college_id=college_id,
        membership_id=membership_id,
        membership_role=membership_role,
    )


def get_tenant_college(db: Session, context: TenantContext) -> College:
    """Example tenant-scoped read; the college ID comes only from context."""
    college = (
        db.query(College)
        .filter(College.id == context.college_id, College.status == "active")
        .one_or_none()
    )
    if college is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="College not found.")
    return college
