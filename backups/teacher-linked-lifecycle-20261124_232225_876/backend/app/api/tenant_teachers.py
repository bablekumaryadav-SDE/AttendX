"""College-scoped Teacher directory and registration routes."""

from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, inspect, or_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import (
    AttendanceAuditLog,
    Class,
    College,
    CollegeMembership,
    Subject,
    Teacher,
    TeacherAccountLink,
    TeacherAssignment,
    TeacherManagementAuditEvent,
    TeacherProfileVerification,
    User,
)
from app.schemas.tenant_registration import (
    TenantPasswordReset,
    TenantTeacherAssignmentInput,
    TenantTeacherCreate,
    TenantTeacherRegisteredResponse,
)
from app.schemas.tenant_teacher import (
    TenantTeacherAssignmentResponse,
    TenantTeacherManagedProfileResponse,
    TenantTeacherResponse,
    TenantTeacherSelfProfileResponse,
    TenantTeacherUpdate,
    TenantTeacherVerificationResponse,
    TenantTeacherVerificationUpdate,
    TenantTeacherManagementAuditResponse,
)
from app.security import get_password_hash
from app.services.account_activation import invitation_status, issue_invitation
from app.services.tenant_password_reset import reset_tenant_account_password
from app.tenant_context import resolve_tenant_context
from app.tenant_ownership import resolve_college_record
from app.tenant_relationship_history import active_relationship_at, as_utc_datetime, has_effective_date_columns, relationship_is_active_at


router = APIRouter()
READ_ROLES = frozenset({"college_admin", "teacher", "student"})
WRITE_ROLES = frozenset({"college_admin"})
_UNAVAILABLE = "College-scoped Teacher catalog is unavailable."


@router.get("/me/profile", response_model=TenantTeacherSelfProfileResponse)
def read_my_teacher_profile(
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_teacher_context(db, current_user, college_id)
    if context.membership_role != "teacher":
        raise HTTPException(status_code=403, detail="Teacher membership is required.")
    try:
        account = db.query(User.id).filter(User.id == context.user_id, User.is_active.is_(True)).one_or_none()
        if account is None:
            raise HTTPException(status_code=401, detail="Active account required.")
        link = db.query(TeacherAccountLink).filter(
            TeacherAccountLink.user_id == context.user_id,
            TeacherAccountLink.college_id == context.college_id,
            TeacherAccountLink.link_status == "active",
        ).one_or_none()
        if link is None:
            raise HTTPException(status_code=403, detail="An active, verified Teacher profile link is required in this College.")
        teacher = db.query(Teacher).filter(
            Teacher.id == link.teacher_id,
            Teacher.college_id == context.college_id,
            Teacher.college_id.is_not(None),
            Teacher.is_active.is_(True),
        ).one_or_none()
        college = db.query(College).filter(
            College.id == context.college_id,
            College.status == "active",
        ).one_or_none()
        if teacher is None or college is None:
            raise HTTPException(status_code=404, detail="Active Teacher profile not found.")
        require_verified_teacher_profile(db, teacher, context.college_id)
        return {
            "id": teacher.id,
            "college_id": context.college_id,
            "college_name": college.display_name or college.official_name,
            "name": teacher.name,
            "email": teacher.email,
            "employee_id": teacher.employee_id,
            "department": teacher.department,
            "designation": teacher.designation,
            "qualification": teacher.qualification,
            "mobile": teacher.mobile,
            "address": teacher.address,
            "joining_date": teacher.joining_date,
            "is_active": teacher.is_active,
            "created_at": teacher.created_at,
        }
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc


def _resolve_teacher_context(db: Session, current_user, college_id=None):
    try:
        return resolve_tenant_context(
            db,
            current_user,
            allowed_roles=READ_ROLES,
            requested_college_id=college_id,
        )
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=_UNAVAILABLE,
        ) from exc


def _unavailable():
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=_UNAVAILABLE,
    )


def _require_teacher_verification_schema(db: Session):
    inspector = inspect(db.get_bind())
    required = {
        "teacher_profile_verifications": {
            "teacher_id", "college_id", "verification_status", "verified_by_admin_id",
            "verified_at", "rejected_by_admin_id", "rejected_at", "verification_reason",
        },
        "teacher_management_audit_events": {
            "id", "college_id", "teacher_id", "actor_user_id", "action",
            "previous_state", "new_state", "reason", "created_at",
        },
    }
    for table, columns in required.items():
        if not inspector.has_table(table, schema="public" if inspector.dialect.name == "postgresql" else None):
            raise HTTPException(status_code=503, detail="Teacher profile verification schema is unavailable. Apply the reviewed migration before using verification actions.")
        actual = {column["name"] for column in inspector.get_columns(table, schema="public" if inspector.dialect.name == "postgresql" else None)}
        if not columns.issubset(actual):
            raise HTTPException(status_code=503, detail="Teacher profile verification schema is incomplete. Review the migration state before retrying.")


def _verification_response(teacher_id: int, college_id: int, row=None):
    return TenantTeacherVerificationResponse(
        teacher_id=teacher_id,
        college_id=college_id,
        verification_status=row.verification_status if row is not None else "pending",
        verified_by_admin_id=row.verified_by_admin_id if row is not None else None,
        verified_at=row.verified_at if row is not None else None,
        rejected_by_admin_id=row.rejected_by_admin_id if row is not None else None,
        rejected_at=row.rejected_at if row is not None else None,
        verification_reason=row.verification_reason if row is not None else None,
    )


def require_verified_teacher_profile(db: Session, teacher: Teacher, college_id: int):
    _require_teacher_verification_schema(db)
    row = db.query(TeacherProfileVerification).filter(
        TeacherProfileVerification.teacher_id == teacher.id,
        TeacherProfileVerification.college_id == college_id,
    ).one_or_none()
    if row is None or row.verification_status != "verified":
        status_text = row.verification_status if row is not None else "pending"
        raise HTTPException(status_code=403, detail=f"Teacher profile verification is {status_text}. Ask the College Admin to review the profile.")
    return row


def _relationship_dates_unavailable():
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Date-aware Teacher assignments require the reviewed relationship effective-date migration.",
    )


def _teacher_identity_conflict(db: Session, college_id: int, email: str, employee_id: str) -> bool:
    """Email is globally unique for login; employee IDs are College-local."""
    if db.query(User.id).filter(User.email == email).first():
        return True
    return db.query(Teacher.id).filter(
        or_(
            Teacher.email == email,
            and_(Teacher.college_id == college_id, Teacher.employee_id == employee_id),
        )
    ).first() is not None


def _generate_employee_id(db: Session, college_id: int) -> str:
    """Generate a College-scoped identifier without accepting one from the caller."""
    try:
        for _ in range(5):
            candidate = f"TCH-{college_id}-{uuid4().hex.upper()}"
            if not db.query(Teacher.id).filter(
                Teacher.college_id == college_id,
                Teacher.employee_id == candidate,
            ).first():
                return candidate
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc
    raise HTTPException(status_code=503, detail="A Teacher ID could not be generated. Please retry.")


@router.get("/", response_model=list[TenantTeacherResponse])
def list_tenant_teachers(
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_teacher_context(db, current_user, college_id)
    try:
        return (
            db.query(Teacher)
            .filter(
                Teacher.college_id == context.college_id,
                Teacher.college_id.is_not(None),
            )
            .order_by(Teacher.id.asc())
            .all()
        )
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc


@router.get("/{teacher_id}", response_model=TenantTeacherResponse)
def read_tenant_teacher(
    teacher_id: int,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_teacher_context(db, current_user, college_id)
    try:
        return resolve_college_record(db, Teacher, teacher_id, context)
    except HTTPException as exc:
        if exc.status_code != status.HTTP_503_SERVICE_UNAVAILABLE:
            raise
        raise _unavailable() from exc


@router.get("/{teacher_id}/management-profile", response_model=TenantTeacherManagedProfileResponse)
def read_tenant_teacher_management_profile(
    teacher_id: int,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_teacher_context(db, current_user, college_id)
    if context.membership_role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="College administrator membership required.")
    try:
        return resolve_college_record(db, Teacher, teacher_id, context)
    except HTTPException as exc:
        if exc.status_code != status.HTTP_503_SERVICE_UNAVAILABLE:
            raise
        raise _unavailable() from exc


@router.patch("/{teacher_id}", response_model=TenantTeacherResponse)
def update_tenant_teacher(
    teacher_id: int,
    payload: TenantTeacherUpdate,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_teacher_context(db, current_user, college_id)
    if context.membership_role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="College administrator membership required.")
    try:
        teacher = db.query(Teacher).filter(
            Teacher.id == teacher_id,
            Teacher.college_id == context.college_id,
            Teacher.college_id.is_not(None),
        ).with_for_update().one_or_none()
        if teacher is None:
            raise HTTPException(status_code=404, detail="Record not found.")
        if not teacher.is_active:
            raise HTTPException(status_code=409, detail="Inactive Teacher profiles cannot be edited.")
        changes = payload.model_dump(exclude_unset=True)
        for field, value in changes.items():
            setattr(teacher, field, value)
        db.commit()
        db.refresh(teacher)
        return teacher
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Teacher profile conflicts with existing data.") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc


@router.delete("/{teacher_id}")
def deactivate_tenant_teacher(
    teacher_id: int,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_teacher_context(db, current_user, college_id)
    if context.membership_role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="College administrator membership required.")
    try:
        teacher = db.query(Teacher).filter(
            Teacher.id == teacher_id,
            Teacher.college_id == context.college_id,
            Teacher.college_id.is_not(None),
        ).with_for_update().one_or_none()
        if teacher is None:
            raise HTTPException(status_code=404, detail="Record not found.")
        if not teacher.is_active:
            raise HTTPException(status_code=409, detail="Teacher profile is already inactive.")
        account = db.query(User).filter(User.email == teacher.email, User.role == "teacher").with_for_update().one_or_none()
        membership = None
        if account is not None:
            membership = db.query(CollegeMembership).filter(
                CollegeMembership.user_id == account.id,
                CollegeMembership.college_id == context.college_id,
                CollegeMembership.role == "teacher",
                CollegeMembership.status == "active",
            ).with_for_update().one_or_none()
        teacher.is_active = False
        assignment_query = db.query(TeacherAssignment).filter(
            TeacherAssignment.teacher_id == teacher.id,
            TeacherAssignment.college_id == context.college_id,
            TeacherAssignment.college_id.is_not(None),
        )
        if has_effective_date_columns(db, TeacherAssignment):
            now = datetime.now(timezone.utc)
            for assignment in assignment_query.all():
                assignment_start = as_utc_datetime(assignment.effective_from)
                if relationship_is_active_at(legacy_active=assignment.is_active, effective_from=assignment_start, effective_to=assignment.effective_to, at=now) or (assignment_start is not None and assignment_start > now):
                    assignment.effective_to = assignment.effective_from if assignment_start is not None and assignment_start > now else now
                    assignment.is_active = False
        else:
            assignment_query = assignment_query.filter(TeacherAssignment.is_active.is_(True))
            assignment_query.update({TeacherAssignment.is_active: False}, synchronize_session=False)
        if membership is not None:
            membership.status = "revoked"
            membership.revoked_at = datetime.now(timezone.utc)
            membership.revoked_by_user_id = context.user_id
            membership.status_reason = "Teacher deactivated by College Admin."
        if account is not None:
            another_active_membership = db.query(CollegeMembership.id).filter(
                CollegeMembership.user_id == account.id,
                CollegeMembership.status == "active",
                CollegeMembership.college_id != context.college_id,
            ).first()
            if another_active_membership is None:
                account.is_active = False
        db.add(AttendanceAuditLog(
            college_id=context.college_id,
            user_id=context.user_id,
            action="teacher_deactivated",
            entity_type="Teacher",
            entity_id=teacher.id,
            event_metadata={"teacher_id": teacher.id, "membership_id": membership.id if membership else None},
        ))
        db.commit()
        return {"id": teacher.id, "is_active": False, "membership_status": membership.status if membership else None}
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc


@router.get("/{teacher_id}/assignments", response_model=list[TenantTeacherAssignmentResponse])
def list_tenant_teacher_assignments(
    teacher_id: int,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_teacher_context(db, current_user, college_id)
    try:
        teacher = resolve_college_record(db, Teacher, teacher_id, context)
        if context.membership_role != "college_admin":
            if not teacher.is_active:
                raise HTTPException(status_code=403, detail="An active Teacher profile is required.")
            verified_link = db.query(TeacherAccountLink.id).filter(
                TeacherAccountLink.teacher_id == teacher.id,
                TeacherAccountLink.user_id == context.user_id,
                TeacherAccountLink.college_id == context.college_id,
                TeacherAccountLink.link_status == "active",
            ).one_or_none()
            if verified_link is None:
                raise HTTPException(status_code=403, detail="An active, verified Teacher profile link is required in this College.")
            require_verified_teacher_profile(db, teacher, context.college_id)
        assignments = db.query(TeacherAssignment).filter(
            TeacherAssignment.teacher_id == teacher.id,
            TeacherAssignment.college_id == context.college_id,
            TeacherAssignment.college_id.is_not(None),
        ).order_by(TeacherAssignment.is_active.desc(), TeacherAssignment.id.asc()).all()
        temporal = has_effective_date_columns(db, TeacherAssignment)
        now = datetime.now(timezone.utc)
        return [{
            "id": row.id,
            "teacher_id": row.teacher_id,
            "class_id": row.class_id,
            "subject_id": row.subject_id,
            "academic_year": row.academic_year,
            "semester": row.semester,
            "is_active": relationship_is_active_at(
                legacy_active=row.is_active,
                effective_from=row.effective_from if temporal else None,
                effective_to=row.effective_to if temporal else None,
                at=now,
            ),
            "effective_from": row.effective_from if temporal else None,
            "effective_to": row.effective_to if temporal else None,
        } for row in assignments]
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc


@router.post("/{teacher_id}/assignments", response_model=TenantTeacherAssignmentResponse, status_code=status.HTTP_201_CREATED)
def assign_tenant_teacher(
    teacher_id: int,
    payload: TenantTeacherAssignmentInput,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_teacher_context(db, current_user, college_id)
    if context.membership_role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="College administrator membership required.")
    if not has_effective_date_columns(db, TeacherAssignment):
        raise _relationship_dates_unavailable()
    now = datetime.now(timezone.utc)
    if payload.effective_from < now:
        if (now - payload.effective_from).total_seconds() > 60:
            raise HTTPException(status_code=422, detail="Assignment start cannot be backdated.")
        payload.effective_from = now
    try:
        teacher = db.query(Teacher).filter(
            Teacher.id == teacher_id,
            Teacher.college_id == context.college_id,
            Teacher.college_id.is_not(None),
        ).with_for_update().one_or_none()
        if teacher is None:
            raise HTTPException(status_code=404, detail="Record not found.")
        if not teacher.is_active:
            raise HTTPException(status_code=409, detail="Inactive Teachers cannot receive new assignments.")
        class_record = db.query(Class).filter(
            Class.id == payload.class_id,
            Class.college_id == context.college_id,
            Class.college_id.is_not(None),
            Class.is_active.is_(True),
        ).with_for_update().one_or_none()
        subject = db.query(Subject).filter(
            Subject.id == payload.subject_id,
            Subject.college_id == context.college_id,
            Subject.college_id.is_not(None),
            Subject.is_active.is_(True),
        ).one_or_none()
        if class_record is None or subject is None:
            raise HTTPException(status_code=404, detail="An assignment class or subject was not found.")
        duplicate = db.query(TeacherAssignment.id).filter(
            TeacherAssignment.teacher_id == teacher.id,
            TeacherAssignment.class_id == class_record.id,
            TeacherAssignment.subject_id == subject.id,
            TeacherAssignment.college_id == context.college_id,
            TeacherAssignment.academic_year == payload.academic_year,
            TeacherAssignment.semester == payload.semester,
            TeacherAssignment.is_active.is_(True),
        ).first()
        if duplicate:
            raise HTTPException(status_code=409, detail="Teacher already has this active class and subject assignment.")
        overlapping_assignments = db.query(TeacherAssignment).filter(
            TeacherAssignment.class_id == class_record.id,
            TeacherAssignment.subject_id == subject.id,
            TeacherAssignment.college_id == context.college_id,
            active_relationship_at(db, TeacherAssignment, payload.effective_from),
        ).with_for_update().all()
        for old_assignment in overlapping_assignments:
            old_start = as_utc_datetime(old_assignment.effective_from)
            if old_start is not None and old_start >= payload.effective_from:
                raise HTTPException(status_code=409, detail="This assignment overlaps a scheduled assignment for the same Class and Subject.")
            old_assignment.effective_to = payload.effective_from
            old_assignment.is_active = False
        assignment = TeacherAssignment(
            college_id=context.college_id,
            teacher_id=teacher.id,
            class_id=class_record.id,
            subject_id=subject.id,
            academic_year=payload.academic_year,
            semester=payload.semester,
            is_active=(payload.effective_from <= now and (payload.effective_to is None or payload.effective_to > now)),
            effective_from=payload.effective_from,
            effective_to=payload.effective_to,
        )
        db.add(assignment)
        db.commit()
        db.refresh(assignment)
        return assignment
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Teacher assignment conflicts with existing data.") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc


@router.delete("/{teacher_id}/assignments/{assignment_id}", response_model=TenantTeacherAssignmentResponse)
def deactivate_tenant_teacher_assignment(
    teacher_id: int,
    assignment_id: int,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_teacher_context(db, current_user, college_id)
    if context.membership_role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="College administrator membership required.")
    if not has_effective_date_columns(db, TeacherAssignment):
        raise _relationship_dates_unavailable()
    try:
        assignment = db.query(TeacherAssignment).filter(
            TeacherAssignment.id == assignment_id,
            TeacherAssignment.teacher_id == teacher_id,
            TeacherAssignment.college_id == context.college_id,
            TeacherAssignment.college_id.is_not(None),
        ).with_for_update().one_or_none()
        if assignment is None:
            raise HTTPException(status_code=404, detail="Record not found.")
        now = datetime.now(timezone.utc)
        assignment.effective_to = (
            assignment.effective_from
            if as_utc_datetime(assignment.effective_from) is not None and as_utc_datetime(assignment.effective_from) > now
            else now
        )
        assignment.is_active = False
        db.commit()
        db.refresh(assignment)
        return assignment
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc


@router.patch("/{teacher_id}/password", status_code=status.HTTP_200_OK)
def reset_tenant_teacher_password(
    teacher_id: int,
    payload: TenantPasswordReset,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_teacher_context(db, current_user, college_id)
    if context.membership_role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="College administrator membership required.")
    try:
        teacher = resolve_college_record(db, Teacher, teacher_id, context)
        reset_tenant_account_password(
            db,
            account_email=teacher.email,
            expected_global_role="teacher",
            profile_type="Teacher",
            profile_id=teacher.id,
            profile_is_active=teacher.is_active,
            context=context,
            password=payload.password.get_secret_value(),
        )
        return {"id": teacher.id, "password_reset": True}
    except HTTPException as exc:
        if exc.status_code == status.HTTP_503_SERVICE_UNAVAILABLE:
            raise _unavailable() from exc
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc


@router.post("/", response_model=TenantTeacherRegisteredResponse, status_code=status.HTTP_201_CREATED)
def create_tenant_teacher(
    payload: TenantTeacherCreate,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_teacher_context(db, current_user, college_id)
    if context.membership_role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="College administrator membership required.")
    _require_teacher_verification_schema(db)
    if payload.assignments and not has_effective_date_columns(db, TeacherAssignment):
        raise _relationship_dates_unavailable()
    now = datetime.now(timezone.utc)
    for assignment in payload.assignments:
        if assignment.effective_from < now:
            if (now - assignment.effective_from).total_seconds() > 60:
                raise HTTPException(status_code=422, detail="Assignment start cannot be backdated.")
            assignment.effective_from = now
    email = str(payload.email).strip().lower()
    employee_id = _generate_employee_id(db, context.college_id)
    if _teacher_identity_conflict(db, context.college_id, email, employee_id):
        raise HTTPException(status_code=409, detail="An account or Teacher record already uses these details.")
    for assignment in payload.assignments:
        valid_class = db.query(Class.id).filter(
            Class.id == assignment.class_id,
            Class.college_id == context.college_id,
            Class.college_id.is_not(None),
            Class.is_active.is_(True),
        ).with_for_update().one_or_none()
        valid_subject = db.query(Subject.id).filter(
            Subject.id == assignment.subject_id,
            Subject.college_id == context.college_id,
            Subject.college_id.is_not(None),
            Subject.is_active.is_(True),
        ).one_or_none()
        if valid_class is None or valid_subject is None:
            raise HTTPException(status_code=404, detail="An assignment class or subject was not found.")

    teacher = Teacher(
        college_id=context.college_id,
        name=payload.name,
        email=email,
        employee_id=employee_id,
        department=payload.department,
        gender=payload.gender,
        designation=payload.designation,
        qualification=payload.qualification,
        mobile=payload.mobile,
        address=payload.address,
        joining_date=payload.joining_date,
        is_active=True,
    )
    try:
        user = User(
            name=payload.name,
            email=email,
            hashed_password=get_password_hash(payload.password.get_secret_value()),
            role="teacher",
            is_active=True,
        )
        db.add_all([user, teacher])
        db.flush()
        membership = CollegeMembership(
            user_id=user.id,
            college_id=context.college_id,
            role="teacher",
            status="active",
            created_by_user_id=context.user_id,
            activated_by_user_id=context.user_id,
            activated_at=datetime.now(timezone.utc),
            status_reason="Permanent password set by College Admin during registration.",
        )
        db.add(membership)
        db.flush()
        # This account and profile were created together by this authorized
        # College Admin. Link their generated IDs directly; never match an
        # existing account using email, name, employee ID, or phone.
        db.add(TeacherAccountLink(
            teacher_id=teacher.id,
            user_id=user.id,
            college_id=context.college_id,
            link_status="active",
            verified_by_user_id=context.user_id,
            verified_at=now,
            created_at=now,
        ))
        db.add(TeacherProfileVerification(
            teacher_id=teacher.id,
            college_id=context.college_id,
            verification_status="pending",
        ))
        for assignment in payload.assignments:
            existing_assignments = db.query(TeacherAssignment).filter(
                TeacherAssignment.class_id == assignment.class_id,
                TeacherAssignment.subject_id == assignment.subject_id,
                TeacherAssignment.college_id == context.college_id,
                active_relationship_at(db, TeacherAssignment, assignment.effective_from),
            ).with_for_update().all()
            for existing in existing_assignments:
                existing_start = as_utc_datetime(existing.effective_from)
                if existing_start is not None and existing_start >= assignment.effective_from:
                    raise HTTPException(status_code=409, detail="This assignment overlaps a scheduled assignment for the same Class and Subject.")
                existing.effective_to = assignment.effective_from
                existing.is_active = False
            db.add(TeacherAssignment(
                college_id=context.college_id,
                teacher_id=teacher.id,
                subject_id=assignment.subject_id,
                class_id=assignment.class_id,
                academic_year=assignment.academic_year,
                semester=assignment.semester,
                is_active=(assignment.effective_from <= datetime.now(timezone.utc) and (assignment.effective_to is None or assignment.effective_to > datetime.now(timezone.utc))),
                effective_from=assignment.effective_from,
                effective_to=assignment.effective_to,
            ))
            db.flush()
        db.commit()
        db.refresh(teacher)
        return {
            "id": teacher.id,
            "name": teacher.name,
            "employee_id": teacher.employee_id,
            "department": teacher.department,
            "is_active": teacher.is_active,
            "account_activation": "active",
            "invitation_status": "not_required",
            "profile_verification_status": "pending",
        }
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A Teacher, account, or assignment conflicts with existing data.") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc


def _teacher_invitation_target(db: Session, teacher_id: int, college_id: int):
    teacher = db.query(Teacher).filter(
        Teacher.id == teacher_id,
        Teacher.college_id == college_id,
        Teacher.college_id.is_not(None),
    ).one_or_none()
    if teacher is None:
        raise HTTPException(status_code=404, detail="Record not found.")
    pair = db.query(User, CollegeMembership).join(
        CollegeMembership, CollegeMembership.user_id == User.id
    ).filter(
        User.email == teacher.email,
        User.role == "teacher",
        CollegeMembership.college_id == college_id,
        CollegeMembership.role == "teacher",
    ).one_or_none()
    if pair is None:
        raise HTTPException(status_code=409, detail="No pending account invitation is available.")
    return teacher, pair[0], pair[1]


@router.get("/{teacher_id}/invitation")
def get_teacher_invitation_status(
    teacher_id: int,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_teacher_context(db, current_user, college_id)
    if context.membership_role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="College administrator membership required.")
    _teacher, _user, membership = _teacher_invitation_target(db, teacher_id, context.college_id)
    result = invitation_status(db, membership)
    return {"status": result["status"], "expires_at": result["expires_at"], "membership_status": membership.status}


@router.post("/{teacher_id}/invitation/resend")
def resend_teacher_invitation(
    teacher_id: int,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_teacher_context(db, current_user, college_id)
    if context.membership_role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="College administrator membership required.")
    teacher, user, membership = _teacher_invitation_target(db, teacher_id, context.college_id)
    if teacher.is_active or user.is_active or membership.status != "pending":
        raise HTTPException(status_code=409, detail="This account is already active.")
    result = issue_invitation(db, user=user, membership=membership, actor_user_id=context.user_id)
    if result in {"not_configured", "unavailable"}:
        raise HTTPException(status_code=503, detail="Invitation email is not configured or temporarily unavailable.")
    return {"status": result, "message": "Invitation processed. The account holder must set a password before sign-in."}


@router.get("/{teacher_id}/verification", response_model=TenantTeacherVerificationResponse)
def read_tenant_teacher_profile_verification(
    teacher_id: int,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_teacher_context(db, current_user, college_id)
    if context.membership_role != "college_admin":
        raise HTTPException(status_code=403, detail="College administrator membership required.")
    try:
        _require_teacher_verification_schema(db)
        teacher = db.query(Teacher).filter(
            Teacher.id == teacher_id,
            Teacher.college_id == context.college_id,
            Teacher.college_id.is_not(None),
        ).one_or_none()
        if teacher is None:
            raise HTTPException(status_code=404, detail="Teacher profile not found in the selected College.")
        row = db.query(TeacherProfileVerification).filter_by(
            teacher_id=teacher_id, college_id=context.college_id,
        ).one_or_none()
        return _verification_response(teacher_id, context.college_id, row)
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc


@router.put("/{teacher_id}/verification", response_model=TenantTeacherVerificationResponse)
def review_tenant_teacher_profile(
    teacher_id: int,
    payload: TenantTeacherVerificationUpdate,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_teacher_context(db, current_user, college_id)
    if context.membership_role != "college_admin":
        raise HTTPException(status_code=403, detail="College administrator membership required.")
    try:
        _require_teacher_verification_schema(db)
        teacher = db.query(Teacher).filter(
            Teacher.id == teacher_id,
            Teacher.college_id == context.college_id,
            Teacher.college_id.is_not(None),
        ).with_for_update().one_or_none()
        if teacher is None:
            raise HTTPException(status_code=404, detail="Teacher profile not found in the selected College.")
        if not teacher.is_active:
            raise HTTPException(status_code=409, detail="Inactive Teacher profiles cannot be verified or rejected.")

        row = db.query(TeacherProfileVerification).filter_by(
            teacher_id=teacher_id, college_id=context.college_id,
        ).with_for_update().one_or_none()
        previous_status = row.verification_status if row is not None else "pending"
        if previous_status == payload.verification_status:
            return _verification_response(teacher_id, context.college_id, row)

        now = datetime.now(timezone.utc)
        if row is None:
            row = TeacherProfileVerification(
                teacher_id=teacher_id,
                college_id=context.college_id,
                verification_status="pending",
            )
            db.add(row)
            db.flush()
        row.verification_status = payload.verification_status
        row.verification_reason = payload.reason
        if payload.verification_status == "verified":
            row.verified_by_admin_id = context.user_id
            row.verified_at = now
            row.rejected_by_admin_id = None
            row.rejected_at = None
            action = "profile_verified"
        else:
            row.verified_by_admin_id = None
            row.verified_at = None
            row.rejected_by_admin_id = context.user_id
            row.rejected_at = now
            action = "profile_rejected"
        db.flush()

        active_link = db.query(TeacherAccountLink.user_id).filter(
            TeacherAccountLink.teacher_id == teacher_id,
            TeacherAccountLink.college_id == context.college_id,
            TeacherAccountLink.link_status == "active",
        ).one_or_none()
        db.add(TeacherManagementAuditEvent(
            college_id=context.college_id,
            teacher_id=teacher_id,
            related_user_id=active_link[0] if active_link is not None else None,
            actor_user_id=context.user_id,
            action=action,
            previous_state={"verification_status": previous_status},
            new_state={"verification_status": payload.verification_status},
            reason=payload.reason,
        ))
        db.commit()
        db.refresh(row)
        return _verification_response(teacher_id, context.college_id, row)
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Teacher profile review conflicts with current College records.") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc


@router.get("/{teacher_id}/verification-history", response_model=list[TenantTeacherManagementAuditResponse])
def list_tenant_teacher_verification_history(
    teacher_id: int,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_teacher_context(db, current_user, college_id)
    if context.membership_role != "college_admin":
        raise HTTPException(status_code=403, detail="College administrator membership required.")
    try:
        _require_teacher_verification_schema(db)
        teacher = db.query(Teacher.id).filter(
            Teacher.id == teacher_id,
            Teacher.college_id == context.college_id,
            Teacher.college_id.is_not(None),
        ).one_or_none()
        if teacher is None:
            raise HTTPException(status_code=404, detail="Teacher profile not found in the selected College.")
        return db.query(TeacherManagementAuditEvent).filter(
            TeacherManagementAuditEvent.teacher_id == teacher_id,
            TeacherManagementAuditEvent.college_id == context.college_id,
            TeacherManagementAuditEvent.action.in_(("profile_verified", "profile_rejected")),
        ).order_by(TeacherManagementAuditEvent.created_at.desc(), TeacherManagementAuditEvent.id.desc()).all()
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc
