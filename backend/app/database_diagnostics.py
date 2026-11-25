"""Safe, structured metadata extraction for SQLAlchemy database failures."""

import re
import sqlite3

from sqlalchemy.exc import IntegrityError, OperationalError


def _safe_catalog_identifier(value) -> str | None:
    """Keep identifiers bounded and single-line before placing them in logs."""
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_$]{0,62}", value):
        return None
    return value


def safe_database_diagnostics(exc: Exception) -> tuple[str, str | None, str | None, str | None, str | None, str | None, str]:
    """Return exception class, SQLSTATE and safe object identifiers, never SQL."""
    original = getattr(exc, "orig", None)
    sqlstate = getattr(original, "sqlstate", None) or getattr(original, "pgcode", None)
    diagnostic = getattr(original, "diag", None)
    constraint = _safe_catalog_identifier(getattr(diagnostic, "constraint_name", None)) if diagnostic else None
    schema_name = _safe_catalog_identifier(getattr(diagnostic, "schema_name", None)) if diagnostic else None
    relation_name = _safe_catalog_identifier(getattr(diagnostic, "table_name", None)) if diagnostic else None
    column_name = _safe_catalog_identifier(getattr(diagnostic, "column_name", None)) if diagnostic else None
    if sqlstate == "42P01" and relation_name is None:
        # Some PostgreSQL drivers leave diag.table_name empty for undefined
        # relations. Parse only the database's primary error phrase, then pass
        # each identifier through the same strict allow-list used for logs.
        primary = getattr(diagnostic, "message_primary", None) if diagnostic else None
        match = re.search(
            r'relation\s+(?:"([^"]{1,130})"|([A-Za-z_][A-Za-z0-9_$]{0,62}))\s+does not exist',
            str(primary or ""),
            re.IGNORECASE,
        )
        if match:
            raw_relation = match.group(1) or match.group(2)
            if "." in raw_relation:
                raw_schema, raw_relation = raw_relation.rsplit(".", 1)
                schema_name = schema_name or _safe_catalog_identifier(raw_schema)
            relation_name = _safe_catalog_identifier(raw_relation)
    message = str(original or "").lower()

    if sqlstate == "42P01":
        failure_class = "schema_missing_table"
    elif sqlstate == "42703":
        failure_class = "schema_missing_column"
    elif sqlstate == "3F000":
        failure_class = "schema_missing_schema"
    elif sqlstate and sqlstate.startswith("08"):
        failure_class = "database_connection_failure"
    elif isinstance(original, sqlite3.OperationalError) and "no such table" in message:
        failure_class = "schema_missing_table"
    elif isinstance(original, sqlite3.OperationalError) and "no such column" in message:
        failure_class = "schema_missing_column"
    elif isinstance(exc, OperationalError):
        failure_class = "database_operation_failure"
    elif isinstance(exc, IntegrityError):
        failure_class = "database_integrity_failure"
    else:
        failure_class = "database_operation_failure"

    return type(exc).__name__, sqlstate, constraint, schema_name, relation_name, column_name, failure_class
