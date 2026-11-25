"""Public College applications and server-authorized platform review APIs."""

import hashlib
import hmac
import logging
import re
import secrets
import sqlite3
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.database_diagnostics import safe_database_diagnostics as _safe_database_diagnostics
from app.dependencies import get_current_super_admin
from app.models import (
    College,
    CollegeMembership,
    CollegeRegistrationApplication,
    CollegeRegistrationReview,
    CollegeStatusHistory,
    User,
)
from app.schemas.college_registration import (
    CollegeApplicationDecision,
    CollegeApplicationDetail,
    CollegeApplicationListItem,
    CollegeApplicationReviewEvent,
    CollegeApplicationReviewResult,
    CollegeRegistrationCreate,
    CollegeRegistrationStatusRequest,
    CollegeRegistrationStatusResponse,
    CollegeRegistrationSubmission,
)
from app.security import get_password_hash


class _SanitizedRegistrationRoute(APIRoute):
    """Keep submitted values out of public registration validation responses."""

    def get_route_handler(self):
        original_handler = super().get_route_handler()

        async def sanitized_handler(request: Request):
            try:
                return await original_handler(request)
            except RequestValidationError as exc:
                details = [
                    {"type": item.get("type"), "loc": item.get("loc"), "msg": item.get("msg")}
                    for item in exc.errors()
                ]
                return JSONResponse(status_code=422, content={"detail": details})

        return sanitized_handler


public_router = APIRouter(
    prefix="/college-registration",
    tags=["College Registration"],
    route_class=_SanitizedRegistrationRoute,
)
platform_router = APIRouter(prefix="/platform/college-applications", tags=["Platform College Applications"])
logger = logging.getLogger(__name__)

# Static, source-controlled context keeps a missing relation diagnosable even
# when a driver omits schema/table fields from the structured exception. These
# values are derived from the handler stage, never from request data or SQL text.
_REGISTRATION_STAGE_CONTEXT = {
    "existing_user_lookup": ("public.users", "legacy users schema prerequisite"),
    "duplicate_application_lookup": (
        "public.college_registration_applications",
        "DRAFT_20261110_add_college_registration_workflow.sql",
    ),
    "application_insert_commit": (
        "public.college_registration_applications",
        "DRAFT_20261110_add_college_registration_workflow.sql",
    ),
    "application_refresh": (
        "public.college_registration_applications",
        "DRAFT_20261110_add_college_registration_workflow.sql",
    ),
    "application_status_lookup": (
        "public.college_registration_applications",
        "DRAFT_20261110_add_college_registration_workflow.sql",
    ),
    "application_list_query": (
        "public.college_registration_applications",
        "DRAFT_20261110_add_college_registration_workflow.sql",
    ),
    "application_detail_query": (
        "public.college_registration_applications",
        "DRAFT_20261110_add_college_registration_workflow.sql",
    ),
    "application_review_history_query": (
        "public.college_registration_reviews",
        "DRAFT_20261110_add_college_registration_workflow.sql",
    ),
    "application_review_transaction": (
        "public.college_registration_applications",
        "foundation v2, college status history, and college registration workflow drafts",
    ),
    "application_approval_transaction": (
        "public.colleges / public.college_memberships / public.college_status_history / public.college_registration_reviews",
        "foundation v2, college status history, and college registration workflow drafts",
    ),
    "application_rejection_transaction": (
        "public.college_registration_applications / public.college_registration_reviews",
        "DRAFT_20261110_add_college_registration_workflow.sql",
    ),
}


def _is_unique_violation(exc: IntegrityError) -> bool:
    original = exc.orig
    sqlstate = getattr(original, "sqlstate", None) or getattr(original, "pgcode", None)
    if sqlstate:
        return sqlstate == "23505"
    if isinstance(original, sqlite3.IntegrityError):
        # SQLite exposes no stable constraint code here; classify only its
        # documented unique-constraint wording, without logging that message.
        message = str(original).lower()
        return "unique constraint failed" in message or "is not unique" in message
    return False


def _duplicate_details_conflict() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=(
            "A registration may already exist for these details. If you have its reference and private tracking token, use Check application status; otherwise review the submitted details."
        ),
    )


def _service_unavailable(db: Session, exc: Exception, *, stage: str):
    db.rollback()
    error_type, sqlstate, constraint, schema_name, relation_name, column_name, failure_class = _safe_database_diagnostics(exc)
    expected_relation, required_migration = _REGISTRATION_STAGE_CONTEXT.get(
        stage, ("unknown", "unknown")
    )
    logger.error(
        "college_registration_database_unavailable failure_class=%s error_type=%s sqlstate=%s constraint=%s schema=%s relation=%s column=%s expected_relation=%s required_migration=%s stage=%s",
        failure_class,
        error_type,
        sqlstate or "unknown",
        constraint or "unknown",
        schema_name or "unknown",
        relation_name or "unknown",
        column_name or "unknown",
        expected_relation,
        required_migration,
        stage,
    )
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="College application service is unavailable.",
    ) from exc


def _application_or_404(db: Session, application_id: int, *, lock: bool = False):
    query = db.query(CollegeRegistrationApplication).filter(
        CollegeRegistrationApplication.id == application_id
    )
    if lock:
        query = query.with_for_update()
    application = query.one_or_none()
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="College application not found.")
    return application


def _list_item(application: CollegeRegistrationApplication) -> CollegeApplicationListItem:
    return CollegeApplicationListItem.model_validate(application)


def _detail(application: CollegeRegistrationApplication) -> CollegeApplicationDetail:
    return CollegeApplicationDetail.model_validate(application)


@public_router.post(
    "/applications",
    response_model=CollegeRegistrationSubmission,
    status_code=status.HTTP_201_CREATED,
)
def submit_college_application(
    payload: CollegeRegistrationCreate,
    db: Session = Depends(get_db),
):
    """Save an application and return its tracking token exactly once."""
    stage = "existing_user_lookup"
    try:
        if db.query(User.id).filter(func.lower(User.email) == payload.admin_email).first():
            raise _duplicate_details_conflict()
        stage = "duplicate_application_lookup"
        duplicate = db.query(CollegeRegistrationApplication.id).filter(
            CollegeRegistrationApplication.status != "rejected",
            (
                (CollegeRegistrationApplication.official_email == payload.official_email)
                | (CollegeRegistrationApplication.admin_email == payload.admin_email)
            ),
        ).first()
        if duplicate:
            raise _duplicate_details_conflict()

        raw_token = secrets.token_urlsafe(32)
        password_hash = get_password_hash(payload.password.get_secret_value())
        application = CollegeRegistrationApplication(
            application_reference=f"AXR-{secrets.token_urlsafe(24)}",
            tracking_token_digest=hashlib.sha256(raw_token.encode("utf-8")).hexdigest(),
            status="pending",
            provisioning_status="not_started",
            college_name=payload.college_name,
            college_type=payload.college_type,
            address=payload.address,
            city=payload.city,
            state=payload.state,
            postal_code=payload.postal_code,
            country=payload.country,
            official_email=payload.official_email,
            contact_number=payload.contact_number,
            website=payload.website,
            admin_name=payload.admin_name,
            admin_email=payload.admin_email,
            admin_contact_number=payload.admin_contact_number,
            admin_password_hash=password_hash,
        )
        db.add(application)
        stage = "application_insert_commit"
        db.commit()
        stage = "application_refresh"
        db.refresh(application)
        return CollegeRegistrationSubmission(
            application_reference=application.application_reference,
            status=application.status,
            tracking_token=raw_token,
        )
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        error_type, sqlstate, constraint, schema_name, relation_name, column_name, failure_class = _safe_database_diagnostics(exc)
        is_duplicate = _is_unique_violation(exc)
        logger.warning(
            "college_registration_integrity_failure category=%s failure_class=%s error_type=%s sqlstate=%s constraint=%s schema=%s relation=%s column=%s stage=%s",
            "unique_conflict" if is_duplicate else "integrity_failure",
            failure_class,
            error_type,
            sqlstate or "unknown",
            constraint or "unknown",
            schema_name or "unknown",
            relation_name or "unknown",
            column_name or "unknown",
            stage,
        )
        if is_duplicate:
            raise _duplicate_details_conflict() from exc
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="College application service is unavailable.",
        ) from exc
    except SQLAlchemyError as exc:
        _service_unavailable(db, exc, stage=stage)


@public_router.post("/status", response_model=CollegeRegistrationStatusResponse)
def read_application_status(
    payload: CollegeRegistrationStatusRequest,
    db: Session = Depends(get_db),
):
    """Return only non-private status fields after reference + token verification."""
    stage = "application_status_lookup"
    try:
        application = db.query(CollegeRegistrationApplication).filter(
            CollegeRegistrationApplication.application_reference == payload.application_reference
        ).one_or_none()
        supplied = hashlib.sha256(payload.tracking_token.get_secret_value().encode("utf-8")).hexdigest()
        if application is None or not hmac.compare_digest(application.tracking_token_digest, supplied):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application status is unavailable.")
        return CollegeRegistrationStatusResponse(
            application_reference=application.application_reference,
            status=application.status,
            submitted_at=application.submitted_at,
            reviewed_at=application.reviewed_at,
        )
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        _service_unavailable(db, exc, stage=stage)


@platform_router.get("", response_model=list[CollegeApplicationListItem])
def list_college_applications(
    application_status: str | None = Query(default=None, alias="status", pattern="^(pending|under_review|approved|rejected)$"),
    q: str | None = Query(default=None, max_length=200),
    _platform_user=Depends(get_current_super_admin),
    db: Session = Depends(get_db),
):
    stage = "application_list_query"
    try:
        query = db.query(CollegeRegistrationApplication)
        if application_status:
            query = query.filter(CollegeRegistrationApplication.status == application_status)
        if q and q.strip():
            needle = f"%{q.strip()}%"
            query = query.filter(
                (CollegeRegistrationApplication.application_reference.ilike(needle))
                | (CollegeRegistrationApplication.college_name.ilike(needle))
                | (CollegeRegistrationApplication.official_email.ilike(needle))
                | (CollegeRegistrationApplication.admin_email.ilike(needle))
            )
        return [_list_item(item) for item in query.order_by(CollegeRegistrationApplication.submitted_at.desc(), CollegeRegistrationApplication.id.desc()).all()]
    except SQLAlchemyError as exc:
        _service_unavailable(db, exc, stage=stage)


@platform_router.get("/{application_id}", response_model=CollegeApplicationDetail)
def read_college_application(
    application_id: int,
    _platform_user=Depends(get_current_super_admin),
    db: Session = Depends(get_db),
):
    stage = "application_detail_query"
    try:
        return _detail(_application_or_404(db, application_id))
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        _service_unavailable(db, exc, stage=stage)


@platform_router.get("/{application_id}/history", response_model=list[CollegeApplicationReviewEvent])
def read_college_application_history(
    application_id: int,
    _platform_user=Depends(get_current_super_admin),
    db: Session = Depends(get_db),
):
    stage = "application_review_history_query"
    try:
        _application_or_404(db, application_id)
        rows = db.query(CollegeRegistrationReview).filter(
            CollegeRegistrationReview.application_id == application_id
        ).order_by(CollegeRegistrationReview.created_at.asc(), CollegeRegistrationReview.id.asc()).all()
        return rows
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        _service_unavailable(db, exc, stage=stage)


@platform_router.post("/{application_id}/start-review", response_model=CollegeApplicationReviewResult)
def start_college_application_review(
    application_id: int,
    payload: CollegeApplicationDecision,
    platform_user=Depends(get_current_super_admin),
    db: Session = Depends(get_db),
):
    stage = "application_review_transaction"
    try:
        application = _application_or_404(db, application_id, lock=True)
        if application.status != "pending":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only pending applications can enter review.")
        application.status = "under_review"
        db.add(CollegeRegistrationReview(
            application_id=application.id,
            reviewer_user_id=platform_user.get("id"),
            decision="under_review",
            reason=payload.reason,
        ))
        db.commit()
        return CollegeApplicationReviewResult(
            application_reference=application.application_reference,
            status=application.status,
            provisioning_status=application.provisioning_status,
            college_id=application.college_id,
            admin_user_id=application.admin_user_id,
        )
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        _service_unavailable(db, exc, stage=stage)


def _review_application(db, application_id: int, reviewer_id: int, *, decision: str, reason: str | None):
    application = _application_or_404(db, application_id, lock=True)
    if application.status not in {"pending", "under_review"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Application has already been decided.")
    if decision == "rejected" and not reason:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="A rejection reason is required.")

    now = datetime.now(timezone.utc)
    if decision == "rejected":
        application.status = "rejected"
        application.provisioning_status = "rejected"
        application.admin_password_hash = None
    else:
        if application.admin_user_id is not None or application.college_id is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Application provisioning state requires review.")
        existing_user = db.query(User.id).filter(func.lower(User.email) == application.admin_email).first()
        if existing_user:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The application cannot be provisioned with the submitted account details.")

        slug_base = re.sub(r"[^a-z0-9]+", "-", application.college_name.lower()).strip("-") or "college"
        slug = f"{slug_base[:62]}-{uuid.uuid4().hex[:12]}"
        college = College(
            slug=slug,
            official_name=application.college_name,
            college_type=application.college_type,
            address=application.address,
            city=application.city,
            state=application.state,
            postal_code=application.postal_code,
            country=application.country,
            official_email=application.official_email,
            contact_number=application.contact_number,
            website=application.website,
            status="active",
        )
        db.add(college)
        db.flush()
        db.add(CollegeStatusHistory(
            college_id=college.id,
            actor_user_id=reviewer_id,
            action="approved_and_activated",
            previous_status=None,
            new_status="active",
            reason=f"Approved and activated from application {application.application_reference}.",
        ))
        administrator = User(
            name=application.admin_name,
            email=application.admin_email,
            hashed_password=application.admin_password_hash,
            role="college_admin",
            is_active=True,
        )
        db.add(administrator)
        db.flush()
        membership = CollegeMembership(
            user_id=administrator.id,
            college_id=college.id,
            role="college_admin",
            status="active",
            activated_by_user_id=reviewer_id,
            activated_at=now,
            status_reason=f"Activated on approval of application {application.application_reference}.",
        )
        db.add(membership)
        db.flush()

        application.status = "approved"
        application.provisioning_status = "activated"
        application.college_id = college.id
        application.admin_user_id = administrator.id
        # The credential hash is now held only by the active account.
        application.admin_password_hash = None

    application.reviewed_at = now
    application.reviewed_by_user_id = reviewer_id
    application.review_reason = reason
    db.add(CollegeRegistrationReview(
        application_id=application.id,
        reviewer_user_id=reviewer_id,
        decision=decision,
        reason=reason,
    ))
    db.commit()
    return CollegeApplicationReviewResult(
        application_reference=application.application_reference,
        status=application.status,
        provisioning_status=application.provisioning_status,
        college_id=application.college_id,
        admin_user_id=application.admin_user_id,
    )


@platform_router.post("/{application_id}/approve", response_model=CollegeApplicationReviewResult)
def approve_college_application(
    application_id: int,
    payload: CollegeApplicationDecision,
    platform_user=Depends(get_current_super_admin),
    db: Session = Depends(get_db),
):
    stage = "application_approval_transaction"
    try:
        return _review_application(db, application_id, platform_user.get("id"), decision="approved", reason=payload.reason)
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The application could not be provisioned with the submitted account details.") from exc
    except SQLAlchemyError as exc:
        _service_unavailable(db, exc, stage=stage)


@platform_router.post("/{application_id}/reject", response_model=CollegeApplicationReviewResult)
def reject_college_application(
    application_id: int,
    payload: CollegeApplicationDecision,
    platform_user=Depends(get_current_super_admin),
    db: Session = Depends(get_db),
):
    stage = "application_rejection_transaction"
    try:
        return _review_application(db, application_id, platform_user.get("id"), decision="rejected", reason=payload.reason)
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        _service_unavailable(db, exc, stage=stage)
