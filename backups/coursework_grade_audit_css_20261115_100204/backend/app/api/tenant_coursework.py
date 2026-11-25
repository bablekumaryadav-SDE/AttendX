"""Prepared College-scoped coursework API; intentionally not mounted.

The routes fail closed on missing draft schema. Do not add this router to
``main.py`` until Coursework migrations and PostgreSQL concurrency behavior
have been approved and rehearsed on an isolated disposable cluster.
"""

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import (
    Class,
    College,
    CollegeMembership,
    CourseworkAssignment,
    CourseworkAssignmentAuditEvent,
    CourseworkSubmission,
    CourseworkSubmissionGrade,
    CourseworkSubmissionRevision,
    NotificationEvent,
    Student,
    StudentAccountLink,
    StudentClassAssignment,
    Subject,
    Teacher,
    TeacherAccountLink,
    TeacherAssignment,
    User,
)
from app.schemas.coursework import (
    CourseworkAdminFacetResponse,
    CourseworkAdminListResponse,
    CourseworkAdminSummaryResponse,
    CourseworkAdminTotalsResponse,
    CourseworkAssignmentCreate,
    CourseworkAssignmentDraftUpdate,
    CourseworkAssignmentResponse,
    CourseworkGradeCreate,
    CourseworkGradeResponse,
    CourseworkReason,
    CourseworkStudentAssignmentResponse,
    CourseworkSubmissionCreate,
    CourseworkSubmissionDetailResponse,
    CourseworkSubmissionMonitorResponse,
    CourseworkSubmissionResponse,
    CourseworkTeacherMappingResponse,
)
from app.tenant_context import TenantContext, resolve_tenant_context
from app.tenant_relationship_history import active_relationship_at, as_utc_datetime


router = APIRouter(prefix="/tenant/coursework", tags=["Tenant Coursework"])
_TEACHER = frozenset({"teacher"})
_STUDENT = frozenset({"student"})
_ADMIN = frozenset({"college_admin"})


def _context(db: Session, user, roles, college_id: int | None = None):
    try:
        return resolve_tenant_context(
            db, user, allowed_roles=roles, requested_college_id=college_id
        )
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="Coursework is unavailable until its College schema is installed.") from exc


def _database_unavailable(db: Session, exc):
    db.rollback()
    raise HTTPException(status_code=503, detail="Coursework is unavailable until its approved schema is installed.") from exc


def _teacher_assignment(db: Session, context: TenantContext, assignment_id: int):
    now = datetime.now(timezone.utc)
    link = (
        db.query(TeacherAccountLink, Teacher)
        .join(Teacher, Teacher.id == TeacherAccountLink.teacher_id)
        .filter(
            TeacherAccountLink.user_id == context.user_id,
            TeacherAccountLink.college_id == context.college_id,
            TeacherAccountLink.link_status == "active",
            Teacher.college_id == context.college_id,
            Teacher.is_active.is_(True),
        )
        .one_or_none()
    )
    if link is None:
        raise HTTPException(status_code=403, detail="An active verified Teacher profile link is required.")
    mapping = (
        db.query(TeacherAssignment)
        .join(Class, Class.id == TeacherAssignment.class_id)
        .join(Subject, Subject.id == TeacherAssignment.subject_id)
        .filter(
            TeacherAssignment.id == assignment_id,
            TeacherAssignment.college_id == context.college_id,
            TeacherAssignment.teacher_id == link[1].id,
            TeacherAssignment.is_active.is_(True),
            Class.college_id == context.college_id,
            Class.is_active.is_(True),
            Subject.college_id == context.college_id,
            Subject.is_active.is_(True),
            active_relationship_at(db, TeacherAssignment, now),
        )
        .one_or_none()
    )
    if mapping is None:
        raise HTTPException(status_code=404, detail="Authorized active class and subject assignment not found.")
    return mapping


@router.get("/teacher/mappings", response_model=list[CourseworkTeacherMappingResponse])
def list_teacher_coursework_mappings(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    college_id: Annotated[int | None, Query(gt=0)] = None,
):
    context = _context(db, current_user, _TEACHER, college_id)
    try:
        link = (
            db.query(TeacherAccountLink)
            .filter(TeacherAccountLink.user_id == context.user_id,
                    TeacherAccountLink.college_id == context.college_id,
                    TeacherAccountLink.link_status == "active")
            .one_or_none()
        )
        if link is None:
            raise HTTPException(status_code=403, detail="An active verified Teacher profile link is required.")
        rows = (
            db.query(TeacherAssignment, Class, Subject)
            .join(Class, Class.id == TeacherAssignment.class_id)
            .join(Subject, Subject.id == TeacherAssignment.subject_id)
            .filter(TeacherAssignment.college_id == context.college_id,
                    TeacherAssignment.teacher_id == link.teacher_id,
                    TeacherAssignment.is_active.is_(True),
                    Class.college_id == context.college_id,
                    Class.is_active.is_(True),
                    Subject.college_id == context.college_id,
                    Subject.is_active.is_(True),
                    active_relationship_at(db, TeacherAssignment, datetime.now(timezone.utc)))
            .order_by(Class.name, Subject.name, TeacherAssignment.id)
            .all()
        )
        return [CourseworkTeacherMappingResponse(
            id=mapping.id,
            class_id=class_.id,
            class_name=class_.name,
            subject_id=subject.id,
            subject_name=subject.name,
            academic_year=mapping.academic_year,
            semester=mapping.semester,
        ) for mapping, class_, subject in rows]
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        _database_unavailable(db, exc)


def _owned_assignment(db: Session, context: TenantContext, assignment_id: int, *, lock=False, share_lock=False):
    query = db.query(CourseworkAssignment).filter(
        CourseworkAssignment.id == assignment_id,
        CourseworkAssignment.college_id == context.college_id,
    )
    if lock:
        query = query.with_for_update(read=share_lock)
    assignment = query.one_or_none()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Coursework assignment not found.")
    return assignment


def _teacher_owns_assignment(db: Session, context: TenantContext, assignment: CourseworkAssignment):
    mapping = _teacher_assignment(db, context, assignment.teacher_assignment_id)
    if mapping.id != assignment.teacher_assignment_id:
        raise HTTPException(status_code=404, detail="Coursework assignment not found.")
    return mapping


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise HTTPException(status_code=422, detail="A timezone is required for every date and time.")
    return value.astimezone(timezone.utc)


@router.post("/teacher/assignments", response_model=CourseworkAssignmentResponse, status_code=201)
def create_draft(
    body: CourseworkAssignmentCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    college_id: Annotated[int | None, Query(gt=0)] = None,
):
    context = _context(db, current_user, _TEACHER, college_id)
    try:
        mapping = _teacher_assignment(db, context, body.teacher_assignment_id)
        assignment = CourseworkAssignment(
            college_id=context.college_id,
            teacher_assignment_id=mapping.id,
            created_by_membership_id=context.membership_id,
            created_by_user_id=context.user_id,
            title=body.title.strip(),
            instructions=body.instructions.strip(),
            issued_at=_aware(body.issued_at),
            due_at=_aware(body.due_at),
            maximum_marks=body.maximum_marks,
            status="draft",
        )
        db.add(assignment)
        db.commit()
        db.refresh(assignment)
        return assignment
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        _database_unavailable(db, exc)


@router.get("/teacher/assignments", response_model=list[CourseworkAssignmentResponse])
def list_teacher_assignments(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    college_id: Annotated[int | None, Query(gt=0)] = None,
):
    context = _context(db, current_user, _TEACHER, college_id)
    try:
        link = (
            db.query(TeacherAccountLink)
            .filter(TeacherAccountLink.user_id == context.user_id,
                    TeacherAccountLink.college_id == context.college_id,
                    TeacherAccountLink.link_status == "active")
            .one_or_none()
        )
        if link is None:
            raise HTTPException(status_code=403, detail="An active verified Teacher profile link is required.")
        return (
            db.query(CourseworkAssignment)
            .join(TeacherAssignment, TeacherAssignment.id == CourseworkAssignment.teacher_assignment_id)
            .join(Class, Class.id == TeacherAssignment.class_id)
            .join(Subject, Subject.id == TeacherAssignment.subject_id)
            .filter(CourseworkAssignment.college_id == context.college_id,
                    TeacherAssignment.college_id == context.college_id,
                    TeacherAssignment.teacher_id == link.teacher_id,
                    TeacherAssignment.is_active.is_(True),
                    Class.college_id == context.college_id,
                    Class.is_active.is_(True),
                    Subject.college_id == context.college_id,
                    Subject.is_active.is_(True),
                    active_relationship_at(db, TeacherAssignment, datetime.now(timezone.utc)))
            .order_by(CourseworkAssignment.created_at.desc(), CourseworkAssignment.id.desc())
            .all()
        )
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        _database_unavailable(db, exc)


@router.patch("/teacher/assignments/{assignment_id}", response_model=CourseworkAssignmentResponse)
def update_draft(
    assignment_id: int,
    body: CourseworkAssignmentDraftUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    college_id: Annotated[int | None, Query(gt=0)] = None,
):
    context = _context(db, current_user, _TEACHER, college_id)
    try:
        assignment = _owned_assignment(db, context, assignment_id, lock=True)
        _teacher_owns_assignment(db, context, assignment)
        if assignment.status != "draft":
            raise HTTPException(status_code=409, detail="Only draft assignments can be edited.")
        values = body.model_dump(exclude_unset=True)
        if not values:
            raise HTTPException(status_code=422, detail="Provide at least one draft field to update.")
        for field in ("issued_at", "due_at"):
            if field in values:
                values[field] = _aware(values[field])
        issued = values.get("issued_at", assignment.issued_at)
        due = values.get("due_at", assignment.due_at)
        if as_utc_datetime(due) <= as_utc_datetime(issued):
            raise HTTPException(status_code=422, detail="The due time must be later than the issue time.")
        for field, value in values.items():
            setattr(assignment, field, value.strip() if field in {"title", "instructions"} else value)
        assignment.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(assignment)
        return assignment
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        _database_unavailable(db, exc)


def _audit(context, assignment, event_type, previous, new, reason):
    return CourseworkAssignmentAuditEvent(
        coursework_assignment_id=assignment.id,
        college_id=context.college_id,
        actor_membership_id=context.membership_id,
        actor_user_id=context.user_id,
        event_type=event_type,
        previous_values=previous,
        new_values=new,
        reason=reason.strip(),
        occurred_at=datetime.now(timezone.utc),
    )


def _queue_in_app_event(db: Session, *, user_id: int, college_id: int, student_id: int | None,
                        event_type: str, idempotency_key: str, title: str, message: str):
    """Persist an in-app event only; this does not claim email/SMS delivery."""
    event = NotificationEvent(
        college_id=college_id,
        user_id=user_id,
        student_id=student_id,
        event_type=event_type,
        channel="in_app",
        title=title,
        message=message,
        delivery_status="queued",
        idempotency_key=idempotency_key,
    )
    db.add(event)
    return event


def _eligible_students(db: Session, college_id: int, class_id: int, now: datetime):
    recipients = (
        db.query(Student, StudentAccountLink.user_id)
        .join(College, College.id == Student.college_id)
        .join(StudentAccountLink, StudentAccountLink.student_id == Student.id)
        .join(CollegeMembership, CollegeMembership.user_id == StudentAccountLink.user_id)
        .join(User, User.id == StudentAccountLink.user_id)
        .join(StudentClassAssignment, StudentClassAssignment.student_id == Student.id)
        .filter(College.id == college_id,
                College.status == "active",
                Student.college_id == college_id,
                Student.is_active.is_(True),
                User.is_active.is_(True),
                StudentAccountLink.college_id == college_id,
                StudentAccountLink.link_status == "active",
                CollegeMembership.college_id == college_id,
                CollegeMembership.role == "student",
                CollegeMembership.status == "active",
                StudentClassAssignment.college_id == college_id,
                StudentClassAssignment.student_id == Student.id,
                StudentClassAssignment.class_id == class_id,
                StudentClassAssignment.is_active.is_(True),
                active_relationship_at(db, StudentClassAssignment, now))
        .distinct()
        .all()
    )
    return recipients


def _notify_students_assignment_published(db: Session, context: TenantContext, assignment: CourseworkAssignment, mapping: TeacherAssignment):
    now = datetime.now(timezone.utc)
    recipients = _eligible_students(db, context.college_id, mapping.class_id, now)
    for student, recipient_user_id in recipients:
        _queue_in_app_event(
            db,
            user_id=recipient_user_id,
            college_id=context.college_id,
            student_id=student.id,
            event_type="coursework_published",
            idempotency_key=f"coursework:assignment:{assignment.id}:published:user:{recipient_user_id}",
            title="New coursework assignment",
            message=f"{assignment.title} is available for your enrolled class.",
        )


def _notify_students_assignment_event(db: Session, assignment: CourseworkAssignment,
                                      mapping: TeacherAssignment, *, event_type: str,
                                      idempotency_scope: str, title: str, message: str):
    now = datetime.now(timezone.utc)
    for student, recipient_user_id in _eligible_students(
        db, assignment.college_id, mapping.class_id, now
    ):
        _queue_in_app_event(
            db,
            user_id=recipient_user_id,
            college_id=assignment.college_id,
            student_id=student.id,
            event_type=event_type,
            idempotency_key=f"coursework:assignment:{assignment.id}:{idempotency_scope}:user:{recipient_user_id}",
            title=title,
            message=message,
        )


def _notify_teacher_submission(db: Session, context: TenantContext, assignment: CourseworkAssignment,
                               mapping: TeacherAssignment, student: Student,
                               revision_id: int, revision_number: int):
    link = (
        db.query(TeacherAccountLink)
        .join(CollegeMembership, CollegeMembership.user_id == TeacherAccountLink.user_id)
        .join(User, User.id == TeacherAccountLink.user_id)
        .filter(TeacherAccountLink.teacher_id == mapping.teacher_id,
                TeacherAccountLink.college_id == context.college_id,
                TeacherAccountLink.link_status == "active",
                CollegeMembership.college_id == context.college_id,
                CollegeMembership.role == "teacher",
                CollegeMembership.status == "active",
                User.is_active.is_(True))
        .one_or_none()
    )
    if link is not None:
        _queue_in_app_event(
            db,
            user_id=link.user_id,
            college_id=context.college_id,
            student_id=student.id,
            event_type=("coursework_submission_received" if revision_number == 1
                        else "coursework_submission_revision_received"),
            idempotency_key=f"coursework:submission:{assignment.id}:{student.id}:revision:{revision_id}",
            title=("Student submitted coursework" if revision_number == 1
                   else "Student submitted a coursework revision"),
            message=(f"A student submitted work for {assignment.title}." if revision_number == 1
                     else f"A student submitted a new revision for {assignment.title}."),
        )


@router.post("/teacher/assignments/{assignment_id}/publish", response_model=CourseworkAssignmentResponse)
def publish_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    college_id: Annotated[int | None, Query(gt=0)] = None,
):
    context = _context(db, current_user, _TEACHER, college_id)
    try:
        assignment = _owned_assignment(db, context, assignment_id, lock=True)
        mapping = _teacher_owns_assignment(db, context, assignment)
        if assignment.status != "draft":
            raise HTTPException(status_code=409, detail="Only a draft assignment can be published.")
        if as_utc_datetime(assignment.due_at) <= datetime.now(timezone.utc):
            raise HTTPException(status_code=409, detail="An assignment with a past deadline cannot be published.")
        now = datetime.now(timezone.utc)
        audit = _audit(context, assignment, "published", {"status": "draft"}, {"status": "published"}, "Teacher published assignment")
        db.add(audit)
        # The PostgreSQL transition trigger verifies this event during UPDATE.
        db.flush([audit])
        assignment.status = "published"
        assignment.published_at = now
        assignment.updated_at = now
        _notify_students_assignment_published(db, context, assignment, mapping)
        db.commit()
        db.refresh(assignment)
        return assignment
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        _database_unavailable(db, exc)


def _student_identity(db: Session, context: TenantContext):
    link = (
        db.query(StudentAccountLink, Student)
        .join(Student, Student.id == StudentAccountLink.student_id)
        .filter(StudentAccountLink.user_id == context.user_id,
                StudentAccountLink.college_id == context.college_id,
                StudentAccountLink.link_status == "active",
                Student.college_id == context.college_id,
                Student.is_active.is_(True))
        .one_or_none()
    )
    if link is None:
        raise HTTPException(status_code=403, detail="An active verified Student profile link is required.")
    return link[1]


def _active_enrollments(db, college_id, student_id, now):
    return (
        db.query(StudentClassAssignment.class_id)
        .filter(StudentClassAssignment.college_id == college_id,
                StudentClassAssignment.student_id == student_id,
                StudentClassAssignment.is_active.is_(True),
                active_relationship_at(db, StudentClassAssignment, now))
        .all()
    )


def _assignment_accepts_submissions(assignment: CourseworkAssignment, now: datetime) -> bool:
    """Whether unsubmitted enrolled students should count as pending right now."""
    return (
        assignment.status == "published"
        and assignment.published_at is not None
        and assignment.archived_at is None
        and as_utc_datetime(assignment.issued_at) <= now <= as_utc_datetime(assignment.due_at)
    )


def _submission_monitor(db: Session, context: TenantContext, assignment: CourseworkAssignment):
    mapping = db.query(TeacherAssignment).join(Class, Class.id == TeacherAssignment.class_id).join(
        Subject, Subject.id == TeacherAssignment.subject_id
    ).filter(
        TeacherAssignment.id == assignment.teacher_assignment_id,
        TeacherAssignment.college_id == context.college_id,
        Class.college_id == context.college_id,
        Subject.college_id == context.college_id,
    ).one_or_none()
    if mapping is None:
        raise HTTPException(status_code=404, detail="Coursework assignment not found.")
    now = datetime.now(timezone.utc)
    enrolled_students = (
        db.query(Student.id, Student.name, Student.roll_number)
        .join(
            StudentClassAssignment,
            and_(StudentClassAssignment.student_id == Student.id,
                 StudentClassAssignment.college_id == Student.college_id),
        )
        .join(
            StudentAccountLink,
            and_(StudentAccountLink.student_id == Student.id,
                 StudentAccountLink.college_id == context.college_id,
                 StudentAccountLink.link_status == "active"),
        )
        .join(
            User,
            and_(User.id == StudentAccountLink.user_id, User.is_active.is_(True)),
        )
        .join(
            CollegeMembership,
            and_(CollegeMembership.user_id == User.id,
                 CollegeMembership.college_id == context.college_id,
                 CollegeMembership.role == "student",
                 CollegeMembership.status == "active"),
        )
        .filter(Student.college_id == context.college_id,
                Student.is_active.is_(True),
                StudentClassAssignment.college_id == context.college_id,
                StudentClassAssignment.class_id == mapping.class_id,
                StudentClassAssignment.is_active.is_(True),
                active_relationship_at(db, StudentClassAssignment, now))
        .distinct()
        .all()
    )
    if not enrolled_students:
        return []

    student_ids = [student_id for student_id, _, _ in enrolled_students]
    latest_revision_numbers = (
        db.query(
            CourseworkSubmissionRevision.coursework_submission_id.label("submission_id"),
            func.max(CourseworkSubmissionRevision.revision_number).label("revision_number"),
        )
        .filter(CourseworkSubmissionRevision.college_id == context.college_id)
        .group_by(CourseworkSubmissionRevision.coursework_submission_id)
        .subquery()
    )
    submission_rows = (
        db.query(CourseworkSubmission, CourseworkSubmissionRevision)
        .outerjoin(
            latest_revision_numbers,
            latest_revision_numbers.c.submission_id == CourseworkSubmission.id,
        )
        .outerjoin(
            CourseworkSubmissionRevision,
            and_(CourseworkSubmissionRevision.coursework_submission_id == CourseworkSubmission.id,
                 CourseworkSubmissionRevision.revision_number == latest_revision_numbers.c.revision_number,
                 CourseworkSubmissionRevision.college_id == context.college_id),
        )
        .filter(CourseworkSubmission.coursework_assignment_id == assignment.id,
                CourseworkSubmission.student_id.in_(student_ids),
                CourseworkSubmission.college_id == context.college_id)
        .all()
    )
    submissions_by_student = {
        submission.student_id: (submission, latest)
        for submission, latest in submission_rows
    }

    result = []
    for student_id, student_name, roll_number in enrolled_students:
        submission, latest = submissions_by_student.get(student_id, (None, None))
        if latest is not None:
            state = "late" if latest.is_late else "submitted"
        elif assignment.status == "archived" or assignment.archived_at is not None:
            state = "archived"
        elif assignment.status != "published" or assignment.published_at is None:
            state = "unpublished"
        elif now < as_utc_datetime(assignment.issued_at):
            state = "available"
        else:
            state = "late" if now > as_utc_datetime(assignment.due_at) else "pending"
        result.append(CourseworkSubmissionMonitorResponse(
            student_id=student_id,
            student_name=student_name,
            roll_number=roll_number,
            submission_id=submission.id if submission else None,
            state=state,
            latest_revision=latest,
        ))
    return result


def _current_grade(db: Session, submission_id: int, revision_id: int, college_id: int):
    return (
        db.query(CourseworkSubmissionGrade)
        .filter(
            CourseworkSubmissionGrade.coursework_submission_id == submission_id,
            CourseworkSubmissionGrade.revision_id == revision_id,
            CourseworkSubmissionGrade.college_id == college_id,
        )
        .order_by(CourseworkSubmissionGrade.version.desc())
        .first()
    )


def _submission_detail(db: Session, context: TenantContext, assignment: CourseworkAssignment, student_id: int):
    mapping = db.query(TeacherAssignment).join(Class, Class.id == TeacherAssignment.class_id).join(
        Subject, Subject.id == TeacherAssignment.subject_id
    ).filter(
        TeacherAssignment.id == assignment.teacher_assignment_id,
        TeacherAssignment.college_id == context.college_id,
        Class.college_id == context.college_id,
        Subject.college_id == context.college_id,
    ).one_or_none()
    student = db.query(Student).filter(
        Student.id == student_id,
        Student.college_id == context.college_id,
        Student.is_active.is_(True),
    ).one_or_none()
    enrolled = mapping and db.query(StudentClassAssignment.id).filter(
        StudentClassAssignment.college_id == context.college_id,
        StudentClassAssignment.student_id == student_id,
        StudentClassAssignment.class_id == mapping.class_id,
        StudentClassAssignment.is_active.is_(True),
        active_relationship_at(db, StudentClassAssignment, datetime.now(timezone.utc)),
    ).first()
    if student is None or not enrolled:
        raise HTTPException(status_code=404, detail="Coursework submission not found.")
    submission = db.query(CourseworkSubmission).filter(
        CourseworkSubmission.coursework_assignment_id == assignment.id,
        CourseworkSubmission.student_id == student.id,
        CourseworkSubmission.college_id == context.college_id,
    ).one_or_none()
    if submission is None:
        raise HTTPException(status_code=404, detail="Coursework submission not found.")
    revisions = db.query(CourseworkSubmissionRevision).filter(
        CourseworkSubmissionRevision.coursework_submission_id == submission.id,
        CourseworkSubmissionRevision.college_id == context.college_id,
    ).order_by(CourseworkSubmissionRevision.revision_number.asc()).all()
    latest = revisions[-1] if revisions else None
    current_grade = (
        _current_grade(db, submission.id, latest.id, context.college_id)
        if latest is not None else None
    )
    return CourseworkSubmissionDetailResponse(
        student_id=student.id,
        student_name=student.name,
        roll_number=student.roll_number,
        submission_id=submission.id,
        state="late" if latest and latest.is_late else "submitted",
        revisions=revisions,
        current_grade=current_grade,
    )


@router.get("/teacher/assignments/{assignment_id}/submissions", response_model=list[CourseworkSubmissionMonitorResponse])
def list_teacher_submissions(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    college_id: Annotated[int | None, Query(gt=0)] = None,
):
    context = _context(db, current_user, _TEACHER, college_id)
    try:
        assignment = _owned_assignment(db, context, assignment_id)
        _teacher_owns_assignment(db, context, assignment)
        return _submission_monitor(db, context, assignment)
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        _database_unavailable(db, exc)


@router.get("/admin/assignments/{assignment_id}/submissions", response_model=list[CourseworkSubmissionMonitorResponse])
def list_admin_submissions(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    college_id: Annotated[int | None, Query(gt=0)] = None,
):
    context = _context(db, current_user, _ADMIN, college_id)
    try:
        assignment = _owned_assignment(db, context, assignment_id)
        return _submission_monitor(db, context, assignment)
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        _database_unavailable(db, exc)


@router.get("/teacher/assignments/{assignment_id}/submissions/{student_id}", response_model=CourseworkSubmissionDetailResponse)
def get_teacher_submission_detail(
    assignment_id: int,
    student_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    college_id: Annotated[int | None, Query(gt=0)] = None,
):
    context = _context(db, current_user, _TEACHER, college_id)
    try:
        assignment = _owned_assignment(db, context, assignment_id)
        _teacher_owns_assignment(db, context, assignment)
        return _submission_detail(db, context, assignment, student_id)
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        _database_unavailable(db, exc)


@router.get("/admin/assignments/{assignment_id}/submissions/{student_id}", response_model=CourseworkSubmissionDetailResponse)
def get_admin_submission_detail(
    assignment_id: int,
    student_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    college_id: Annotated[int | None, Query(gt=0)] = None,
):
    context = _context(db, current_user, _ADMIN, college_id)
    try:
        assignment = _owned_assignment(db, context, assignment_id)
        return _submission_detail(db, context, assignment, student_id)
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        _database_unavailable(db, exc)


@router.post(
    "/teacher/assignments/{assignment_id}/submissions/{student_id}/grade",
    response_model=CourseworkGradeResponse,
    status_code=status.HTTP_201_CREATED,
)
def grade_coursework_submission(
    assignment_id: int,
    student_id: int,
    body: CourseworkGradeCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    college_id: Annotated[int | None, Query(gt=0)] = None,
):
    context = _context(db, current_user, _TEACHER, college_id)
    try:
        assignment = _owned_assignment(db, context, assignment_id, lock=True, share_lock=True)
        _teacher_owns_assignment(db, context, assignment)

        # Reuse the existing tenant, active-student and active-enrollment checks.
        _submission_detail(db, context, assignment, student_id)

        submission = (
            db.query(CourseworkSubmission)
            .filter(
                CourseworkSubmission.coursework_assignment_id == assignment.id,
                CourseworkSubmission.student_id == student_id,
                CourseworkSubmission.college_id == context.college_id,
            )
            .with_for_update()
            .one_or_none()
        )
        if submission is None:
            raise HTTPException(status_code=404, detail="Coursework submission not found.")

        latest_revision = (
            db.query(CourseworkSubmissionRevision)
            .filter(
                CourseworkSubmissionRevision.coursework_submission_id == submission.id,
                CourseworkSubmissionRevision.college_id == context.college_id,
            )
            .order_by(CourseworkSubmissionRevision.revision_number.desc())
            .with_for_update()
            .first()
        )
        if latest_revision is None:
            raise HTTPException(status_code=409, detail="The student has not submitted coursework.")

        if assignment.maximum_marks is not None and body.marks_awarded > assignment.maximum_marks:
            raise HTTPException(
                status_code=422,
                detail=f"Marks cannot exceed the maximum of {assignment.maximum_marks}.",
            )

        latest_version = (
            db.query(func.max(CourseworkSubmissionGrade.version))
            .filter(
                CourseworkSubmissionGrade.coursework_submission_id == submission.id,
                CourseworkSubmissionGrade.revision_id == latest_revision.id,
                CourseworkSubmissionGrade.college_id == context.college_id,
            )
            .scalar()
        ) or 0

        grade = CourseworkSubmissionGrade(
            coursework_submission_id=submission.id,
            revision_id=latest_revision.id,
            college_id=context.college_id,
            version=latest_version + 1,
            marks_awarded=body.marks_awarded,
            feedback=body.feedback.strip() if body.feedback and body.feedback.strip() else None,
            graded_by_membership_id=context.membership_id,
            graded_by_user_id=context.user_id,
        )
        db.add(grade)
        db.flush()

        student_link = (
            db.query(StudentAccountLink)
            .filter(
                StudentAccountLink.student_id == student_id,
                StudentAccountLink.college_id == context.college_id,
                StudentAccountLink.link_status == "active",
            )
            .one_or_none()
        )
        if student_link is not None:
            _queue_in_app_event(
                db,
                user_id=student_link.user_id,
                college_id=context.college_id,
                student_id=student_id,
                event_type="coursework_graded",
                idempotency_key=f"coursework:grade:{grade.id}:student:{student_link.user_id}",
                title="Coursework graded",
                message=f"{assignment.title}: {grade.marks_awarded} marks awarded.",
            )

        db.commit()
        db.refresh(grade)
        return grade
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="The grade could not be saved because the submission changed. Refresh and try again.",
        ) from exc
    except SQLAlchemyError as exc:
        _database_unavailable(db, exc)


@router.get("/student/assignments", response_model=list[CourseworkStudentAssignmentResponse])
def list_student_assignments(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    college_id: Annotated[int | None, Query(gt=0)] = None,
):
    context = _context(db, current_user, _STUDENT, college_id)
    try:
        student = _student_identity(db, context)
        now = datetime.now(timezone.utc)
        classes = [row[0] for row in _active_enrollments(db, context.college_id, student.id, now)]
        if not classes:
            return []
        rows = (
            db.query(CourseworkAssignment)
            .join(TeacherAssignment, TeacherAssignment.id == CourseworkAssignment.teacher_assignment_id)
            .join(Class, Class.id == TeacherAssignment.class_id)
            .join(Subject, Subject.id == TeacherAssignment.subject_id)
            .filter(CourseworkAssignment.college_id == context.college_id,
                    CourseworkAssignment.status.in_({"published", "archived"}),
                    CourseworkAssignment.published_at.is_not(None),
                    TeacherAssignment.college_id == context.college_id,
                    TeacherAssignment.class_id.in_(classes),
                    TeacherAssignment.is_active.is_(True),
                    Class.college_id == context.college_id,
                    Class.is_active.is_(True),
                    Subject.college_id == context.college_id,
                    Subject.is_active.is_(True),
                    active_relationship_at(db, TeacherAssignment, now))
            .order_by(CourseworkAssignment.due_at.asc(), CourseworkAssignment.id.asc())
            .all()
        )
        result = []
        for assignment in rows:
            submission = (db.query(CourseworkSubmission)
                          .filter(CourseworkSubmission.coursework_assignment_id == assignment.id,
                                  CourseworkSubmission.student_id == student.id,
                                  CourseworkSubmission.college_id == context.college_id)
                          .one_or_none())
            latest = None
            if submission:
                latest = (db.query(CourseworkSubmissionRevision)
                          .filter(CourseworkSubmissionRevision.coursework_submission_id == submission.id,
                                  CourseworkSubmissionRevision.college_id == context.college_id)
                          .order_by(CourseworkSubmissionRevision.revision_number.desc())
                          .first())
            if assignment.status == "archived":
                state = "archived"
            elif latest is not None:
                state = "late" if latest.is_late else "submitted"
            elif now > as_utc_datetime(assignment.due_at):
                state = "late"
            elif now < as_utc_datetime(assignment.issued_at):
                state = "available"
            else:
                state = "pending"
            current_grade = (
                _current_grade(db, submission.id, latest.id, context.college_id)
                if submission is not None and latest is not None else None
            )
            result.append(CourseworkStudentAssignmentResponse(
                **CourseworkAssignmentResponse.model_validate(assignment).model_dump(),
                submission_id=submission.id if submission else None,
                latest_revision=latest,
                current_grade=current_grade,
                state=state,
            ))
        return result
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        _database_unavailable(db, exc)


@router.post("/student/assignments/{assignment_id}/submissions", response_model=CourseworkSubmissionResponse, status_code=201)
def submit_text(
    assignment_id: int,
    body: CourseworkSubmissionCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    college_id: Annotated[int | None, Query(gt=0)] = None,
):
    context = _context(db, current_user, _STUDENT, college_id)
    try:
        # Lock order mirrors the migration contract: assignment, account link,
        # enrollment, logical submission, then append-only revision.
        assignment = _owned_assignment(db, context, assignment_id, lock=True, share_lock=True)
        if assignment.status != "published" or assignment.archived_at is not None:
            raise HTTPException(status_code=404, detail="Published coursework assignment not found.")
        student = _student_identity(db, context)
        link = (db.query(StudentAccountLink)
                .filter(StudentAccountLink.user_id == context.user_id,
                        StudentAccountLink.student_id == student.id,
                        StudentAccountLink.college_id == context.college_id,
                        StudentAccountLink.link_status == "active")
                .with_for_update(read=True).one_or_none())
        if link is None:
            raise HTTPException(status_code=403, detail="An active verified Student profile link is required.")
        mapping = (db.query(TeacherAssignment)
                   .join(Class, Class.id == TeacherAssignment.class_id)
                   .join(Subject, Subject.id == TeacherAssignment.subject_id)
                   .filter(TeacherAssignment.id == assignment.teacher_assignment_id,
                           TeacherAssignment.college_id == context.college_id,
                           Class.college_id == context.college_id,
                           Class.is_active.is_(True),
                           Subject.college_id == context.college_id,
                           Subject.is_active.is_(True),
                           TeacherAssignment.is_active.is_(True),
                           active_relationship_at(db, TeacherAssignment, datetime.now(timezone.utc)))
                   .one_or_none())
        now = datetime.now(timezone.utc)
        enrollment = (db.query(StudentClassAssignment)
                      .filter(StudentClassAssignment.college_id == context.college_id,
                              StudentClassAssignment.student_id == student.id,
                              StudentClassAssignment.class_id == mapping.class_id if mapping else False,
                              StudentClassAssignment.is_active.is_(True),
                              active_relationship_at(db, StudentClassAssignment, now))
                      .with_for_update(read=True).one_or_none())
        if mapping is None or enrollment is None:
            raise HTTPException(status_code=404, detail="Active enrollment for this coursework class was not found.")
        submission = (db.query(CourseworkSubmission)
                      .filter(CourseworkSubmission.coursework_assignment_id == assignment.id,
                              CourseworkSubmission.student_id == student.id,
                              CourseworkSubmission.college_id == context.college_id)
                      .with_for_update().one_or_none())
        if submission is None:
            submission = CourseworkSubmission(coursework_assignment_id=assignment.id,
                                              student_id=student.id,
                                              college_id=context.college_id,
                                              created_at=now)
            db.add(submission)
            db.flush()
        existing = (db.query(CourseworkSubmissionRevision)
                    .filter(CourseworkSubmissionRevision.coursework_submission_id == submission.id,
                            CourseworkSubmissionRevision.idempotency_key == body.idempotency_key)
                    .one_or_none())
        if existing is not None:
            if existing.content != body.content.strip():
                raise HTTPException(status_code=409, detail="Idempotency key was already used with different submission text.")
            db.commit()
            return CourseworkSubmissionResponse(submission_id=submission.id,
                                                coursework_assignment_id=assignment.id,
                                                revisions=[existing])
        latest_number = (db.query(func.max(CourseworkSubmissionRevision.revision_number))
                         .filter(CourseworkSubmissionRevision.coursework_submission_id == submission.id)
                         .scalar()) or 0
        revision = CourseworkSubmissionRevision(
            coursework_submission_id=submission.id,
            college_id=context.college_id,
            revision_number=latest_number + 1,
            idempotency_key=body.idempotency_key,
            content=body.content.strip(),
            submitted_at=now,
            is_late=now > as_utc_datetime(assignment.due_at),
        )
        db.add(revision)
        db.flush()
        _queue_in_app_event(
            db,
            user_id=context.user_id,
            college_id=context.college_id,
            student_id=student.id,
            event_type=("coursework_submission_confirmation" if latest_number == 0
                        else "coursework_submission_revision_confirmation"),
            idempotency_key=f"coursework:submission:{assignment.id}:{student.id}:confirmation:{revision.id}",
            title=("Coursework submitted" if latest_number == 0
                   else "Coursework revision saved"),
            message=(f"Your submission for {assignment.title} was recorded." if latest_number == 0
                     else f"Your revision for {assignment.title} was recorded."),
        )
        _notify_teacher_submission(db, context, assignment, mapping, student, revision.id,
                                   revision.revision_number)
        db.commit()
        db.refresh(revision)
        return CourseworkSubmissionResponse(submission_id=submission.id,
                                            coursework_assignment_id=assignment.id,
                                            revisions=[revision])
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Submission conflicted with another request; retry with the same idempotency key.") from exc
    except SQLAlchemyError as exc:
        _database_unavailable(db, exc)


@router.get("/student/assignments/{assignment_id}/submissions", response_model=CourseworkSubmissionResponse)
def get_student_submission_history(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    college_id: Annotated[int | None, Query(gt=0)] = None,
):
    context = _context(db, current_user, _STUDENT, college_id)
    try:
        student = _student_identity(db, context)
        assignment = _owned_assignment(db, context, assignment_id)
        mapping = db.query(TeacherAssignment).join(Class, Class.id == TeacherAssignment.class_id).join(
            Subject, Subject.id == TeacherAssignment.subject_id
        ).filter(
            TeacherAssignment.id == assignment.teacher_assignment_id,
            TeacherAssignment.college_id == context.college_id,
            Class.college_id == context.college_id,
            Subject.college_id == context.college_id,
        ).one_or_none()
        enrolled = mapping and db.query(StudentClassAssignment.id).filter(
            StudentClassAssignment.college_id == context.college_id,
            StudentClassAssignment.student_id == student.id,
            StudentClassAssignment.class_id == mapping.class_id,
            StudentClassAssignment.is_active.is_(True),
            active_relationship_at(db, StudentClassAssignment, datetime.now(timezone.utc)),
        ).first()
        if not enrolled:
            raise HTTPException(status_code=404, detail="Coursework submission history not found.")
        submission = db.query(CourseworkSubmission).filter(
            CourseworkSubmission.coursework_assignment_id == assignment.id,
            CourseworkSubmission.student_id == student.id,
            CourseworkSubmission.college_id == context.college_id,
        ).one_or_none()
        if submission is None:
            raise HTTPException(status_code=404, detail="Coursework submission history not found.")
        revisions = db.query(CourseworkSubmissionRevision).filter(
            CourseworkSubmissionRevision.coursework_submission_id == submission.id,
            CourseworkSubmissionRevision.college_id == context.college_id,
        ).order_by(CourseworkSubmissionRevision.revision_number.asc()).all()
        return CourseworkSubmissionResponse(submission_id=submission.id,
                                             coursework_assignment_id=assignment.id,
                                             revisions=revisions)
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        _database_unavailable(db, exc)


@router.get("/admin/assignments", response_model=CourseworkAdminListResponse)
def list_admin_assignments(
    teacher_id: int | None = Query(default=None, gt=0),
    class_id: int | None = Query(default=None, gt=0),
    subject_id: int | None = Query(default=None, gt=0),
    assignment_status: str | None = Query(default=None, alias="status", pattern="^(draft|published|archived)$"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    college_id: Annotated[int | None, Query(gt=0)] = None,
    due_from: Annotated[datetime | None, Query()] = None,
    due_to: Annotated[datetime | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    context = _context(db, current_user, _ADMIN, college_id)
    try:
        for model, value in (
            (Teacher, teacher_id),
            (Class, class_id),
            (Subject, subject_id),
        ):
            if value is not None and db.query(model.id).filter(
                model.id == value,
                model.college_id == context.college_id,
            ).first() is None:
                raise HTTPException(
                    status_code=404,
                    detail="One or more selected filters are not available in this College.",
                )

        query = (db.query(CourseworkAssignment, TeacherAssignment, Teacher, Class, Subject)
                 .join(TeacherAssignment, TeacherAssignment.id == CourseworkAssignment.teacher_assignment_id)
                 .join(Teacher, Teacher.id == TeacherAssignment.teacher_id)
                 .join(Class, Class.id == TeacherAssignment.class_id)
                 .join(Subject, Subject.id == TeacherAssignment.subject_id)
                 .filter(CourseworkAssignment.college_id == context.college_id,
                         TeacherAssignment.college_id == context.college_id,
                         Teacher.college_id == context.college_id,
                         Class.college_id == context.college_id,
                         Subject.college_id == context.college_id))
        if teacher_id is not None:
            query = query.filter(TeacherAssignment.teacher_id == teacher_id)
        if class_id is not None:
            query = query.filter(TeacherAssignment.class_id == class_id)
        if subject_id is not None:
            query = query.filter(TeacherAssignment.subject_id == subject_id)
        if assignment_status is not None:
            query = query.filter(CourseworkAssignment.status == assignment_status)
        if due_from is not None:
            query = query.filter(CourseworkAssignment.due_at >= _aware(due_from))
        if due_to is not None:
            query = query.filter(CourseworkAssignment.due_at <= _aware(due_to))
        if due_from is not None and due_to is not None and _aware(due_to) < _aware(due_from):
            raise HTTPException(status_code=422, detail="The end of the deadline range must not precede its start.")
        total = query.with_entities(CourseworkAssignment.id).order_by(None).count()
        status_counts = dict(
            query.with_entities(CourseworkAssignment.status, func.count(CourseworkAssignment.id))
            .group_by(CourseworkAssignment.status)
            .all()
        )
        matching_ids = query.with_entities(CourseworkAssignment.id).order_by(None).subquery()
        submissions_total = db.query(func.count(CourseworkSubmission.id)).filter(
            CourseworkSubmission.college_id == context.college_id,
            CourseworkSubmission.coursework_assignment_id.in_(matching_ids.select()),
        ).scalar() or 0

        summary_now = datetime.now(timezone.utc)
        eligible_enrollments = (
            db.query(
                StudentClassAssignment.class_id.label("class_id"),
                func.count(func.distinct(StudentClassAssignment.student_id)).label("enrolled_count"),
            )
            .join(
                Student,
                and_(Student.id == StudentClassAssignment.student_id,
                     Student.college_id == context.college_id),
            )
            .join(
                StudentAccountLink,
                and_(StudentAccountLink.student_id == Student.id,
                     StudentAccountLink.college_id == context.college_id,
                     StudentAccountLink.link_status == "active"),
            )
            .join(
                User,
                and_(User.id == StudentAccountLink.user_id, User.is_active.is_(True)),
            )
            .join(
                CollegeMembership,
                and_(CollegeMembership.user_id == User.id,
                     CollegeMembership.college_id == context.college_id,
                     CollegeMembership.role == "student",
                     CollegeMembership.status == "active"),
            )
            .filter(
                StudentClassAssignment.college_id == context.college_id,
                StudentClassAssignment.is_active.is_(True),
                Student.is_active.is_(True),
                active_relationship_at(db, StudentClassAssignment, summary_now),
            )
            .group_by(StudentClassAssignment.class_id)
            .subquery()
        )
        submission_counts = (
            db.query(
                CourseworkSubmission.coursework_assignment_id.label("assignment_id"),
                func.count(CourseworkSubmission.id).label("submission_count"),
            )
            .filter(
                CourseworkSubmission.college_id == context.college_id,
                CourseworkSubmission.coursework_assignment_id.in_(matching_ids.select()),
            )
            .group_by(CourseworkSubmission.coursework_assignment_id)
            .subquery()
        )
        filtered_assignment_mappings = query.filter(
            CourseworkAssignment.status == "published",
            CourseworkAssignment.published_at.is_not(None),
            CourseworkAssignment.archived_at.is_(None),
            CourseworkAssignment.issued_at <= summary_now,
            CourseworkAssignment.due_at >= summary_now,
        ).with_entities(
            CourseworkAssignment.id.label("assignment_id"),
            TeacherAssignment.class_id.label("class_id"),
        ).order_by(None).subquery()
        pending_rows = (
            db.query(
                func.coalesce(eligible_enrollments.c.enrolled_count, 0),
                func.coalesce(submission_counts.c.submission_count, 0),
            )
            .select_from(filtered_assignment_mappings)
            .outerjoin(
                eligible_enrollments,
                eligible_enrollments.c.class_id == filtered_assignment_mappings.c.class_id,
            )
            .outerjoin(
                submission_counts,
                submission_counts.c.assignment_id == filtered_assignment_mappings.c.assignment_id,
            )
            .all()
        )
        pending_submissions_total = sum(
            max(int(enrolled or 0) - int(submitted or 0), 0)
            for enrolled, submitted in pending_rows
        )

        latest_revisions_for_summary = (
            db.query(
                CourseworkSubmissionRevision.coursework_submission_id.label("submission_id"),
                func.max(CourseworkSubmissionRevision.revision_number).label("revision_number"),
            )
            .filter(CourseworkSubmissionRevision.college_id == context.college_id)
            .group_by(CourseworkSubmissionRevision.coursework_submission_id)
            .subquery()
        )
        late_submissions_by_assignment = (
            db.query(
                CourseworkSubmission.coursework_assignment_id.label("assignment_id"),
                func.count(CourseworkSubmissionRevision.id).label("late_count"),
            )
            .join(
                CourseworkSubmissionRevision,
                and_(CourseworkSubmissionRevision.coursework_submission_id == CourseworkSubmission.id,
                     CourseworkSubmissionRevision.college_id == context.college_id),
            )
            .join(
                latest_revisions_for_summary,
                and_(CourseworkSubmissionRevision.coursework_submission_id == latest_revisions_for_summary.c.submission_id,
                     CourseworkSubmissionRevision.revision_number == latest_revisions_for_summary.c.revision_number),
            )
            .filter(CourseworkSubmission.college_id == context.college_id)
            .group_by(CourseworkSubmission.coursework_assignment_id)
            .subquery()
        )
        late_submissions_total = db.query(
            func.coalesce(func.sum(late_submissions_by_assignment.c.late_count), 0)
        ).filter(
            late_submissions_by_assignment.c.assignment_id.in_(matching_ids.select())
        ).scalar() or 0

        facet_query = (
            db.query(Teacher.id, Teacher.name, Class.id, Class.name, Subject.id, Subject.name)
            .join(TeacherAssignment, TeacherAssignment.teacher_id == Teacher.id)
            .join(Class, Class.id == TeacherAssignment.class_id)
            .join(Subject, Subject.id == TeacherAssignment.subject_id)
            .filter(Teacher.college_id == context.college_id,
                    TeacherAssignment.college_id == context.college_id,
                    Class.college_id == context.college_id,
                    Subject.college_id == context.college_id)
        )
        teachers, classes, subjects = set(), set(), set()
        for teacher_pk, teacher_name, class_pk, class_name, subject_pk, subject_name in facet_query.all():
            teachers.add((teacher_pk, teacher_name))
            classes.add((class_pk, class_name))
            subjects.add((subject_pk, subject_name))

        result = []
        rows = (
            query.outerjoin(
                submission_counts,
                submission_counts.c.assignment_id == CourseworkAssignment.id,
            )
            .outerjoin(
                eligible_enrollments,
                eligible_enrollments.c.class_id == TeacherAssignment.class_id,
            )
            .outerjoin(
                late_submissions_by_assignment,
                late_submissions_by_assignment.c.assignment_id == CourseworkAssignment.id,
            )
            .add_columns(
                func.coalesce(submission_counts.c.submission_count, 0),
                func.coalesce(eligible_enrollments.c.enrolled_count, 0),
                func.coalesce(late_submissions_by_assignment.c.late_count, 0),
            )
            .order_by(CourseworkAssignment.created_at.desc(), CourseworkAssignment.id.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
        for assignment, mapping, teacher, classroom, subject, submission_count, enrolled_count, late_count in rows:
            submission_count = int(submission_count or 0)
            enrolled_count = int(enrolled_count or 0)
            late_count = int(late_count or 0)
            result.append(CourseworkAdminSummaryResponse(
                **CourseworkAssignmentResponse.model_validate(assignment).model_dump(),
                teacher_id=mapping.teacher_id,
                teacher_name=teacher.name,
                class_id=mapping.class_id,
                class_name=classroom.name,
                subject_id=mapping.subject_id,
                subject_name=subject.name,
                academic_year=mapping.academic_year,
                semester=mapping.semester,
                submission_count=submission_count,
                enrolled_count=enrolled_count,
                pending_count=(
                    max(enrolled_count - submission_count, 0)
                    if _assignment_accepts_submissions(assignment, summary_now)
                    else 0
                ),
                late_submission_count=late_count,
                completion_percentage=(submission_count / enrolled_count * 100) if enrolled_count else 0.0,
            ))
        return CourseworkAdminListResponse(
            items=result,
            total=total,
            limit=limit,
            offset=offset,
            summary=CourseworkAdminTotalsResponse(
                total=total,
                published=status_counts.get("published", 0),
                draft=status_counts.get("draft", 0),
                archived=status_counts.get("archived", 0),
                submissions=submissions_total,
                pending_submissions=pending_submissions_total,
                late_submissions=int(late_submissions_total),
            ),
            teachers=[CourseworkAdminFacetResponse(id=pk, name=name) for pk, name in sorted(teachers, key=lambda item: item[1].casefold())],
            classes=[CourseworkAdminFacetResponse(id=pk, name=name) for pk, name in sorted(classes, key=lambda item: item[1].casefold())],
            subjects=[CourseworkAdminFacetResponse(id=pk, name=name) for pk, name in sorted(subjects, key=lambda item: item[1].casefold())],
        )
    except SQLAlchemyError as exc:
        _database_unavailable(db, exc)


@router.get("/admin/assignments/{assignment_id}", response_model=CourseworkAdminSummaryResponse)
def get_admin_assignment_detail(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    college_id: Annotated[int | None, Query(gt=0)] = None,
):
    context = _context(db, current_user, _ADMIN, college_id)
    try:
        row = (
            db.query(CourseworkAssignment, TeacherAssignment, Teacher, Class, Subject)
            .join(TeacherAssignment, TeacherAssignment.id == CourseworkAssignment.teacher_assignment_id)
            .join(Teacher, Teacher.id == TeacherAssignment.teacher_id)
            .join(Class, Class.id == TeacherAssignment.class_id)
            .join(Subject, Subject.id == TeacherAssignment.subject_id)
            .filter(
                CourseworkAssignment.id == assignment_id,
                CourseworkAssignment.college_id == context.college_id,
                TeacherAssignment.college_id == context.college_id,
                Teacher.college_id == context.college_id,
                Class.college_id == context.college_id,
                Subject.college_id == context.college_id,
            )
            .one_or_none()
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Coursework assignment not found.")
        assignment, mapping, teacher, classroom, subject = row
        roster = _submission_monitor(db, context, assignment)
        submission_count = sum(item.submission_id is not None for item in roster)
        enrolled_count = len(roster)
        late_count = sum(
            item.latest_revision is not None and item.latest_revision.is_late
            for item in roster
        )
        return CourseworkAdminSummaryResponse(
            **CourseworkAssignmentResponse.model_validate(assignment).model_dump(),
            teacher_id=mapping.teacher_id,
            teacher_name=teacher.name,
            class_id=mapping.class_id,
            class_name=classroom.name,
            subject_id=mapping.subject_id,
            subject_name=subject.name,
            academic_year=mapping.academic_year,
            semester=mapping.semester,
            submission_count=submission_count,
            enrolled_count=enrolled_count,
            pending_count=(
                max(enrolled_count - submission_count, 0)
                if _assignment_accepts_submissions(assignment, datetime.now(timezone.utc))
                else 0
            ),
            late_submission_count=late_count,
            completion_percentage=(submission_count / enrolled_count * 100) if enrolled_count else 0.0,
        )
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        _database_unavailable(db, exc)


@router.post("/teacher/assignments/{assignment_id}/deadline-extension", response_model=CourseworkAssignmentResponse)
def extend_deadline(
    assignment_id: int,
    body: CourseworkReason,
    due_at: datetime = Query(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    college_id: Annotated[int | None, Query(gt=0)] = None,
):
    context = _context(db, current_user, _TEACHER, college_id)
    try:
        assignment = _owned_assignment(db, context, assignment_id, lock=True)
        _teacher_owns_assignment(db, context, assignment)
        proposed = _aware(due_at)
        if assignment.status != "published" or assignment.archived_at is not None:
            raise HTTPException(status_code=409, detail="Only published, active assignments can have a deadline extension.")
        if proposed <= as_utc_datetime(assignment.due_at):
            raise HTTPException(status_code=422, detail="A deadline extension must move the due time later.")
        previous = {"due_at": as_utc_datetime(assignment.due_at).isoformat()}
        audit = _audit(context, assignment, "deadline_extended", previous, {"due_at": proposed.isoformat()}, body.reason)
        db.add(audit)
        db.flush([audit])
        assignment.due_at = proposed
        assignment.updated_at = datetime.now(timezone.utc)
        _notify_students_assignment_event(
            db, assignment, _teacher_owns_assignment(db, context, assignment),
            event_type="coursework_deadline_extended",
            idempotency_scope=f"deadline-extension:audit:{audit.id}",
            title="Coursework deadline extended",
            message=f"The deadline for {assignment.title} was extended to {proposed.isoformat()}.",
        )
        db.commit()
        db.refresh(assignment)
        return assignment
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        _database_unavailable(db, exc)


@router.post("/teacher/assignments/{assignment_id}/archive", response_model=CourseworkAssignmentResponse)
def archive_assignment(
    assignment_id: int,
    body: CourseworkReason,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    college_id: Annotated[int | None, Query(gt=0)] = None,
):
    context = _context(db, current_user, _TEACHER, college_id)
    try:
        assignment = _owned_assignment(db, context, assignment_id, lock=True)
        _teacher_owns_assignment(db, context, assignment)
        if assignment.status != "published" or assignment.archived_at is not None:
            raise HTTPException(status_code=409, detail="Only a published, active assignment can be archived.")
        now = datetime.now(timezone.utc)
        previous = {"status": assignment.status, "archived_at": None}
        audit = _audit(context, assignment, "archived", previous,
                       {"status": "archived", "archived_at": now.isoformat()}, body.reason)
        db.add(audit)
        db.flush([audit])
        mapping = _teacher_owns_assignment(db, context, assignment)
        assignment.status = "archived"
        assignment.archived_at = now
        assignment.updated_at = now
        _notify_students_assignment_event(
            db, assignment, mapping,
            event_type="coursework_assignment_archived",
            idempotency_scope=f"archived:audit:{audit.id}",
            title="Coursework assignment archived",
            message=f"{assignment.title} is now archived and no longer accepts submissions.",
        )
        db.commit()
        db.refresh(assignment)
        return assignment
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        _database_unavailable(db, exc)

