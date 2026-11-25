"""Small tenant-aware API pilot; legacy application routes remain unchanged."""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.database_diagnostics import safe_database_diagnostics
from app.dependencies import get_current_user
from app.models import AttendanceAuditLog, College
from app.schemas.tenant_pilot import (
    TenantCollegeProfileResponse,
    TenantCollegeProfileUpdate,
)
from app.tenant_context import get_tenant_college, resolve_tenant_context


router = APIRouter(prefix="/tenant/pilot", tags=["Tenant API Pilot"])
READ_ROLES = frozenset({"college_admin", "teacher", "student"})
WRITE_ROLES = frozenset({"college_admin"})
logger = logging.getLogger(__name__)


def _database_failure_detail(exc: Exception) -> str:
    """Map safe SQLAlchemy diagnostics to public messages without exposing SQL."""
    _error_type, sqlstate, _constraint, _schema, relation, column, failure_class = safe_database_diagnostics(exc)
    if failure_class == "schema_missing_column" and column == "gps_accuracy_limit_m":
        return "College GPS settings schema is unavailable. Apply the reviewed College GPS settings migration and retry."
    if failure_class in {"schema_missing_table", "schema_missing_column", "schema_missing_schema"}:
        return "Required College settings schema is unavailable. Contact the administrator."
    if failure_class == "database_connection_failure":
        return "The database is temporarily unavailable. Please retry shortly."
    if failure_class == "database_integrity_failure":
        return "The College settings could not be saved because a data constraint was not satisfied."
    return "College settings could not be saved because of a database operation failure."


def _log_database_failure(exc: Exception, *, stage: str) -> str:
    error_type, sqlstate, constraint, schema_name, relation_name, column_name, failure_class = safe_database_diagnostics(exc)
    logger.error(
        "tenant_pilot_database_unavailable failure_class=%s error_type=%s sqlstate=%s constraint=%s schema=%s relation=%s column=%s stage=%s",
        failure_class,
        error_type,
        sqlstate or "unknown",
        constraint or "unknown",
        schema_name or "unknown",
        relation_name or "unknown",
        column_name or "unknown",
        stage,
    )
    return _database_failure_detail(exc)


def _resolve_context(db, current_user, *, allowed_roles, college_id):
    try:
        return resolve_tenant_context(
            db,
            current_user,
            allowed_roles=allowed_roles,
            requested_college_id=college_id,
        )
    except SQLAlchemyError as exc:
        # The additive pilot tables may not yet exist in an older installation.
        db.rollback()
        detail = _log_database_failure(exc, stage="tenant_context")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=detail,
        ) from exc


@router.get("/college-profile", response_model=TenantCollegeProfileResponse)
def read_college_profile(
    college_id: Optional[int] = Query(default=None, gt=0),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    context = _resolve_context(db, current_user, allowed_roles=READ_ROLES, college_id=college_id)
    try:
        return get_tenant_college(db, context)
    except SQLAlchemyError as exc:
        db.rollback()
        detail = _log_database_failure(exc, stage="college_profile_read")
        raise HTTPException(status_code=503, detail=detail) from exc


@router.patch("/college-profile", response_model=TenantCollegeProfileResponse)
def update_college_profile(
    payload: TenantCollegeProfileUpdate,
    college_id: Optional[int] = Query(default=None, gt=0),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    context = _resolve_context(db, current_user, allowed_roles=WRITE_ROLES, college_id=college_id)
    try:
        college: College = get_tenant_college(db, context)
    except SQLAlchemyError as exc:
        db.rollback()
        detail = _log_database_failure(exc, stage="college_profile_update_read")
        raise HTTPException(status_code=503, detail=detail) from exc
    changed = {}
    if "display_name" in payload.model_fields_set and college.display_name != payload.display_name:
        changed["display_name"] = {"before": college.display_name, "after": payload.display_name}
        college.display_name = payload.display_name
    if "gps_accuracy_limit_m" in payload.model_fields_set:
        new_limit = payload.gps_accuracy_limit_m
        if new_limit is None:
            raise HTTPException(status_code=422, detail="GPS accuracy limit cannot be null.")
        if college.gps_accuracy_limit_m != new_limit:
            changed["gps_accuracy_limit_m"] = {
                "before": college.gps_accuracy_limit_m,
                "after": new_limit,
            }
            college.gps_accuracy_limit_m = new_limit
    try:
        gps_change = changed.get("gps_accuracy_limit_m")
        if gps_change:
            db.add(AttendanceAuditLog(
                college_id=context.college_id,
                user_id=context.user_id,
                action="college.gps_accuracy_limit_updated",
                entity_type="college",
                entity_id=context.college_id,
                event_metadata={"gps_accuracy_limit_m": gps_change},
            ))
        # Build the response from the values whose persistence is pending. Return it
        # only after COMMIT succeeds; a post-commit refresh can fail after the data
        # is already committed and would otherwise report a false save failure.
        saved_profile = {
            "id": college.id,
            "slug": college.slug,
            "official_name": college.official_name,
            "display_name": college.display_name,
            "status": college.status,
            "gps_accuracy_limit_m": college.gps_accuracy_limit_m,
        }
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        detail = _log_database_failure(exc, stage="college_profile_update_commit")
        raise HTTPException(status_code=503, detail=detail) from exc
    return saved_profile
