"""College-scoped Student directory and registration routes."""

from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, or_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import (
    Class,
    CollegeMembership,
    FaceEmbedding,
    Student,
    StudentAccountLink,
    StudentAcademicHistory,
    StudentClassAssignment,
    StudentGuardian,
    User,
)
from app.schemas.tenant_registration import (
    TenantStudentAcademicHistoryResponse,
    TenantStudentCreate,
    TenantStudentPromotion,
    TenantPasswordReset,
    TenantStudentRegisteredResponse,
)
from app.schemas.tenant_student import (
    TenantStudentClassAssignmentInput,
    TenantStudentClassAssignmentResponse,
    TenantStudentPage,
    TenantStudentProfileResponse,
    TenantStudentResponse,
    TenantStudentStatusResponse,
    TenantStudentUpdate,
)
from app.security import get_password_hash
from app.services.student_module import next_student_code
from app.services.account_activation import invitation_status, issue_invitation
from app.services.face_engine import is_valid_embedding
from app.services.tenant_password_reset import reset_tenant_account_password
from app.tenant_context import resolve_tenant_context
from app.tenant_ownership import resolve_college_record
from app.tenant_relationship_history import active_relationship_at, as_utc_datetime, has_effective_date_columns, relationship_is_active_at


router = APIRouter()
# This is the Admin Students directory; ordinary student memberships do not
# authorize reading other students' personal directory data.
READ_ROLES = frozenset({"college_admin"})
WRITE_ROLES = frozenset({"college_admin"})
_UNAVAILABLE = "College-scoped Student directory is unavailable."


def _resolve_student_context(db: Session, current_user, college_id=None):
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


def _relationship_dates_unavailable():
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Date-aware enrollment requires the reviewed relationship effective-date migration.",
    )


def _student_identity_conflict_detail(db: Session, college_id: int, email: str, roll_number: str):
    """Return a safe field conflict; email is global, roll number is College-local."""
    normalized_email = email.strip().casefold()
    if db.query(User.id).filter(func.lower(User.email) == normalized_email).first():
        return {
            "code": "email_already_registered",
            "field": "email",
            "message": "Email already belongs to an account. Use a different email address.",
        }
    if db.query(Student.id).filter(func.lower(Student.email) == normalized_email).first():
        return {
            "code": "email_already_registered",
            "field": "email",
            "message": "Email already belongs to an account. Use a different email address.",
        }
    if db.query(Student.id).filter(
        Student.college_id == college_id,
        Student.college_id.is_not(None),
        Student.roll_number == roll_number,
    ).first():
        return {
            "code": "roll_number_already_used",
            "field": "roll_number",
            "message": "Roll number already exists in this College.",
        }
    return None


def _student_identity_conflict(db: Session, college_id: int, email: str, roll_number: str) -> bool:
    """Compatibility predicate used by existing callers and static tests."""
    return _student_identity_conflict_detail(db, college_id, email, roll_number) is not None


def _student_integrity_error_detail(exc: IntegrityError):
    """Map known unique violations to safe fields without returning driver details."""
    original = exc.orig
    diagnostic = getattr(original, "diag", None)
    constraint = str(getattr(diagnostic, "constraint_name", "") or "").lower()
    message = str(original).lower()

    if any(token in constraint for token in ("users_email", "students_email")) or any(
        token in message for token in ("users.email", "students.email")
    ):
        return {
            "code": "email_already_registered",
            "field": "email",
            "message": "Email already belongs to an account. Use a different email address.",
        }
    if "enrollment" in constraint or "students.college_id, students.enrollment_number" in message:
        return {
            "code": "enrollment_number_already_used",
            "field": "enrollment_number",
            "message": "Enrollment number already exists in this College.",
        }
    if "roll_number" in constraint or "students.college_id, students.roll_number" in message:
        return {
            "code": "roll_number_already_used",
            "field": "roll_number",
            "message": "Roll number already exists in this College.",
        }
    if any(token in constraint for token in ("student_code", "studentcode")) or "students.student_code" in message:
        return {
            "code": "student_code_collision",
            "field": "student_code",
            "message": "A generated Student ID conflicted with existing data. No account was created; retry registration.",
        }
    return {
        "code": "student_registration_conflict",
        "field": "registration",
        "message": "Student registration conflicts with existing related records. No account was created.",
    }


def _registered_face_student_ids(db: Session, college_id: int, student_ids=None) -> set[int]:
    query = db.query(
        FaceEmbedding.student_id,
        FaceEmbedding.status,
        FaceEmbedding.embedding_json,
    ).join(Student, Student.id == FaceEmbedding.student_id).filter(
        Student.college_id == college_id,
        Student.college_id.is_not(None),
    )
    if student_ids is not None:
        ids = list(student_ids)
        if not ids:
            return set()
        query = query.filter(Student.id.in_(ids))
    return {
        student_id
        for student_id, face_status, embedding_json in query.all()
        if face_status == "registered" and is_valid_embedding(embedding_json)
    }


@router.get("/", response_model=TenantStudentPage)
def list_tenant_students(
    college_id: Optional[int] = Query(default=None, gt=0),
    search: Optional[str] = Query(default=None, max_length=100),
    course: Optional[str] = Query(default=None, max_length=120),
    department: Optional[str] = Query(default=None, max_length=100),
    admission_year: Optional[int] = Query(default=None, ge=1900, le=2200),
    current_academic_year: Optional[int] = Query(default=None, ge=1, le=12),
    current_semester: Optional[int] = Query(default=None, ge=1, le=24),
    section: Optional[str] = Query(default=None, max_length=50),
    active_only: bool = False,
    face_status: Optional[Literal["registered", "not_registered"]] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_student_context(db, current_user, college_id)
    try:
        college_student_scope = db.query(Student.id).filter(
            Student.college_id == context.college_id,
            Student.college_id.is_not(None),
        )
        college_student_count = college_student_scope.count()
        registered_face_ids = _registered_face_student_ids(db, context.college_id)
        query = db.query(Student).filter(
            Student.college_id == context.college_id,
            Student.college_id.is_not(None),
        )
        if active_only:
            query = query.filter(Student.is_active.is_(True))
        if face_status == "registered":
            query = query.filter(Student.id.in_(registered_face_ids))
        elif face_status == "not_registered":
            query = query.filter(Student.id.not_in(registered_face_ids))
        for column, value in (
            (Student.course, course),
            (Student.department, department),
            (Student.admission_year, admission_year),
            (Student.current_academic_year, current_academic_year),
            (Student.current_semester, current_semester),
            (Student.section, section),
        ):
            if value is not None:
                query = query.filter(column == value)
        if search and search.strip():
            term = f"%{search.strip()}%"
            query = query.filter(
                Student.name.ilike(term)
                | Student.email.ilike(term)
                | Student.roll_number.ilike(term)
                | Student.enrollment_number.ilike(term)
                | Student.student_code.ilike(term)
                | Student.department.ilike(term)
            )
        total = query.count()
        active_count = query.filter(Student.is_active.is_(True)).count()
        inactive_count = query.filter(Student.is_active.is_(False)).count()
        items = query.order_by(Student.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
        return {
            "items": [
                {
                    **TenantStudentResponse.model_validate(item).model_dump(),
                    "face_registered": item.id in registered_face_ids,
                    "face_status": "registered" if item.id in registered_face_ids else "not_registered",
                }
                for item in items
            ],
            "total": total,
            "page": page,
            "page_size": page_size,
            "active_count": active_count,
            "inactive_count": inactive_count,
            "face_registered_count": len(registered_face_ids),
            "face_not_registered_count": max(0, college_student_count - len(registered_face_ids)),
        }
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc


@router.get("/{student_id}", response_model=TenantStudentProfileResponse)
def read_tenant_student(
    student_id: int,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_student_context(db, current_user, college_id)
    try:
        student = resolve_college_record(db, Student, student_id, context)
        return _student_profile_payload(db, student)
    except HTTPException as exc:
        if exc.status_code != status.HTTP_503_SERVICE_UNAVAILABLE:
            raise
        raise _unavailable() from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc


def _student_profile_payload(db: Session, student: Student):
    guardian = db.query(StudentGuardian).filter(StudentGuardian.student_id == student.id).one_or_none()
    response = TenantStudentProfileResponse.model_validate(student).model_dump()
    face_registered = student.id in _registered_face_student_ids(db, student.college_id, [student.id])
    response["face_registered"] = face_registered
    response["face_status"] = "registered" if face_registered else "not_registered"
    if guardian:
        response.update({
            "father_name": guardian.father_name,
            "mother_name": guardian.mother_name,
            "guardian_name": guardian.guardian_name,
            "guardian_relationship": guardian.guardian_relationship,
            "guardian_mobile": guardian.guardian_mobile,
            "parent_email": guardian.parent_email,
        })
    return response


def _check_student_update_conflicts(db: Session, student: Student, changes: dict):
    if "roll_number" in changes and db.query(Student.id).filter(
        Student.college_id == student.college_id,
        Student.roll_number == changes["roll_number"],
        Student.id != student.id,
    ).first():
        raise HTTPException(status_code=409, detail="Roll number is already in use in this College.")
    if "enrollment_number" in changes and changes["enrollment_number"] is not None and db.query(Student.id).filter(
        Student.college_id == student.college_id,
        Student.enrollment_number == changes["enrollment_number"],
        Student.id != student.id,
    ).first():
        raise HTTPException(status_code=409, detail="Enrollment number is already in use in this College.")


def _update_student_guardian(db: Session, student_id: int, changes: dict):
    mapping = {
        "father_name": "father_name",
        "mother_name": "mother_name",
        "guardian_name": "guardian_name",
        "guardian_relationship": "guardian_relationship",
        "parent_mobile": "guardian_mobile",
        "parent_email": "parent_email",
    }
    values = {target: changes[source] for source, target in mapping.items() if source in changes}
    if not values:
        return
    guardian = db.query(StudentGuardian).filter(StudentGuardian.student_id == student_id).one_or_none()
    if guardian is None:
        guardian = StudentGuardian(student_id=student_id, guardian_relationship="Guardian")
        db.add(guardian)
    for field, value in values.items():
        setattr(guardian, field, str(value).lower() if field == "parent_email" and value else value)


@router.patch("/{student_id}", response_model=TenantStudentProfileResponse)
def update_tenant_student(
    student_id: int,
    payload: TenantStudentUpdate,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_student_context(db, current_user, college_id)
    if context.membership_role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="College administrator membership required.")
    try:
        student = resolve_college_record(db, Student, student_id, context)
        changes = payload.model_dump(exclude_unset=True)
        _check_student_update_conflicts(db, student, changes)
        duration = changes.get("program_duration_years", student.program_duration_years)
        academic_year = changes.get("current_academic_year", student.current_academic_year)
        if duration is not None and academic_year is not None and academic_year > duration:
            raise HTTPException(status_code=422, detail="Current academic year cannot exceed the program duration.")

        guardian_fields = {
            "father_name", "mother_name", "guardian_name", "guardian_relationship",
            "parent_mobile", "parent_email",
        }
        for field, value in changes.items():
            if field not in guardian_fields:
                setattr(student, field, value)
        if "name" in changes:
            account = db.query(User).filter(User.email == student.email, User.role == "student").one_or_none()
            if account:
                account.name = changes["name"]
        _update_student_guardian(db, student.id, changes)
        db.commit()
        db.refresh(student)
        return _student_profile_payload(db, student)
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Student profile conflicts with existing College data.") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc


@router.delete("/{student_id}", status_code=status.HTTP_200_OK, response_model=TenantStudentStatusResponse)
def deactivate_tenant_student(
    student_id: int,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Soft-deactivate a Student and revoke only this College membership."""
    context = _resolve_student_context(db, current_user, college_id)
    if context.membership_role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="College administrator membership required.")
    try:
        student = db.query(Student).filter(
            Student.id == student_id,
            Student.college_id == context.college_id,
            Student.college_id.is_not(None),
        ).with_for_update().one_or_none()
        if student is None:
            raise HTTPException(status_code=404, detail="Record not found.")
        student.is_active = False
        assignment_query = db.query(StudentClassAssignment).filter(
            StudentClassAssignment.student_id == student.id,
            StudentClassAssignment.college_id == context.college_id,
        )
        if has_effective_date_columns(db, StudentClassAssignment):
            now = datetime.now(timezone.utc)
            for assignment in assignment_query.all():
                assignment_start = as_utc_datetime(assignment.effective_from)
                if relationship_is_active_at(legacy_active=assignment.is_active, effective_from=assignment_start, effective_to=assignment.effective_to, at=now) or (assignment_start is not None and assignment_start > now):
                    assignment.effective_to = assignment.effective_from if assignment_start is not None and assignment_start > now else now
                    assignment.is_active = False
        else:
            assignment_query = assignment_query.filter(StudentClassAssignment.is_active.is_(True))
            assignment_query.update({StudentClassAssignment.is_active: False}, synchronize_session=False)
        account = db.query(User).filter(User.email == student.email, User.role == "student").with_for_update().one_or_none()
        membership = None
        if account:
            membership = db.query(CollegeMembership).filter(
                CollegeMembership.user_id == account.id,
                CollegeMembership.college_id == context.college_id,
                CollegeMembership.role == "student",
            ).with_for_update().one_or_none()
            if membership and membership.status != "revoked":
                membership.status = "revoked"
                membership.revoked_at = datetime.now(timezone.utc)
                membership.revoked_by_user_id = context.user_id
                membership.status_reason = "Student deactivated by College Admin."
            other_active_membership = db.query(CollegeMembership.id).filter(
                CollegeMembership.user_id == account.id,
                CollegeMembership.status == "active",
                CollegeMembership.college_id != context.college_id,
            ).first()
            if not other_active_membership:
                account.is_active = False
        response = _student_profile_payload(db, student)
        response["membership_status"] = membership.status if membership else None
        db.commit()
        return response
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc


@router.patch("/{student_id}/activate", status_code=status.HTTP_200_OK, response_model=TenantStudentStatusResponse)
def activate_tenant_student(
    student_id: int,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Reactivate an existing Student and the existing membership only."""
    context = _resolve_student_context(db, current_user, college_id)
    if context.membership_role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="College administrator membership required.")
    try:
        student = db.query(Student).filter(
            Student.id == student_id,
            Student.college_id == context.college_id,
            Student.college_id.is_not(None),
        ).with_for_update().one_or_none()
        if student is None:
            raise HTTPException(status_code=404, detail="Record not found.")

        account = db.query(User).filter(
            func.lower(User.email) == student.email.strip().casefold(),
            User.role == "student",
        ).with_for_update().one_or_none()
        if account is None:
            raise HTTPException(status_code=409, detail="The existing Student account could not be matched safely. No account was created.")

        membership = db.query(CollegeMembership).filter(
            CollegeMembership.user_id == account.id,
            CollegeMembership.college_id == context.college_id,
            CollegeMembership.role == "student",
        ).with_for_update().one_or_none()
        if membership is None or membership.status in {"pending", "suspended"}:
            raise HTTPException(status_code=409, detail="The existing Student College membership is not eligible for reactivation.")

        if student.is_active and account.is_active and membership.status == "active":
            response = _student_profile_payload(db, student)
            response["membership_status"] = "active"
            return response

        student.is_active = True
        account.is_active = True
        if membership.status == "revoked":
            membership.status = "active"
            membership.activated_at = datetime.now(timezone.utc)
            membership.activated_by_user_id = context.user_id
            membership.revoked_at = None
            membership.revoked_by_user_id = None
            membership.status_reason = "Student reactivated by College Admin."
        response = _student_profile_payload(db, student)
        response["membership_status"] = membership.status
        db.commit()
        return response
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Student activation conflicts with existing College data.") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc


@router.patch("/{student_id}/password", status_code=status.HTTP_200_OK)
def reset_tenant_student_password(
    student_id: int,
    payload: TenantPasswordReset,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_student_context(db, current_user, college_id)
    if context.membership_role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="College administrator membership required.")
    try:
        student = resolve_college_record(db, Student, student_id, context)
        reset_tenant_account_password(
            db,
            account_email=student.email,
            expected_global_role="student",
            profile_type="Student",
            profile_id=student.id,
            profile_is_active=student.is_active,
            context=context,
            password=payload.password.get_secret_value(),
        )
        return {"id": student.id, "password_reset": True}
    except HTTPException as exc:
        if exc.status_code == status.HTTP_503_SERVICE_UNAVAILABLE:
            raise _unavailable() from exc
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc


@router.get(
    "/{student_id}/class-assignments",
    response_model=list[TenantStudentClassAssignmentResponse],
)
def list_tenant_student_class_assignments(
    student_id: int,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_student_context(db, current_user, college_id)
    try:
        resolve_college_record(db, Student, student_id, context)
        assignments = db.query(StudentClassAssignment).filter(
            StudentClassAssignment.student_id == student_id,
            StudentClassAssignment.college_id == context.college_id,
            StudentClassAssignment.college_id.is_not(None),
        ).order_by(StudentClassAssignment.created_at.desc(), StudentClassAssignment.id.desc()).all()
        temporal = has_effective_date_columns(db, StudentClassAssignment)
        now = datetime.now(timezone.utc)
        return [{
            "id": row.id,
            "student_id": row.student_id,
            "class_id": row.class_id,
            "academic_year": row.academic_year,
            "semester": row.semester,
            "is_active": relationship_is_active_at(
                legacy_active=row.is_active,
                effective_from=row.effective_from if temporal else None,
                effective_to=row.effective_to if temporal else None,
                at=now,
            ),
            "created_at": row.created_at,
            "effective_from": row.effective_from if temporal else None,
            "effective_to": row.effective_to if temporal else None,
        } for row in assignments]
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc


@router.post(
    "/{student_id}/class-assignments",
    response_model=TenantStudentClassAssignmentResponse,
    status_code=status.HTTP_201_CREATED,
)
def assign_tenant_student_to_class(
    student_id: int,
    payload: TenantStudentClassAssignmentInput,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_student_context(db, current_user, college_id)
    if context.membership_role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="College administrator membership required.")
    if not has_effective_date_columns(db, StudentClassAssignment):
        raise _relationship_dates_unavailable()
    now = datetime.now(timezone.utc)
    # UI datetime-local values have minute precision; accept normal request
    # transit/rounding skew but never backdate the recorded interval.
    if payload.effective_from < now:
        if (now - payload.effective_from).total_seconds() > 60:
            raise HTTPException(status_code=422, detail="Enrollment start cannot be backdated.")
        payload.effective_from = now
    try:
        student = db.query(Student).filter(
            Student.id == student_id,
            Student.college_id == context.college_id,
            Student.college_id.is_not(None),
        ).with_for_update().one_or_none()
        if student is None:
            raise HTTPException(status_code=404, detail="Record not found.")
        if not student.is_active:
            raise HTTPException(status_code=409, detail="Inactive Students cannot receive new class assignments.")
        class_record = db.query(Class).filter(
            Class.id == payload.class_id,
            Class.college_id == context.college_id,
            Class.college_id.is_not(None),
            Class.is_active.is_(True),
        ).one_or_none()
        if class_record is None:
            raise HTTPException(status_code=404, detail="Class not found.")
        existing_assignments = db.query(StudentClassAssignment).filter(
            StudentClassAssignment.student_id == student.id,
            StudentClassAssignment.college_id == context.college_id,
        ).with_for_update().all()
        for existing in existing_assignments:
            start = as_utc_datetime(existing.effective_from)
            end = as_utc_datetime(existing.effective_to)
            same_enrollment = (
                existing.class_id == class_record.id
                and existing.academic_year == payload.academic_year
                and existing.semester == payload.semester
            )
            overlaps_new_period = (start is None and existing.is_active or start is not None and start < payload.effective_from) and (end is None or end > payload.effective_from)
            if same_enrollment and overlaps_new_period:
                raise HTTPException(status_code=409, detail="This Student already has the same active class enrollment.")
            if start is None and existing.is_active:
                existing.effective_to = payload.effective_from
                existing.is_active = False
                continue
            if start is not None and (end is None or end > payload.effective_from):
                if start >= payload.effective_from:
                    raise HTTPException(status_code=409, detail="This enrollment overlaps a scheduled class assignment.")
                existing.effective_to = payload.effective_from
                existing.is_active = False
        assignment = StudentClassAssignment(
            college_id=context.college_id,
            student_id=student.id,
            class_id=class_record.id,
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
        raise HTTPException(status_code=409, detail="Student class assignment conflicts with existing records.") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc


@router.delete(
    "/{student_id}/class-assignments/{assignment_id}",
    response_model=TenantStudentClassAssignmentResponse,
)
def deactivate_tenant_student_class_assignment(
    student_id: int,
    assignment_id: int,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_student_context(db, current_user, college_id)
    if context.membership_role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="College administrator membership required.")
    if not has_effective_date_columns(db, StudentClassAssignment):
        raise _relationship_dates_unavailable()
    try:
        assignment = db.query(StudentClassAssignment).filter(
            StudentClassAssignment.id == assignment_id,
            StudentClassAssignment.student_id == student_id,
            StudentClassAssignment.college_id == context.college_id,
            StudentClassAssignment.college_id.is_not(None),
        ).one_or_none()
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


@router.post("/", response_model=TenantStudentRegisteredResponse, status_code=status.HTTP_201_CREATED)
def create_tenant_student(
    payload: TenantStudentCreate,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_student_context(db, current_user, college_id)
    if context.membership_role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="College administrator membership required.")
    if payload.initial_class_id is not None and not has_effective_date_columns(db, StudentClassAssignment):
        raise _relationship_dates_unavailable()
    email = str(payload.email).strip().lower()
    try:
        identity_conflict = _student_identity_conflict_detail(
            db, context.college_id, email, payload.roll_number
        )
        if identity_conflict:
            raise HTTPException(status_code=409, detail=identity_conflict)
        if payload.enrollment_number and db.query(Student.id).filter(
            Student.college_id == context.college_id,
            Student.college_id.is_not(None),
            Student.enrollment_number == payload.enrollment_number,
        ).first():
            raise HTTPException(status_code=409, detail={
                "code": "enrollment_number_already_used",
                "field": "enrollment_number",
                "message": "Enrollment number already exists in this College.",
            })
        if payload.initial_class_id is not None:
            parent = db.query(Class.id).filter(
                Class.id == payload.initial_class_id,
                Class.college_id == context.college_id,
                Class.college_id.is_not(None),
                Class.is_active.is_(True),
            ).one_or_none()
            if parent is None:
                raise HTTPException(status_code=404, detail="Class not found.")
        # Keep ID allocation in the same guarded transaction as all related
        # inserts so any later failure rolls the counter update back too.
        student_code = next_student_code(db)
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc

    student = Student(
        college_id=context.college_id,
        student_code=student_code,
        name=payload.name,
        email=email,
        roll_number=payload.roll_number,
        department=payload.department,
        date_of_birth=payload.date_of_birth,
        gender=payload.gender,
        enrollment_number=payload.enrollment_number,
        admission_year=payload.admission_year,
        admission_session=payload.admission_session,
        program_duration_years=payload.program_duration_years,
        current_academic_year=payload.current_academic_year,
        current_semester=payload.current_semester,
        section=payload.section,
        course=payload.course,
        mobile=payload.mobile,
        address=payload.address,
        city=payload.city,
        state=payload.state,
        postal_code=payload.postal_code,
        is_active=True,
    )
    try:
        user = User(
            name=payload.name,
            email=email,
            hashed_password=get_password_hash(payload.password.get_secret_value()),
            role="student",
            is_active=True,
        )
        db.add_all([user, student])
        db.flush()
        membership = CollegeMembership(
            user_id=user.id,
            college_id=context.college_id,
            role="student",
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
        # existing account using email, name, roll number, or phone.
        db.add(StudentAccountLink(
            student_id=student.id,
            user_id=user.id,
            college_id=context.college_id,
            link_status="active",
            verified_by_user_id=context.user_id,
            verified_at=datetime.now(timezone.utc),
            created_at=datetime.now(timezone.utc),
        ))
        if any((payload.father_name, payload.mother_name, payload.parent_mobile, payload.parent_email, payload.guardian_name)):
            guardian_label = payload.guardian_name or payload.father_name or payload.mother_name
            db.add(StudentGuardian(
                student_id=student.id,
                guardian_name=guardian_label,
                guardian_relationship=payload.guardian_relationship,
                guardian_mobile=payload.parent_mobile,
                father_name=payload.father_name,
                mother_name=payload.mother_name,
                parent_email=str(payload.parent_email).lower() if payload.parent_email else None,
            ))
        if payload.initial_class_id is not None:
            db.add(StudentClassAssignment(
                college_id=context.college_id,
                student_id=student.id,
                class_id=payload.initial_class_id,
                academic_year=str(payload.current_academic_year) if payload.current_academic_year else None,
                semester=payload.current_semester,
                is_active=True,
                effective_from=datetime.now(timezone.utc),
            ))
        db.add(StudentAcademicHistory(
            college_id=context.college_id,
            student_id=student.id,
            class_id=payload.initial_class_id,
            admission_year=payload.admission_year,
            academic_year=payload.current_academic_year,
            semester=payload.current_semester,
            section=payload.section,
            action="admitted",
            reason="Initial registration record.",
            actor_user_id=context.user_id,
        ))
        db.commit()
        db.refresh(student)
        return {
            "id": student.id,
            "student_code": student.student_code,
            "name": student.name,
            "email": student.email,
            "roll_number": student.roll_number,
            "enrollment_number": student.enrollment_number,
            "admission_year": student.admission_year,
            "admission_session": student.admission_session,
            "program_duration_years": student.program_duration_years,
            "current_academic_year": student.current_academic_year,
            "current_semester": student.current_semester,
            "section": student.section,
            "is_active": student.is_active,
            "account_activation": "active",
            "invitation_status": "not_required",
        }
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=_student_integrity_error_detail(exc),
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc


def _student_invitation_target(db: Session, student_id: int, college_id: int):
    student = db.query(Student).filter(
        Student.id == student_id,
        Student.college_id == college_id,
        Student.college_id.is_not(None),
    ).one_or_none()
    if student is None:
        raise HTTPException(status_code=404, detail="Record not found.")
    pair = db.query(User, CollegeMembership).join(
        CollegeMembership, CollegeMembership.user_id == User.id
    ).filter(
        User.email == student.email,
        User.role == "student",
        CollegeMembership.college_id == college_id,
        CollegeMembership.role == "student",
    ).one_or_none()
    if pair is None:
        raise HTTPException(status_code=409, detail={
            "code": "invitation_account_unavailable",
            "message": "No account invitation is available for this Student in the selected College.",
        })
    return student, pair[0], pair[1]


@router.get("/{student_id}/invitation")
def get_student_invitation_status(
    student_id: int,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_student_context(db, current_user, college_id)
    if context.membership_role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="College administrator membership required.")
    student, user, membership = _student_invitation_target(db, student_id, context.college_id)
    result = invitation_status(db, membership)
    can_resend = bool(
        not student.is_active
        and not user.is_active
        and membership.status == "pending"
    )
    if can_resend:
        resend_blocked_reason = None
    elif student.is_active and user.is_active and membership.status == "active":
        resend_blocked_reason = "account_active"
    elif membership.status in {"inactive", "revoked"} or (
        not student.is_active and membership.status != "pending"
    ):
        resend_blocked_reason = "account_deactivated"
    else:
        resend_blocked_reason = "invitation_state_unavailable"
    return {
        "status": result["status"],
        "expires_at": result["expires_at"],
        "can_resend": can_resend,
        "resend_blocked_reason": resend_blocked_reason,
    }


@router.post("/{student_id}/invitation/resend")
def resend_student_invitation(
    student_id: int,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_student_context(db, current_user, college_id)
    if context.membership_role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="College administrator membership required.")
    student, user, membership = _student_invitation_target(db, student_id, context.college_id)
    if student.is_active and user.is_active and membership.status == "active":
        raise HTTPException(status_code=409, detail={
            "code": "account_already_active",
            "message": "This Student already has an active account and does not need a setup invitation.",
        })
    if membership.status in {"inactive", "revoked"} or (
        not student.is_active and membership.status != "pending"
    ):
        raise HTTPException(status_code=409, detail={
            "code": "student_account_deactivated",
            "message": "This Student account is deactivated and cannot receive a setup invitation.",
        })
    if student.is_active or user.is_active or membership.status != "pending":
        raise HTTPException(status_code=409, detail={
            "code": "invitation_state_unavailable",
            "message": "A setup invitation is unavailable for the current Student account state.",
        })
    result = issue_invitation(db, user=user, membership=membership, actor_user_id=context.user_id)
    if result in {"not_configured", "unavailable"}:
        raise HTTPException(status_code=503, detail="Invitation email is not configured or temporarily unavailable.")
    return {"status": result, "message": "Invitation processed. The account holder must set a password before sign-in."}


@router.get("/{student_id}/academic-history", response_model=list[TenantStudentAcademicHistoryResponse])
def get_tenant_student_academic_history(
    student_id: int,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_student_context(db, current_user, college_id)
    try:
        resolve_college_record(db, Student, student_id, context)
        return db.query(StudentAcademicHistory).filter(
            StudentAcademicHistory.student_id == student_id,
            StudentAcademicHistory.college_id == context.college_id,
        ).order_by(StudentAcademicHistory.created_at.asc(), StudentAcademicHistory.id.asc()).all()
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc


@router.post("/{student_id}/promotions", response_model=TenantStudentResponse)
def promote_tenant_student(
    student_id: int,
    payload: TenantStudentPromotion,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_student_context(db, current_user, college_id)
    if context.membership_role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="College administrator membership required.")
    try:
        resolve_college_record(db, Student, student_id, context)
        student = db.query(Student).filter(
            Student.id == student_id,
            Student.college_id == context.college_id,
            Student.college_id.is_not(None),
        ).with_for_update().one()
        temporal_enrollments = has_effective_date_columns(db, StudentClassAssignment)
        if payload.class_id is not None and db.query(Class.id).filter(
            Class.id == payload.class_id,
            Class.college_id == context.college_id,
            Class.college_id.is_not(None),
            Class.is_active.is_(True),
        ).one_or_none() is None:
            raise HTTPException(status_code=404, detail="Class not found.")
        student.current_academic_year = payload.current_academic_year
        student.current_semester = payload.current_semester
        student.section = payload.section
        db.add(StudentAcademicHistory(
            college_id=context.college_id,
            student_id=student.id,
            class_id=payload.class_id,
            admission_year=student.admission_year,
            academic_year=payload.current_academic_year,
            semester=payload.current_semester,
            section=payload.section,
            action="promoted",
            reason=payload.reason,
            actor_user_id=context.user_id,
        ))
        existing_assignments = db.query(StudentClassAssignment).filter(
            StudentClassAssignment.student_id == student.id,
            StudentClassAssignment.college_id == context.college_id,
        ).with_for_update().all()
        now = datetime.now(timezone.utc)
        for existing in existing_assignments:
            if temporal_enrollments:
                existing_start = as_utc_datetime(existing.effective_from)
                should_close = relationship_is_active_at(legacy_active=existing.is_active, effective_from=existing_start, effective_to=existing.effective_to, at=now) or (existing_start is not None and existing_start > now)
                if not should_close:
                    continue
                existing.effective_to = existing.effective_from if existing_start is not None and existing_start > now else now
                existing.is_active = False
            elif existing.is_active:
                existing.is_active = False
        if payload.class_id is not None:
            db.add(StudentClassAssignment(
                college_id=context.college_id,
                student_id=student.id,
                class_id=payload.class_id,
                academic_year=str(payload.current_academic_year),
                semester=payload.current_semester,
                is_active=True,
                effective_from=now,
            ))
        db.commit()
        db.refresh(student)
        return student
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc
