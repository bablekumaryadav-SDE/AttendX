"""College-scoped Class catalog and College Admin management routes."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import Class
from app.schemas.class_ import ClassCreate, ClassResponse, ClassUpdate
from app.tenant_context import resolve_tenant_context
from app.tenant_ownership import bind_new_record_to_context, resolve_college_record


router = APIRouter()
READ_ROLES = frozenset({"college_admin", "teacher", "student"})
WRITE_ROLES = frozenset({"college_admin"})
_UNAVAILABLE = "College-scoped Class catalog is unavailable."


def _resolve_class_context(db: Session, current_user, college_id=None):
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


@router.get("/", response_model=list[ClassResponse])
def list_tenant_classes(
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_class_context(db, current_user, college_id)
    try:
        return (
            db.query(Class)
            .filter(Class.college_id == context.college_id, Class.college_id.is_not(None))
            .order_by(Class.id.asc())
            .all()
        )
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc


@router.get("/{class_id}", response_model=ClassResponse)
def read_tenant_class(
    class_id: int,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_class_context(db, current_user, college_id)
    try:
        return resolve_college_record(db, Class, class_id, context)
    except HTTPException as exc:
        if exc.status_code != status.HTTP_503_SERVICE_UNAVAILABLE:
            raise
        raise _unavailable() from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc


def _require_class_writer(context):
    if context.membership_role not in WRITE_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="College administrator membership required.")


def _validate_effective_location(class_record, changes):
    latitude = changes.get("latitude", class_record.latitude)
    longitude = changes.get("longitude", class_record.longitude)
    location_name = changes.get("location_name", class_record.location_name)
    if (latitude is None) != (longitude is None):
        raise HTTPException(status_code=422, detail="Latitude and longitude must be configured or cleared together.")
    if location_name and latitude is None:
        raise HTTPException(status_code=422, detail="Set valid coordinates before naming a classroom location.")


@router.post("/", response_model=ClassResponse, status_code=status.HTTP_201_CREATED)
def create_tenant_class(
    payload: ClassCreate,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_class_context(db, current_user, college_id)
    _require_class_writer(context)
    values = payload.model_dump()
    if (values["latitude"] is None) != (values["longitude"] is None):
        raise HTTPException(status_code=422, detail="Latitude and longitude must be configured together.")
    if values["location_name"] and values["latitude"] is None:
        raise HTTPException(status_code=422, detail="Set valid coordinates before naming a classroom location.")
    record = Class(**values)
    bind_new_record_to_context(record, context, payload=payload)
    try:
        db.add(record)
        db.commit()
        db.refresh(record)
        return record
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Class conflicts with existing College data.") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc


@router.patch("/{class_id}", response_model=ClassResponse)
def update_tenant_class(
    class_id: int,
    payload: ClassUpdate,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    context = _resolve_class_context(db, current_user, college_id)
    _require_class_writer(context)
    try:
        record = resolve_college_record(db, Class, class_id, context)
        changes = payload.model_dump(exclude_unset=True)
        _validate_effective_location(record, changes)
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
        raise HTTPException(status_code=409, detail="Class conflicts with existing College data.") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc


@router.delete("/{class_id}", response_model=ClassResponse)
def deactivate_tenant_class(
    class_id: int,
    college_id: Optional[int] = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Retain academic/attendance history by deactivating instead of deleting."""
    context = _resolve_class_context(db, current_user, college_id)
    _require_class_writer(context)
    try:
        record = resolve_college_record(db, Class, class_id, context)
        record.is_active = False
        db.commit()
        db.refresh(record)
        return record
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise _unavailable() from exc
