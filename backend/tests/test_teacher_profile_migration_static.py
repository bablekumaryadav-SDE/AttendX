"""Static contract checks for the first Alembic Teacher verification revision."""

from datetime import datetime
from io import StringIO
from pathlib import Path
import importlib.util
import re
import unittest

from sqlalchemy import CheckConstraint, Column, DateTime, Integer, MetaData, String, Table, UniqueConstraint, create_engine, insert
from sqlalchemy.schema import CreateTable
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.models import TeacherManagementAuditEvent, TeacherProfileVerification


REVISION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261125_01_teacher_profile_verification_and_management_audit.py"
)
SPEC = importlib.util.spec_from_file_location("teacher_profile_verification_migration", REVISION)
MIGRATION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MIGRATION)


class _Result:
    def __init__(self, value):
        self.value = value

    def scalar_one(self):
        return self.value

    def all(self):
        return self.value


class _FakeBind:
    dialect = type("Dialect", (), {"name": "postgresql"})()

    def __init__(self, tables=None, counts=None, function=False, triggers=None, remaining_trigger=False):
        self.tables = tables or {}
        self.counts = counts or {}
        self.function = function
        self.triggers = triggers or []
        self.remaining_trigger = remaining_trigger

    def execute(self, statement, params=None):
        sql = str(statement)
        if "to_regclass(:relation)" in sql:
            return _Result(self.tables.get(params["relation"], False))
        if "SELECT count(*)" in sql:
            table = re.search(r"public\.([a-z_]+)", sql).group(1)
            return _Result(self.counts.get(table, 0))
        if "SELECT tgname" in sql:
            return _Result(self.triggers)
        if "SELECT EXISTS (SELECT 1 FROM pg_trigger" in sql:
            return _Result(self.remaining_trigger)
        if "to_regprocedure" in sql:
            return _Result(self.function)
        raise AssertionError(f"Unexpected simulated downgrade SQL: {sql}")


class _FakeMigrationOps:
    def __init__(self, bind):
        self.bind = bind
        self.executed = []
        self.dropped = []

    def get_bind(self):
        return self.bind

    def execute(self, statement):
        self.executed.append(str(statement))

    def drop_table(self, name, schema=None):
        self.dropped.append((schema, name))


class _CaptureUpgradeOps:
    def __init__(self):
        self.metadata = MetaData()
        Table(
            "teachers", self.metadata,
            Column("id", Integer, primary_key=True), Column("college_id", Integer, nullable=True),
            UniqueConstraint("id", "college_id", name="uq_teachers_id_college"), schema="public",
        )
        Table(
            "college_memberships", self.metadata,
            Column("user_id", Integer, primary_key=True), Column("college_id", Integer, primary_key=True),
            UniqueConstraint("user_id", "college_id", name="uq_college_memberships_user_college"), schema="public",
        )
        self.tables = {}
        self.indexes = {}

    def create_table(self, name, *items, schema=None):
        table = Table(name, self.metadata, *items, schema=schema)
        self.tables[name] = table
        return table

    def create_index(self, name, table_name, columns, schema=None, unique=False):
        self.indexes[name] = (table_name, tuple(columns), schema, unique)

    def execute(self, statement):
        return None


class TeacherProfileMigrationStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = REVISION.read_text(encoding="utf-8")

    def test_revision_is_first_alembic_revision_and_has_upgrade_and_downgrade(self):
        self.assertIn('revision: str = "20261125_01"', self.source)
        self.assertIn("down_revision: Union[str, None] = None", self.source)
        self.assertIn("def upgrade() -> None:", self.source)
        self.assertIn("def downgrade() -> None:", self.source)

    def test_migration_creates_model_tables_constraints_indexes_and_append_only_guards(self):
        for fragment in (
            '"teacher_profile_verifications"',
            '"teacher_management_audit_events"',
            '"uq_teacher_profile_verifications_teacher_college"',
            '"fk_teacher_profile_verifications_teacher_college"',
            '"fk_teacher_profile_verifications_verifier_membership"',
            '"fk_teacher_management_audit_actor_membership"',
            '"fk_teacher_management_audit_related_membership"',
            '"ix_teacher_profile_verifications_college_status"',
            '"ix_teacher_profile_verifications_verifier_membership"',
            '"ix_teacher_profile_verifications_rejector_membership"',
            '"ix_teacher_management_audit_college_teacher_created"',
            '"ix_teacher_management_audit_actor_created"',
            '"ix_teacher_management_audit_related_user_college"',
            "trg_teacher_management_audit_append_only",
            "trg_teacher_management_audit_no_truncate",
            "legacy_reconciliation_completed",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.source)

    def test_preflight_is_fail_closed_and_downgrade_refuses_to_drop_populated_tables(self):
        self.assertIn("def _preflight() -> None:", self.source)
        self.assertIn("Migration prerequisite is missing", self.source)
        self.assertIn("A target Teacher verification/audit table already exists", self.source)
        self.assertIn("Refusing downgrade", self.source)
        self.assertNotIn("INSERT INTO public.teacher_profile_verifications", self.source)
        self.assertIn("n.nspname || '.' || r.relname", self.source)
        self.assertIn('("public.teachers", "uq_teachers_id_college")', self.source)
        self.assertIn('("public.college_memberships", "uq_college_memberships_user_college")', self.source)
        self.assertNotRegex(self.source, r"\b(INSERT INTO|UPDATE public\.(teachers|college_memberships|teacher_account_links)|DELETE FROM)\b")

    def test_verified_and_rejected_reasons_must_be_non_null_and_nonblank(self):
        migration_check = MIGRATION.VERIFICATION_REVIEW_STATE_CHECK
        model_check = next(
            constraint.sqltext
            for constraint in TeacherProfileVerification.__table__.constraints
            if isinstance(constraint, CheckConstraint)
            and constraint.name == "ck_teacher_profile_verifications_review_state"
        )
        normalize = lambda value: " ".join(str(value).split())
        self.assertEqual(normalize(model_check), normalize(migration_check))

        metadata = MetaData()
        verification = Table(
            "verification_state_check",
            metadata,
            Column("id", Integer, primary_key=True),
            Column("verification_status", String(20), nullable=False),
            Column("verified_by_admin_id", Integer),
            Column("verified_at", DateTime),
            Column("rejected_by_admin_id", Integer),
            Column("rejected_at", DateTime),
            Column("verification_reason", String),
            CheckConstraint(migration_check, name="ck_review_state"),
        )
        engine = create_engine("sqlite://")
        metadata.create_all(engine)

        def attempt(row, should_succeed):
            with engine.connect() as connection:
                transaction = connection.begin()
                if should_succeed:
                    connection.execute(insert(verification).values(**row))
                    transaction.commit()
                else:
                    with self.assertRaises(IntegrityError):
                        connection.execute(insert(verification).values(**row))
                    transaction.rollback()

        attempt({"id": 1, "verification_status": "pending"}, True)
        reviewed_at = datetime(2026, 11, 25, 10, 0, 0)
        verified = {"verification_status": "verified", "verified_by_admin_id": 10, "verified_at": reviewed_at, "rejected_by_admin_id": None, "rejected_at": None}
        rejected = {"verification_status": "rejected", "verified_by_admin_id": None, "verified_at": None, "rejected_by_admin_id": 10, "rejected_at": reviewed_at}
        for index, reason in enumerate((None, "", "   "), start=2):
            attempt({"id": index, **verified, "verification_reason": reason}, False)
            attempt({"id": index + 10, **rejected, "verification_reason": reason}, False)
        attempt({"id": 30, **verified, "verification_reason": "Official records reviewed."}, True)
        attempt({"id": 31, **rejected, "verification_reason": "Conflicting official record."}, True)
        engine.dispose()

        pg_table = Table(
            "verification_state_check",
            MetaData(),
            Column("id", Integer, primary_key=True),
            Column("verification_status", String(20), nullable=False),
            Column("verified_by_admin_id", Integer),
            Column("verified_at", DateTime(timezone=True)),
            Column("rejected_by_admin_id", Integer),
            Column("rejected_at", DateTime(timezone=True)),
            Column("verification_reason", String),
            CheckConstraint(migration_check, name="ck_review_state"),
        )
        ddl = str(CreateTable(pg_table).compile(dialect=postgresql.dialect()))
        self.assertIn("verification_reason IS NOT NULL", ddl)
        self.assertIn("length(trim(verification_reason)) > 0", ddl)

    def test_downgrade_is_safe_when_target_tables_are_absent_or_partial(self):
        original_ops = MIGRATION.op
        try:
            ops = _FakeMigrationOps(_FakeBind())
            MIGRATION.op = ops
            MIGRATION.downgrade()
            self.assertEqual(ops.dropped, [])
            self.assertEqual(ops.executed, [])

            ops = _FakeMigrationOps(_FakeBind(tables={"public.teacher_profile_verifications": True}))
            MIGRATION.op = ops
            MIGRATION.downgrade()
            self.assertEqual(ops.dropped, [("public", "teacher_profile_verifications")])
            self.assertEqual(ops.executed, ["LOCK TABLE public.teacher_profile_verifications IN ACCESS EXCLUSIVE MODE"])
        finally:
            MIGRATION.op = original_ops

    def test_downgrade_refuses_populated_audit_or_verification_tables_before_dropping(self):
        original_ops = MIGRATION.op
        try:
            for table in ("teacher_management_audit_events", "teacher_profile_verifications"):
                with self.subTest(table=table):
                    ops = _FakeMigrationOps(_FakeBind(
                        tables={f"public.{table}": True},
                        counts={table: 1},
                    ))
                    MIGRATION.op = ops
                    with self.assertRaisesRegex(RuntimeError, "Refusing downgrade"):
                        MIGRATION.downgrade()
                    self.assertEqual(ops.dropped, [])
                    self.assertFalse(any(statement.startswith("DROP ") for statement in ops.executed))
        finally:
            MIGRATION.op = original_ops

    def test_downgrade_drops_only_expected_audit_guards_and_refuses_foreign_dependencies(self):
        original_ops = MIGRATION.op
        try:
            audit_table = "public.teacher_management_audit_events"
            ops = _FakeMigrationOps(_FakeBind(
                tables={audit_table: True},
                counts={"teacher_management_audit_events": 0},
                function=True,
                triggers=[
                    ("trg_teacher_management_audit_append_only", True),
                    ("trg_teacher_management_audit_no_truncate", True),
                ],
            ))
            MIGRATION.op = ops
            MIGRATION.downgrade()
            self.assertEqual(ops.dropped, [("public", "teacher_management_audit_events")])
            self.assertIn("DROP TRIGGER trg_teacher_management_audit_append_only", " ".join(ops.executed))
            self.assertIn("DROP TRIGGER trg_teacher_management_audit_no_truncate", " ".join(ops.executed))
            self.assertIn("DROP FUNCTION public.reject_teacher_management_audit_mutation()", ops.executed)

            ops = _FakeMigrationOps(_FakeBind(
                tables={audit_table: True},
                counts={"teacher_management_audit_events": 0},
                function=True,
                triggers=[("trg_teacher_management_audit_append_only", False)],
            ))
            MIGRATION.op = ops
            with self.assertRaisesRegex(RuntimeError, "references a different function"):
                MIGRATION.downgrade()
            self.assertEqual(ops.dropped, [])
            self.assertFalse(any(statement.startswith("DROP ") for statement in ops.executed))

            ops = _FakeMigrationOps(_FakeBind(function=True, remaining_trigger=True))
            MIGRATION.op = ops
            with self.assertRaisesRegex(RuntimeError, "still used by another trigger"):
                MIGRATION.downgrade()
            self.assertEqual(ops.dropped, [])
            self.assertEqual(ops.executed, [])
        finally:
            MIGRATION.op = original_ops

    def test_upgrade_emits_postgresql_ddl_for_review_without_a_database_connection(self):
        output = StringIO()
        context = MigrationContext.configure(
            dialect_name="postgresql",
            opts={"as_sql": True, "output_buffer": output, "literal_binds": True},
        )
        original_ops = MIGRATION.op
        original_preflight = MIGRATION._preflight
        try:
            MIGRATION.op = Operations(context)
            MIGRATION._preflight = lambda: None
            MIGRATION.upgrade()
        finally:
            MIGRATION.op = original_ops
            MIGRATION._preflight = original_preflight
        ddl = output.getvalue()
        for fragment in (
            "CREATE TABLE public.teacher_profile_verifications",
            "verification_reason IS NOT NULL",
            "length(trim(verification_reason)) > 0",
            "REFERENCES public.teachers (id, college_id)",
            "REFERENCES public.college_memberships (user_id, college_id)",
            "CREATE TABLE public.teacher_management_audit_events",
            "JSONB",
            "CREATE FUNCTION public.reject_teacher_management_audit_mutation()",
            "CREATE TRIGGER trg_teacher_management_audit_append_only",
            "CREATE TRIGGER trg_teacher_management_audit_no_truncate",
            "CREATE INDEX ix_teacher_profile_verifications_verifier_membership",
            "CREATE INDEX ix_teacher_profile_verifications_rejector_membership",
            "CREATE INDEX ix_teacher_management_audit_related_user_college",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, ddl)

    def test_migration_table_definitions_match_orm_types_nullability_keys_and_indexes(self):
        original_ops = MIGRATION.op
        original_preflight = MIGRATION._preflight
        capture = _CaptureUpgradeOps()
        try:
            MIGRATION.op = capture
            MIGRATION._preflight = lambda: None
            MIGRATION.upgrade()
        finally:
            MIGRATION.op = original_ops
            MIGRATION._preflight = original_preflight

        model_tables = {
            "teacher_profile_verifications": TeacherProfileVerification.__table__,
            "teacher_management_audit_events": TeacherManagementAuditEvent.__table__,
        }
        dialect = postgresql.dialect()
        for name, model_table in model_tables.items():
            with self.subTest(table=name):
                migration_table = capture.tables[name]
                self.assertEqual(list(model_table.columns.keys()), list(migration_table.columns.keys()))
                for column_name, model_column in model_table.columns.items():
                    migration_column = migration_table.columns[column_name]
                    self.assertEqual(model_column.type.compile(dialect=dialect), migration_column.type.compile(dialect=dialect), column_name)
                    self.assertEqual(model_column.nullable, migration_column.nullable, column_name)
                    self.assertEqual(model_column.primary_key, migration_column.primary_key, column_name)

                def foreign_keys(table):
                    return {
                        (constraint.name, tuple(element.parent.name for element in constraint.elements),
                         tuple(element.column.table.name for element in constraint.elements),
                         tuple(element.column.name for element in constraint.elements))
                        for constraint in table.foreign_key_constraints
                    }

                self.assertEqual(foreign_keys(model_table), foreign_keys(migration_table))
                model_named_constraints = {constraint.name for constraint in model_table.constraints if constraint.name}
                migration_named_constraints = {constraint.name for constraint in migration_table.constraints if constraint.name}
                self.assertEqual(model_named_constraints, migration_named_constraints)

        model_indexes = {
            index.name: (index.table.name, tuple(column.name for column in index.columns), index.unique)
            for name, table in model_tables.items()
            for index in table.indexes
        }
        migration_indexes = {
            name: (table_name, columns, unique)
            for name, (table_name, columns, _schema, unique) in capture.indexes.items()
        }
        self.assertEqual(model_indexes, migration_indexes)


if __name__ == "__main__":
    unittest.main()
