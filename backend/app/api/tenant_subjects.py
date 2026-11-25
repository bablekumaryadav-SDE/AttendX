"""College-scoped Subject catalog and College Admin management routes.

These two routes are mounted before the default-deny legacy Subject router.
Writes are available only to authenticated College Admin memberships.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import Subject
from app.schemas.subject import SubjectCreate, SubjectResponse, SubjectUpdate
from app.tenant_context import resolve_tenant_context
from app.tenant_ownership import bind_new_record_to_context, resolve_college_record


router = APIRouter()
READ_ROLES = frozenset({"college_admin", "teacher", "student"})
WRITE_ROLES = frozenset({"college_admin"})


def _resolve_subject_read_context(db: Session, current_user, college_id=None):
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
            detail="College-scoped Subject catalog is unavailable.",
        ) from exc


@router.get("/", response_model=list[SubjectResponse])
def list_tenant_subjects(
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_subject_read_context(db, current_user, college_id)
    try:
        return (
            db.query(Subject)
            .filter(
                Subject.college_id == context.college_id,
                Subject.college_id.is_not(None),
            )
            .order_by(Subject.id.asc())
            .all()
        )
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="College-scoped Subject catalog is unavailable.",
        ) from exc


@router.get("/{subject_id}", response_model=SubjectResponse)
def read_tenant_subject(
    subject_id: int,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_subject_read_context(db, current_user, college_id)
    try:
        return resolve_college_record(db, Subject, subject_id, context)
    except HTTPException as exc:
        if exc.status_code != status.HTTP_503_SERVICE_UNAVAILABLE:
            raise
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="College-scoped Subject catalog is unavailable.",
        ) from exc


def _require_subject_writer(context):
    if context.membership_role not in WRITE_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="College administrator membership required.")


@router.post("/", response_model=SubjectResponse, status_code=status.HTTP_201_CREATED)
def create_tenant_subject(
    payload: SubjectCreate,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_subject_read_context(db, current_user, college_id)
    _require_subject_writer(context)
    try:
        duplicate = db.query(Subject.id).filter(
            Subject.college_id == context.college_id,
            Subject.code == payload.code,
        ).first()
        if duplicate:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Subject code is already in use in this College.")
        record = Subject(**payload.model_dump())
        bind_new_record_to_context(record, context, payload=payload)
        db.add(record)
        db.commit()
        db.refresh(record)
        return record
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Subject code conflicts with existing records.") from exc
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="College-scoped Subject catalog is unavailable.",
        ) from exc


@router.patch("/{subject_id}", response_model=SubjectResponse)
def update_tenant_subject(
    subject_id: int,
    payload: SubjectUpdate,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_subject_read_context(db, current_user, college_id)
    _require_subject_writer(context)
    try:
        record = resolve_college_record(db, Subject, subject_id, context)
        changes = payload.model_dump(exclude_unset=True)
        if "code" in changes and db.query(Subject.id).filter(
            Subject.college_id == context.college_id,
            Subject.code == changes["code"],
            Subject.id != subject_id,
        ).first():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Subject code is already in use in this College.")
        for field, value in changes.items():
            setattr(record, field, value)
        db.commit()
        db.refresh(record)
        return record
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Subject code conflicts with existing records.") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="College-scoped Subject catalog is unavailable.",
        ) from exc


@router.delete("/{subject_id}", response_model=SubjectResponse)
def deactivate_tenant_subject(
    subject_id: int,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Retain assignments and attendance history by deactivating the Subject."""
    context = _resolve_subject_read_context(db, current_user, college_id)
    _require_subject_writer(context)
    try:
        record = resolve_college_record(db, Subject, subject_id, context)
        record.is_active = False
        db.commit()
        db.refresh(record)
        return record
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="College-scoped Subject catalog is unavailable.",
        ) from exc
