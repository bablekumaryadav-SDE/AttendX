"""Validity helpers for prospective, date-aware tenant relationships."""

from datetime import datetime, timezone

from sqlalchemy import and_, inspect, or_


def as_utc_datetime(value: datetime | None) -> datetime | None:
    """Normalize DB timestamps (including SQLite's naive test values) to UTC."""
    if value is None:
        return None
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def has_effective_date_columns(db, model) -> bool:
    """Check schema capability without assuming a migration was applied."""
    # Reuse the Session's checked-out connection while a transaction is active.
    # Inspecting the Engine here would check out and close a second connection;
    # with SQLite StaticPool that can be the same DBAPI connection and closing
    # it may roll back pending writes in the Session's transaction.
    bind = db.connection() if db.in_transaction() else db.get_bind()
    schema = "public" if bind.dialect.name == "postgresql" else None
    names = {column["name"] for column in inspect(bind).get_columns(model.__tablename__, schema=schema)}
    return {"effective_from", "effective_to"}.issubset(names)


def active_relationship_at(db, model, at: datetime):
    """Return a safe current-date predicate, retaining legacy current behavior.

    Rows with recorded intervals are selected by their half-open [from, to)
    validity regardless of the legacy boolean. Rows without a verified start
    may be used for current access only while legacy is_active remains true.
    Such unknown rows are never eligible for historical trend calculations.
    """
    if not has_effective_date_columns(db, model):
        return model.is_active.is_(True)
    in_recorded_period = and_(
        model.effective_from.is_not(None),
        model.effective_from <= at,
        or_(model.effective_to.is_(None), model.effective_to > at),
    )
    legacy_current = and_(
        model.effective_from.is_(None),
        model.is_active.is_(True),
        or_(model.effective_to.is_(None), model.effective_to > at),
    )
    return or_(in_recorded_period, legacy_current)


def valid_relationship_on(model, at_column):
    """Return only relationships with known dates that contain ``at_column``."""
    return and_(
        model.effective_from.is_not(None),
        model.effective_from <= at_column,
        or_(model.effective_to.is_(None), model.effective_to > at_column),
    )


def relationship_is_active_at(*, legacy_active: bool, effective_from, effective_to, at: datetime) -> bool:
    effective_from = as_utc_datetime(effective_from)
    effective_to = as_utc_datetime(effective_to)
    at = as_utc_datetime(at)
    if effective_from is None:
        return bool(legacy_active and (effective_to is None or effective_to > at))
    return effective_from <= at and (effective_to is None or effective_to > at)
