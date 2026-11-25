"""Reusable fail-closed checks for explicitly College-owned records.

These helpers do not assign existing records. A NULL College value is unknown
legacy ownership and is intentionally indistinguishable from a foreign record
to callers (404) so the API does not disclose that record's existence.
"""

from fastapi import HTTPException, status
from sqlalchemy.exc import SQLAlchemyError


def _not_found():
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found.")


def resolve_college_record(db, model, record_id: int, context):
    """Resolve a mapped record only when it belongs to the active College."""
    if "college_id" not in model.__table__.columns:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="College ownership is unavailable for this record type.",
        )
    try:
        record = (
            db.query(model)
            .filter(model.id == record_id, model.college_id == context.college_id)
            .one_or_none()
        )
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="College-owned data is unavailable.",
        ) from exc
    if record is None or record.college_id is None:
        raise _not_found()
    return record


def require_same_college(context, *records):
    """Reject missing/unassigned or cross-College parents without disclosure."""
    if not records or any(
        record is None or getattr(record, "college_id", None) != context.college_id
        for record in records
    ):
        raise _not_found()


def reject_college_payload(payload):
    """Reject any client attempt to supply a College ID (even the same ID)."""
    if hasattr(payload, "model_dump"):
        values = payload.model_dump(exclude_unset=True)
    elif hasattr(payload, "dict"):
        values = payload.dict(exclude_unset=True)
    else:
        values = payload
    if isinstance(values, dict) and "college_id" in values:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="College ownership is assigned by server authorization.",
        )


def bind_new_record_to_context(record, context, *, payload=None):
    """Set ownership only on a new record after rejecting client ownership input."""
    if payload is not None:
        reject_college_payload(payload)
    if getattr(record, "id", None) is not None:
        raise ValueError("College ownership binding is only for new records.")
    record.college_id = context.college_id
    return record
