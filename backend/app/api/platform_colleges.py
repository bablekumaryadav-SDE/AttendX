"""Super Admin-only College directory, profile and lifecycle APIs."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.database_diagnostics import safe_database_diagnostics
from app.dependencies import get_current_super_admin
from app.models import (
    College,
    CollegeMembership,
    CollegeRegistrationApplication,
    CollegeStatusHistory,
    User,
)
from app.schemas.platform_college import (
    CollegeStatusHistoryEvent,
    PlatformCollegeAdmin,
    PlatformCollegeDetail,
    PlatformCollegeListItem,
    PlatformCollegeProfileUpdate,
    PlatformCollegeStatusUpdate,
)


router = APIRouter(prefix="/platform/colleges", tags=["Platform Colleges"])


def _db_unavailable(db: Session, exc: Exception, *, stage: str):
    db.rollback()
    error_type, sqlstate, constraint, schema_name, relation_name, column_name, failure_class = safe_database_diagnostics(exc)
    # Metadata-only: SQLAlchemy/driver error messages can contain query values.
    from logging import getLogger

    getLogger(__name__).error(
        "platform_college_database_unavailable failure_class=%s error_type=%s sqlstate=%s constraint=%s schema=%s relation=%s column=%s stage=%s",
        failure_class,
        error_type,
        sqlstate or "unknown",
        constraint or "unknown",
        schema_name or "unknown",
        relation_name or "unknown",
        column_name or "unknown",
        stage,
    )
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="College management service is unavailable.",
    ) from exc


def _college_or_404(db: Session, college_id: int, *, lock: bool = False) -> College:
    query = db.query(College).filter(College.id == college_id)
    if lock:
        query = query.with_for_update()
    college = query.one_or_none()
    if college is None:
        raise HTTPException(status_code=404, detail="College not found.")
    return college


def _application(db: Session, college_id: int):
    return (
        db.query(CollegeRegistrationApplication)
        .filter(CollegeRegistrationApplication.college_id == college_id)
        .order_by(CollegeRegistrationApplication.reviewed_at.desc(), CollegeRegistrationApplication.id.desc())
        .first()
    )


def _list_item(college: College, application=None) -> PlatformCollegeListItem:
    return PlatformCollegeListItem(
        id=college.id,
        slug=college.slug,
        official_name=college.official_name,
        display_name=college.display_name,
        status=college.status,
        created_at=college.created_at,
        updated_at=college.updated_at,
        application_reference=application.application_reference if application else None,
        application_status=application.status if application else None,
        provisioning_status=application.provisioning_status if application else None,
    )


@router.get("", response_model=list[PlatformCollegeListItem])
def list_platform_colleges(
    q: str | None = Query(default=None, max_length=200),
    college_status: str | None = Query(default=None, alias="status", pattern="^(pending|active|suspended|archived)$"),
    _platform_user=Depends(get_current_super_admin),
    db: Session = Depends(get_db),
):
    stage = "college_list_query"
    try:
        query = db.query(College)
        if q and q.strip():
            needle = f"%{q.strip()}%"
            search_terms = [College.official_name.ilike(needle), College.display_name.ilike(needle), College.slug.ilike(needle)]
            if q.strip().isdigit():
                search_terms.append(College.id == int(q.strip()))
            query = query.filter(or_(*search_terms))
        if college_status:
            query = query.filter(College.status == college_status)
        colleges = query.order_by(College.created_at.desc(), College.id.desc()).all()
        stage = "college_application_list_query"
        applications = {
            row.college_id: row
            for row in db.query(CollegeRegistrationApplication)
            .filter(CollegeRegistrationApplication.college_id.in_([college.id for college in colleges]))
            .all()
        } if colleges else {}
        return [_list_item(college, applications.get(college.id)) for college in colleges]
    except SQLAlchemyError as exc:
        _db_unavailable(db, exc, stage=stage)


@router.get("/{college_id}", response_model=PlatformCollegeDetail)
def read_platform_college(
    college_id: int,
    _platform_user=Depends(get_current_super_admin),
    db: Session = Depends(get_db),
):
    stage = "college_detail_lookup"
    try:
        college = _college_or_404(db, college_id)
        stage = "college_application_lookup"
        application = _application(db, college_id)
        stage = "college_admin_membership_lookup"
        membership_rows = (
            db.query(CollegeMembership, User)
            .join(User, User.id == CollegeMembership.user_id)
            .filter(CollegeMembership.college_id == college_id, CollegeMembership.role == "college_admin")
            .order_by(CollegeMembership.id.asc())
            .all()
        )
        admins = [
            PlatformCollegeAdmin(
                user_id=user.id,
                name=user.name,
                email=user.email,
                account_active=user.is_active,
                membership_id=membership.id,
                membership_status=membership.status,
            )
            for membership, user in membership_rows
        ]
        detail = _list_item(college, application).model_dump()
        if application:
            detail.update({
                "application_id": application.id,
                "college_type": application.college_type,
                "address": application.address,
                "city": application.city,
                "state": application.state,
                "postal_code": application.postal_code,
                "country": application.country,
                "official_email": application.official_email,
                "contact_number": application.contact_number,
                "website": application.website,
                "admin_name": application.admin_name,
                "admin_email": application.admin_email,
                "admin_contact_number": application.admin_contact_number,
            })
        for field in (
            "college_type", "address", "city", "state", "postal_code", "country",
            "official_email", "contact_number", "website",
        ):
            value = getattr(college, field, None)
            if value is not None:
                detail[field] = value
        detail["admins"] = admins
        return PlatformCollegeDetail.model_validate(detail)
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        _db_unavailable(db, exc, stage=stage)


@router.get("/{college_id}/history", response_model=list[CollegeStatusHistoryEvent])
def read_platform_college_history(
    college_id: int,
    _platform_user=Depends(get_current_super_admin),
    db: Session = Depends(get_db),
):
    stage = "college_history_parent_lookup"
    try:
        _college_or_404(db, college_id)
        stage = "college_status_history_query"
        return (
            db.query(CollegeStatusHistory)
            .filter(CollegeStatusHistory.college_id == college_id)
            .order_by(CollegeStatusHistory.created_at.asc(), CollegeStatusHistory.id.asc())
            .all()
        )
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        _db_unavailable(db, exc, stage=stage)


@router.patch("/{college_id}", response_model=PlatformCollegeDetail)
def update_platform_college_profile(
    college_id: int,
    payload: PlatformCollegeProfileUpdate,
    _platform_user=Depends(get_current_super_admin),
    db: Session = Depends(get_db),
):
    stage = "college_profile_update_transaction"
    try:
        college = _college_or_404(db, college_id, lock=True)
        changes = payload.model_dump(exclude_unset=True)
        allowed_profile_fields = {
            "official_name", "display_name", "college_type", "address", "city", "state",
            "postal_code", "country", "official_email", "contact_number", "website",
        }
        for field, value in changes.items():
            if field in allowed_profile_fields:
                setattr(college, field, value)
        db.commit()
        db.refresh(college)
        return read_platform_college(college_id, _platform_user, db)
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        _db_unavailable(db, exc, stage=stage)


@router.post("/{college_id}/status", response_model=PlatformCollegeDetail)
def set_platform_college_status(
    college_id: int,
    payload: PlatformCollegeStatusUpdate,
    platform_user=Depends(get_current_super_admin),
    db: Session = Depends(get_db),
):
    stage = "college_status_update_transaction"
    try:
        college = _college_or_404(db, college_id, lock=True)
        target = payload.status
        previous = college.status
        valid = (previous == "active" and target == "suspended") or (
            previous == "suspended" and target == "active"
        )
        if not valid:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Only active Colleges can be suspended, and only suspended Colleges can be reactivated.",
            )
        college.status = target
        db.add(CollegeStatusHistory(
            college_id=college.id,
            actor_user_id=platform_user.get("id"),
            action="suspended" if target == "suspended" else "reactivated",
            previous_status=previous,
            new_status=target,
            reason=payload.reason,
        ))
        db.commit()
        return read_platform_college(college_id, platform_user, db)
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        _db_unavailable(db, exc, stage=stage)
