"""Render and validate the zero-row users(id) prerequisite for tenant DDL.

This script imports the actual ORM model definitions but deliberately does not
import app.database, because that module creates an application engine and
loads local database configuration. A minimal declarative Base is supplied to
the model module in memory. No engine, connection, environment mutation, or
database operation is performed.
"""

from __future__ import annotations

import argparse
import importlib
import re
import sys
import types
from pathlib import Path

from sqlalchemy import Column, Integer, MetaData, Table
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import declarative_base
from sqlalchemy.schema import CreateTable


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
TENANT_DRAFT = REPO_ROOT / "database" / "migrations" / "DRAFT_20261105_add_tenant_foundation_postgresql_v2.sql"
DEFAULT_FIXTURE = REPO_ROOT / "database" / "fixtures" / "phase13b_tenant_users_schema.sql"
HEADER = """-- Phase 13B synthetic schema-only fixture; generated offline.
-- Source: backend/app/models.py User.id SQLAlchemy Integer primary-key metadata.
-- Includes only public.users(id), required by the tenant migration foreign keys.
-- Zero rows: no INSERT statements, credentials, user data, or production data.
-- This fixture tests FK type/key mechanics, not legacy PostgreSQL compatibility.
"""


def _load_user_model():
    """Load actual app.models without importing engine/config code."""
    backend = str(BACKEND_ROOT)
    if backend not in sys.path:
        sys.path.insert(0, backend)

    if "app.models" not in sys.modules:
        # app.models only needs Base from app.database. Supplying a plain
        # declarative base prevents database.py engine/config initialization.
        database_stub = types.ModuleType("app.database")
        database_stub.Base = declarative_base()
        database_stub.__attendx_offline_schema_stub__ = True
        sys.modules["app.database"] = database_stub

    return importlib.import_module("app.models").User


def render_fixture() -> str:
    """Compile the minimal users(id) parent table from the ORM id metadata."""
    user_model = _load_user_model()
    model_id = user_model.__table__.c.id
    if not isinstance(model_id.type, Integer):
        raise ValueError(f"User.id must be SQLAlchemy Integer, got {model_id.type!r}.")
    if not model_id.primary_key:
        raise ValueError("User.id must be a primary key for the FK fixture.")

    # Use the exact ORM type and PK semantics while omitting unrelated User
    # columns and the model's redundant non-unique id index. Autoincrement is
    # unnecessary for FK validation, so the generated column is INTEGER.
    metadata = MetaData(schema="public")
    users = Table(
        "users",
        metadata,
        Column("id", model_id.type, primary_key=True, autoincrement=False),
    )
    ddl = str(CreateTable(users).compile(dialect=postgresql.dialect())).strip()
    ddl = "\n".join(line.rstrip() for line in ddl.splitlines())
    return HEADER + ddl + ";\n"


def validate_fixture(sql: str) -> None:
    """Validate the intended narrow schema shape without parsing/executing SQL."""
    statements = re.sub(r"(?m)^\s*--.*$", "", sql)
    normalized = re.sub(r"\s+", " ", statements).strip()
    if len(re.findall(r"\bCREATE\s+TABLE\b", statements, flags=re.IGNORECASE)) != 1:
        raise ValueError("Fixture must create exactly one table.")
    if re.search(r"\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|REFERENCES)\b", statements, flags=re.IGNORECASE):
        raise ValueError("Fixture must contain only the users parent table DDL and no row/data operations.")
    if not re.search(r"CREATE TABLE public\.users\s*\(\s*id INTEGER NOT NULL,\s*PRIMARY KEY \(id\)\s*\)", normalized, flags=re.IGNORECASE):
        raise ValueError("Fixture must define public.users(id INTEGER NOT NULL PRIMARY KEY).")
    if re.search(r"\b(?:name|email|hashed_password|role|is_active|created_at)\b", statements, flags=re.IGNORECASE):
        raise ValueError("Fixture must omit User fields unrelated to the FK dependency.")
    if re.search(r"\bCREATE\s+(?:UNIQUE\s+)?INDEX\b", statements, flags=re.IGNORECASE):
        raise ValueError("Fixture must not add an index redundant with the primary key.")


def validate_tenant_draft(draft: str) -> None:
    """Check the tenant draft's public.users FK count and integer declarations."""
    references = re.findall(r"\bREFERENCES\s+public\.users\s*\(\s*id\s*\)", draft, flags=re.IGNORECASE)
    if len(references) != 4:
        raise ValueError(f"Expected four users(id) references, found {len(references)}.")
    expected_columns = (
        r"\buser_id\s+INTEGER\s+NOT NULL\s+REFERENCES\s+public\.users\s*\(\s*id\s*\)\s+ON DELETE RESTRICT",
        r"\bcreated_by_user_id\s+INTEGER\s+REFERENCES\s+public\.users\s*\(\s*id\s*\)\s+ON DELETE SET NULL",
        r"\bactivated_by_user_id\s+INTEGER\s+REFERENCES\s+public\.users\s*\(\s*id\s*\)\s+ON DELETE SET NULL",
        r"\brevoked_by_user_id\s+INTEGER\s+REFERENCES\s+public\.users\s*\(\s*id\s*\)\s+ON DELETE SET NULL",
    )
    for expression in expected_columns:
        if not re.search(expression, draft, flags=re.IGNORECASE):
            raise ValueError(f"Tenant draft is missing expected integer FK declaration: {expression}")
    if re.search(r"\bINSERT\s+INTO\s+colleges\b|\bUPDATE\s+users\b", draft, flags=re.IGNORECASE):
        raise ValueError("Tenant draft unexpectedly creates a College row or changes User roles/data.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--write", action="store_true", help="write the deterministic fixture file")
    action.add_argument("--check", action="store_true", help="validate an existing fixture without writing")
    parser.add_argument("--output", type=Path, default=DEFAULT_FIXTURE, help="fixture path for --write/--check")
    args = parser.parse_args()

    sql = render_fixture()
    validate_fixture(sql)
    validate_tenant_draft(TENANT_DRAFT.read_text(encoding="utf-8"))

    if args.check:
        current = args.output.read_text(encoding="utf-8")
        if current != sql:
            print(f"Fixture is stale or differs from generated output: {args.output}", file=sys.stderr)
            return 1
        print("PASS: fixture matches offline ORM PostgreSQL compilation; four integer public.users(id) FKs validated.")
        return 0
    if args.write:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(sql, encoding="utf-8", newline="\n")
        print(f"Wrote offline schema-only fixture: {args.output}")
        return 0

    print(sql, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
