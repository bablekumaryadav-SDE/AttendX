"""Explicit College Admin identity-link API, mounted after schema verification.

Never infer a profile from email, name, phone, roll number, or employee ID. A
College Admin must verify identity outside this API, then explicitly select the
existing profile and account and submit the attestation. The database records
the actor and timestamp, but stores no identity document or sensitive evidence.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import String, cast, inspect, or_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import (
    Class,
    CollegeMembership,
    Subject,
    Student,
    StudentAccountLink,
    Teacher,
    TeacherAccountLink,
    TeacherAssignment,
    TeacherManagementAuditEvent,
    TeacherProfileVerification,
    User,
)
from app.schemas.tenant_account_links import (
    TenantAccountLinkCreate,
    TenantAccountLinkResponse,
    TenantAccountLinkRevoke,
    TenantStudentAccountLinkCandidateResponse,
    TenantTeacherAccountLinkCandidateResponse,
    TenantLegacyTeacherReconciliation,
    TenantLegacyTeacherReconciliationResponse,
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
                User.role == profile_kind,
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
                User.role == "student",
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


@router.post(
    "/teachers/{teacher_id}/legacy-reconcile",
    response_model=TenantLegacyTeacherReconciliationResponse,
    status_code=status.HTTP_200_OK,
)
def reconcile_legacy_teacher(
    teacher_id: int,
    body: TenantLegacyTeacherReconciliation,
    college_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Adopt one explicitly identified legacy profile only after Admin attestation.

    This does not search, infer, or expose unknown profiles. A College Admin must
    supply the exact existing IDs and evidence references. Foreign-owned profiles,
    inactive accounts, conflicting memberships/links, and inconsistent existing
    assignment ownership fail closed. Existing history is never deleted.
    """
    context = _context(db, current_user, college_id)
    try:
        inspector = inspect(db.get_bind())
        schema = "public" if inspector.dialect.name == "postgresql" else None
        if not inspector.has_table("teacher_profile_verifications", schema=schema) or not inspector.has_table("teacher_management_audit_events", schema=schema):
            raise HTTPException(status_code=503, detail="Legacy Teacher reconciliation requires the reviewed Teacher verification and audit migration.")

        teacher = db.query(Teacher).filter(Teacher.id == teacher_id).with_for_update().one_or_none()
        if teacher is None or (teacher.college_id is not None and teacher.college_id != context.college_id):
            raise HTTPException(status_code=404, detail="Teacher profile not found for reconciliation in the selected College.")
        if not teacher.is_active:
            raise HTTPException(status_code=409, detail="Inactive Teacher profiles must be reviewed through the authorized activation workflow first.")

        user = db.query(User).filter(User.id == body.user_id).with_for_update().one_or_none()
        if user is None or user.role != "teacher" or not user.is_active:
            raise HTTPException(status_code=409, detail="Select an existing active Teacher login account. No account will be created or reactivated.")
        if user.id == context.user_id:
            raise HTTPException(status_code=409, detail="A College Admin cannot link a Teacher profile to their own account.")

        membership = db.query(CollegeMembership).filter(
            CollegeMembership.user_id == user.id,
            CollegeMembership.college_id == context.college_id,
        ).with_for_update().one_or_none()
        membership_created = False
        if membership is not None:
            if membership.role != "teacher" or membership.status != "active":
                raise HTTPException(status_code=409, detail="The existing College membership is not an active Teacher membership. Resolve its approved lifecycle before linking.")

        assignments = db.query(TeacherAssignment).filter(TeacherAssignment.teacher_id == teacher_id).with_for_update().all()
        for assignment in assignments:
            if assignment.college_id not in (None, context.college_id):
                raise HTTPException(status_code=409, detail="An existing Teacher assignment is owned by another College; reconciliation was stopped without changing records.")
            same_college_class = db.query(Class.id).filter(
                Class.id == assignment.class_id,
                Class.college_id == context.college_id,
                Class.college_id.is_not(None),
            ).one_or_none()
            same_college_subject = db.query(Subject.id).filter(
                Subject.id == assignment.subject_id,
                Subject.college_id == context.college_id,
                Subject.college_id.is_not(None),
            ).one_or_none()
            if same_college_class is None or same_college_subject is None:
                raise HTTPException(status_code=409, detail="An existing Class or Subject assignment cannot be verified as belonging to this College; no records were changed.")

        active_profile_link = db.query(TeacherAccountLink).filter(
            TeacherAccountLink.teacher_id == teacher_id,
            TeacherAccountLink.link_status == "active",
        ).with_for_update().one_or_none()
        if active_profile_link is not None and (active_profile_link.college_id != context.college_id or active_profile_link.user_id != user.id):
            raise HTTPException(status_code=409, detail="This Teacher profile already has an active account link.")
        active_user_link = db.query(TeacherAccountLink).filter(
            TeacherAccountLink.user_id == user.id,
            TeacherAccountLink.college_id == context.college_id,
            TeacherAccountLink.link_status == "active",
        ).with_for_update().one_or_none()
        if active_user_link is not None and active_user_link.teacher_id != teacher_id:
            raise HTTPException(status_code=409, detail="This existing User account is already linked to another Teacher profile in this College.")

        ownership_established = teacher.college_id is None
        if ownership_established:
            teacher.college_id = context.college_id
        if membership is None:
            membership = CollegeMembership(
                user_id=user.id,
                college_id=context.college_id,
                role="teacher",
                status="active",
                created_by_user_id=context.user_id,
                activated_by_user_id=context.user_id,
                activated_at=datetime.now(timezone.utc),
                status_reason=f"Legacy Teacher reconciliation; evidence reference: {body.ownership_evidence_reference.strip()}",
            )
            db.add(membership)
            db.flush()
            membership_created = True
        for assignment in assignments:
            if assignment.college_id is None:
                assignment.college_id = context.college_id

        link = active_profile_link
        if link is None:
            link = TeacherAccountLink(
                teacher_id=teacher_id,
                user_id=user.id,
                college_id=context.college_id,
                link_status="active",
                verified_by_user_id=context.user_id,
                verified_at=datetime.now(timezone.utc),
                created_at=datetime.now(timezone.utc),
            )
            db.add(link)
            db.flush()

        evidence_reason = body.reason.strip()
        if ownership_established:
            db.add(TeacherManagementAuditEvent(
                college_id=context.college_id,
                teacher_id=teacher_id,
                related_user_id=user.id,
                actor_user_id=context.user_id,
                action="ownership_established",
                previous_state={"college_id": None},
                new_state={"college_id": context.college_id},
                reason=evidence_reason,
                evidence_reference=body.ownership_evidence_reference.strip(),
            ))
        if membership_created:
            db.add(TeacherManagementAuditEvent(
                college_id=context.college_id,
                teacher_id=teacher_id,
                related_user_id=user.id,
                actor_user_id=context.user_id,
                action="membership_created",
                previous_state={"membership": None},
                new_state={"role": "teacher", "status": "active"},
                reason=evidence_reason,
                evidence_reference=body.ownership_evidence_reference.strip(),
            ))
        if active_profile_link is None:
            db.add(TeacherManagementAuditEvent(
                college_id=context.college_id,
                teacher_id=teacher_id,
                related_user_id=user.id,
                actor_user_id=context.user_id,
                action="account_linked",
                previous_state={"link_status": "missing_or_inactive"},
                new_state={"link_status": "active", "identity_verified": True},
                reason=evidence_reason,
                evidence_reference=body.identity_evidence_reference.strip(),
            ))

        verification = db.query(TeacherProfileVerification).filter_by(
            teacher_id=teacher_id, college_id=context.college_id,
        ).one_or_none()
        if verification is None:
            verification_status = "pending"
        else:
            verification_status = verification.verification_status
        db.commit()
        db.refresh(link)
        return TenantLegacyTeacherReconciliationResponse(
            id=link.id,
            profile_id=teacher_id,
            user_id=user.id,
            college_id=context.college_id,
            link_status=link.link_status,
            verified_by_user_id=link.verified_by_user_id,
            verified_at=link.verified_at,
            profile_is_active=teacher.is_active,
            user_is_active=user.is_active,
            membership_status=membership.status,
            profile_verification_status=verification_status,
            membership_created=membership_created,
            ownership_established=ownership_established,
        )
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Legacy Teacher reconciliation conflicts with an existing College relationship.") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="Legacy Teacher reconciliation is unavailable.") from exc


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
                User.role == "teacher",
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
