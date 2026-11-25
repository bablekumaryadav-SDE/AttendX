"""Fail-closed gate for legacy APIs that do not yet enforce College ownership.

The existing business tables and query paths have no College ownership model.
Until each route is redesigned and migrated with reviewed ownership semantics,
serving those routes would risk cross-college exposure. Keep this dependency on
every legacy business router; tenant pilot endpoints are mounted separately.
"""

from fastapi import Depends, HTTPException, status

from app.dependencies import get_current_user


def block_unscoped_legacy_business_api(_current_user=Depends(get_current_user)):
    """Authenticate first, then deny access without running legacy queries."""
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="This business API is unavailable until College-scoped authorization is enabled.",
    )
