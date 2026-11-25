"""Explicit College Admin identity-link API, mounted after schema verification.

Never infer a profile from email, name, phone, roll number, or employee ID. A
College Admin must verify identity outside this API, then explicitly select the
existing profile and account and submit the attestation. The database records
the actor and timestamp, but stores no identity document or sensitive evidence.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import String, cast, or_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import (
    CollegeMembership,
    Student,
    StudentAccountLink,
    Teacher,
    TeacherAccountLink,
    User,
)
from app.schemas.tenant_account_links import (
    TenantAccountLinkCreate,
    TenantAccountLinkResponse,
    TenantAccountLinkRevoke,
    TenantStudentAccountLinkCandidateResponse,
    TenantTeacherAccountLinkCandidateResponse,
)
from app.tenant_context import resolve_tenant_context


router = APIRouter(prefix="/tenant/account-links", tags=["Tenant Account Links"])
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
        raise HTTPException(status_code=503, detail="College account-link records are unavailable.") from exc


def _link_model(profile_kind: str):
    if profile_kind == "student":
        return Student, StudentAccountLink, "student_id"
    if profile_kind == "teacher":
        return Teacher, TeacherAccountLink, "teacher_id"
    raise ValueError("Unsupported profile kind")


def _link_response(link, profile_kind: str, *, profile_is_active=None, user_is_active=None, membership_status=None):
    profile_id = link.student_id if profile_kind == "student" else link.teacher_id
    return TenantAccountLinkResponse(
        id=link.id,
        profile_id=profile_id,
        user_id=link.user_id,
        college_id=link.college_id,
        link_status=link.link_status,
        verified_by_user_id=link.verified_by_user_id,
        verified_at=link.verified_at,
        revoked_by_user_id=link.revoked_by_user_id,
        revoked_at=link.revoked_at,
        revocation_reason=link.revocation_reason,
        profile_is_active=profile_is_active,
        user_is_active=user_is_active,
        membership_status=membership_status,
    )


def _read_link(profile_kind: str, profile_id: int, db: Session, current_user, college_id: int | None):
    context = _context(db, current_user, college_id)
    profile_model, link_model, profile_field = _link_model(profile_kind)
    try:
        link = (
            db.query(link_model)
            .filter(
                getattr(link_model, profile_field) == profile_id,
                link_model.college_id == context.college_id,
            )
            .order_by(link_model.created_at.desc(), link_model.id.desc())
            .first()
        )
        if link is None:
            raise HTTPException(status_code=404, detail="No account link exists for this profile in the selected College.")
        profile_active = db.query(profile_model.is_active).filter(
            profile_model.id == profile_id,
            profile_model.college_id == context.college_id,
        ).one_or_none()
        account_membership = (
            db.query(User.is_active, CollegeMembership.status)
            .join(CollegeMembership, CollegeMembership.user_id == User.id)
            .filter(
                User.id == link.user_id,
                CollegeMembership.college_id == context.college_id,
                CollegeMembership.role == profile_kind,
            )
            .one_or_none()
        )
        return _link_response(
            link,
            profile_kind,
            profile_is_active=profile_active[0] if profile_active is not None else None,
            user_is_active=account_membership[0] if account_membership is not None else None,
            membership_status=account_membership[1] if account_membership is not None else None,
        )
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="College account-link records are unavailable.") from exc


def _create_link(profile_kind: str, profile_id: int, body: TenantAccountLinkCreate, db: Session, current_user, college_id: int | None):
    context = _context(db, current_user, college_id)
    profile_model, link_model, profile_field = _link_model(profile_kind)

    try:
        profile = (
            db.query(profile_model)
            .filter(
                profile_model.id == profile_id,
                profile_model.college_id == context.college_id,
                profile_model.is_active.is_(True),
            )
            .one_or_none()
        )
        if profile is None:
            raise HTTPException(status_code=404, detail="Active profile not found.")
        if body.user_id == context.user_id:
            raise HTTPException(status_code=409, detail="A College Admin cannot verify a profile link to their own account.")

        target = (
            db.query(User)
            .join(CollegeMembership, CollegeMembership.user_id == User.id)
            .filter(
                User.id == body.user_id,
                User.is_active.is_(True),
                CollegeMembership.college_id == context.college_id,
                CollegeMembership.role == profile_kind,
                CollegeMembership.status == "active",
            )
            .one_or_none()
        )
        if target is None:
            raise HTTPException(status_code=403, detail=f"An active same-College {profile_kind} account is required.")

        existing = (
            db.query(link_model)
            .filter(
                getattr(link_model, profile_field) == profile_id,
                link_model.college_id == context.college_id,
                link_model.link_status == "active",
            )
            .first()
        )
        if existing is not None:
            raise HTTPException(status_code=409, detail="This profile already has an active account link.")

        now = datetime.now(timezone.utc)
        values = {
            profile_field: profile_id,
            "user_id": body.user_id,
            "college_id": context.college_id,
            "link_status": "active",
            "verified_by_user_id": context.user_id,
            "verified_at": now,
            "created_at": now,
        }
        link = link_model(**values)
        db.add(link)
        db.flush()
        db.commit()
        db.refresh(link)
        return _link_response(link, profile_kind)
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="An active link already exists for this profile or account.") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="College account-link records are unavailable.") from exc


def _revoke_link(profile_kind: str, link_id: int, body: TenantAccountLinkRevoke, db: Session, current_user, college_id: int | None):
    context = _context(db, current_user, college_id)
    _, link_model, _ = _link_model(profile_kind)
    try:
        link = (
            db.query(link_model)
            .filter(link_model.id == link_id, link_model.college_id == context.college_id)
            .with_for_update()
            .one_or_none()
        )
        if link is None:
            raise HTTPException(status_code=404, detail="Account link not found.")
        if link.link_status != "active":
            raise HTTPException(status_code=409, detail="Account link is already revoked.")
        link.link_status = "revoked"
        link.revoked_by_user_id = context.user_id
        link.revoked_at = datetime.now(timezone.utc)
        link.revocation_reason = body.reason.strip()
        db.flush()
        db.commit()
        db.refresh(link)
        return _link_response(link, profile_kind)
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="College account-link records are unavailable.") from exc


@router.post("/students/{student_id}", response_model=TenantAccountLinkResponse, status_code=status.HTTP_201_CREATED)
def create_student_account_link(
    student_id: int,
    body: TenantAccountLinkCreate,
    college_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return _create_link("student", student_id, body, db, current_user, college_id)


@router.get("/students/eligible-users", response_model=list[TenantStudentAccountLinkCandidateResponse])
def list_student_account_link_candidates(
    search: str = Query(min_length=2, max_length=120),
    limit: int = Query(default=25, ge=1, le=50),
    college_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Search active same-College Student accounts; never infer or create links."""
    context = _context(db, current_user, college_id)
    normalized = search.strip()
    if len(normalized) < 2:
        raise HTTPException(status_code=422, detail="Enter at least two characters to search existing accounts.")
    pattern = f"%{normalized}%"
    active_linked_users = db.query(StudentAccountLink.user_id).filter(
        StudentAccountLink.college_id == context.college_id,
        StudentAccountLink.link_status == "active",
    )
    try:
        rows = (
            db.query(User.id, User.name, User.email)
            .join(CollegeMembership, CollegeMembership.user_id == User.id)
            .filter(
                User.is_active.is_(True),
                CollegeMembership.college_id == context.college_id,
                CollegeMembership.role == "student",
                CollegeMembership.status == "active",
                ~User.id.in_(active_linked_users),
                or_(User.name.ilike(pattern), User.email.ilike(pattern), cast(User.id, String) == normalized),
            )
            .order_by(User.name, User.id)
            .limit(limit)
            .all()
        )
        return [TenantStudentAccountLinkCandidateResponse(
            user_id=user_id,
            name=name,
            email=email,
            college_id=context.college_id,
            membership_status="active",
        ) for user_id, name, email in rows]
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="College account-link records are unavailable.") from exc


@router.get("/students/{student_id}", response_model=TenantAccountLinkResponse)
def read_student_account_link(
    student_id: int,
    college_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return _read_link("student", student_id, db, current_user, college_id)


@router.post("/teachers/{teacher_id}", response_model=TenantAccountLinkResponse, status_code=status.HTTP_201_CREATED)
def create_teacher_account_link(
    teacher_id: int,
    body: TenantAccountLinkCreate,
    college_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return _create_link("teacher", teacher_id, body, db, current_user, college_id)


@router.get("/teachers/eligible-users", response_model=list[TenantTeacherAccountLinkCandidateResponse])
def list_teacher_account_link_candidates(
    search: str = Query(min_length=2, max_length=120),
    limit: int = Query(default=25, ge=1, le=50),
    college_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Search eligible login accounts; selection and identity verification stay manual."""
    context = _context(db, current_user, college_id)
    normalized = search.strip()
    if len(normalized) < 2:
        raise HTTPException(status_code=422, detail="Enter at least two characters to search existing accounts.")
    pattern = f"%{normalized}%"
    active_linked_users = db.query(TeacherAccountLink.user_id).filter(
        TeacherAccountLink.college_id == context.college_id,
        TeacherAccountLink.link_status == "active",
    )
    try:
        rows = (
            db.query(User.id, User.name, User.email)
            .join(CollegeMembership, CollegeMembership.user_id == User.id)
            .filter(
                User.is_active.is_(True),
                CollegeMembership.college_id == context.college_id,
                CollegeMembership.role == "teacher",
                CollegeMembership.status == "active",
                ~User.id.in_(active_linked_users),
                or_(User.name.ilike(pattern), User.email.ilike(pattern), cast(User.id, String) == normalized),
            )
            .order_by(User.name, User.id)
            .limit(limit)
            .all()
        )
        return [TenantTeacherAccountLinkCandidateResponse(
            user_id=user_id,
            name=name,
            email=email,
            college_id=context.college_id,
            membership_status="active",
        ) for user_id, name, email in rows]
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="College account-link records are unavailable.") from exc


@router.get("/teachers/{teacher_id}", response_model=TenantAccountLinkResponse)
def read_teacher_account_link(
    teacher_id: int,
    college_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return _read_link("teacher", teacher_id, db, current_user, college_id)


@router.post("/students/{link_id}/revoke", response_model=TenantAccountLinkResponse)
def revoke_student_account_link(
    link_id: int,
    body: TenantAccountLinkRevoke,
    college_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return _revoke_link("student", link_id, body, db, current_user, college_id)


@router.post("/teachers/{link_id}/revoke", response_model=TenantAccountLinkResponse)
def revoke_teacher_account_link(
    link_id: int,
    body: TenantAccountLinkRevoke,
    college_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return _revoke_link("teacher", link_id, body, db, current_user, college_id)
