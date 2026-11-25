"""Add independent Teacher profile verification and management audit history.

Revision ID: 20261125_01
Revises: None
Create Date: 2026-11-25

This is the first Alembic-managed revision for AttendX. Historical dated SQL
scripts remain unmanaged; this does not claim that they were applied by Alembic.
No legacy Teacher ownership or verification rows are backfilled.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20261125_01"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

VERIFICATION_REVIEW_STATE_CHECK = (
    "(verification_status = 'pending' AND verified_by_admin_id IS NULL AND verified_at IS NULL "
    "AND rejected_by_admin_id IS NULL AND rejected_at IS NULL AND verification_reason IS NULL) "
    "OR (verification_status = 'verified' AND verified_by_admin_id IS NOT NULL AND verified_at IS NOT NULL "
    "AND rejected_by_admin_id IS NULL AND rejected_at IS NULL "
    "AND verification_reason IS NOT NULL AND length(trim(verification_reason)) > 0) "
    "OR (verification_status = 'rejected' AND verified_by_admin_id IS NULL AND verified_at IS NULL "
    "AND rejected_by_admin_id IS NOT NULL AND rejected_at IS NOT NULL "
    "AND verification_reason IS NOT NULL AND length(trim(verification_reason)) > 0)"
)


def _preflight() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        raise RuntimeError("Teacher profile verification migration requires PostgreSQL.")

    required_relations = ("public.teachers", "public.college_memberships")
    for relation in required_relations:
        present = bind.execute(sa.text("SELECT to_regclass(:relation) IS NOT NULL"), {"relation": relation}).scalar_one()
        if not present:
            raise RuntimeError(f"Migration prerequisite is missing: {relation}.")

    keys = {
        (row[0], row[1]): " ".join(row[2].split())
        for row in bind.execute(sa.text(
            "SELECT n.nspname || '.' || r.relname, c.conname, pg_get_constraintdef(c.oid) "
            "FROM pg_constraint c "
            "JOIN pg_class r ON r.oid = c.conrelid "
            "JOIN pg_namespace n ON n.oid = r.relnamespace "
            "WHERE c.conrelid IN "
            "('public.teachers'::regclass, 'public.college_memberships'::regclass) "
            "AND c.conname IN ('uq_teachers_id_college', 'uq_college_memberships_user_college') "
            "AND c.contype IN ('u','p')"
        )).all()
    }
    if keys.get(("public.teachers", "uq_teachers_id_college")) != "UNIQUE (id, college_id)":
        raise RuntimeError("Migration prerequisite uq_teachers_id_college is missing or has a different key order.")
    if keys.get(("public.college_memberships", "uq_college_memberships_user_college")) != "UNIQUE (user_id, college_id)":
        raise RuntimeError("Migration prerequisite uq_college_memberships_user_college is missing or has a different key order.")

    fk_columns = bind.execute(sa.text(
        "SELECT table_name, column_name, data_type, is_nullable "
        "FROM information_schema.columns WHERE table_schema='public' AND "
        "((table_name='teachers' AND column_name IN ('id','college_id')) OR "
        "(table_name='college_memberships' AND column_name IN ('user_id','college_id')))"
    )).all()
    actual = {(row.table_name, row.column_name): (row.data_type, row.is_nullable) for row in fk_columns}
    expected = {
        ("teachers", "id"): ("integer", "NO"),
        ("teachers", "college_id"): ("integer", "YES"),
        ("college_memberships", "user_id"): ("integer", "NO"),
        ("college_memberships", "college_id"): ("integer", "NO"),
    }
    if any(actual.get(column) != value for column, value in expected.items()):
        raise RuntimeError("Teacher/College membership FK column types or nullability do not match the migration.")

    existing = bind.execute(sa.text(
        "SELECT to_regclass('public.teacher_profile_verifications') IS NOT NULL, "
        "to_regclass('public.teacher_management_audit_events') IS NOT NULL"
    )).one()
    if existing[0] or existing[1]:
        raise RuntimeError("A target Teacher verification/audit table already exists; reconcile it before applying this revision.")

    partial_index = bind.execute(sa.text(
        "SELECT to_regclass('public.ix_teacher_profile_verifications_college_status') IS NOT NULL "
        "OR to_regclass('public.ix_teacher_profile_verifications_verifier_membership') IS NOT NULL "
        "OR to_regclass('public.ix_teacher_profile_verifications_rejector_membership') IS NOT NULL "
        "OR to_regclass('public.ix_teacher_management_audit_college_teacher_created') IS NOT NULL "
        "OR to_regclass('public.ix_teacher_management_audit_actor_created') IS NOT NULL "
        "OR to_regclass('public.ix_teacher_management_audit_related_user_college') IS NOT NULL"
    )).scalar_one()
    partial_function = bind.execute(sa.text(
        "SELECT to_regprocedure('public.reject_teacher_management_audit_mutation()') IS NOT NULL"
    )).scalar_one()
    partial_trigger = bind.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN "
        "('trg_teacher_management_audit_append_only','trg_teacher_management_audit_no_truncate') "
        "AND NOT tgisinternal)"
    )).scalar_one()
    if partial_index or partial_function or partial_trigger:
        raise RuntimeError("A partial Teacher verification/audit index, function, or trigger exists; reconcile it before applying this revision.")


def upgrade() -> None:
    _preflight()

    op.create_table(
        "teacher_profile_verifications",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("teacher_id", sa.Integer(), nullable=False),
        sa.Column("college_id", sa.Integer(), nullable=False),
        sa.Column("verification_status", sa.String(length=20), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("verified_by_admin_id", sa.Integer(), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejected_by_admin_id", sa.Integer(), nullable=True),
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("verification_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.UniqueConstraint("teacher_id", "college_id", name="uq_teacher_profile_verifications_teacher_college"),
        sa.CheckConstraint(
            "verification_status IN ('pending', 'verified', 'rejected')",
            name="ck_teacher_profile_verifications_status",
        ),
        sa.CheckConstraint(
            VERIFICATION_REVIEW_STATE_CHECK,
            name="ck_teacher_profile_verifications_review_state",
        ),
        sa.ForeignKeyConstraint(
            ["teacher_id", "college_id"], ["public.teachers.id", "public.teachers.college_id"],
            name="fk_teacher_profile_verifications_teacher_college", ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["verified_by_admin_id", "college_id"], ["public.college_memberships.user_id", "public.college_memberships.college_id"],
            name="fk_teacher_profile_verifications_verifier_membership", ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["rejected_by_admin_id", "college_id"], ["public.college_memberships.user_id", "public.college_memberships.college_id"],
            name="fk_teacher_profile_verifications_rejector_membership", ondelete="RESTRICT",
        ),
        schema="public",
    )
    op.create_index(
        "ix_teacher_profile_verifications_college_status",
        "teacher_profile_verifications", ["college_id", "verification_status"], schema="public",
    )
    op.create_index(
        "ix_teacher_profile_verifications_verifier_membership",
        "teacher_profile_verifications", ["verified_by_admin_id", "college_id"], schema="public",
    )
    op.create_index(
        "ix_teacher_profile_verifications_rejector_membership",
        "teacher_profile_verifications", ["rejected_by_admin_id", "college_id"], schema="public",
    )
    op.execute(sa.text(
        "COMMENT ON TABLE public.teacher_profile_verifications IS "
        "'Independent College Admin review state for a Teacher profile; not account-link verification.'"
    ))

    op.create_table(
        "teacher_management_audit_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("college_id", sa.Integer(), nullable=False),
        sa.Column("teacher_id", sa.Integer(), nullable=False),
        sa.Column("related_user_id", sa.Integer(), nullable=True),
        sa.Column("actor_user_id", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(length=80), nullable=False),
        sa.Column("previous_state", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("new_state", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("evidence_reference", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.CheckConstraint(
            "action IN ('ownership_established', 'membership_created', 'membership_repaired', 'account_linked', 'account_unlinked', 'profile_verified', 'profile_rejected', 'teacher_activated', 'teacher_deactivated', 'class_assigned', 'class_assignment_ended', 'subject_assigned', 'subject_assignment_ended', 'legacy_reconciliation_completed')",
            name="ck_teacher_management_audit_action",
        ),
        sa.CheckConstraint("length(trim(reason)) > 0", name="ck_teacher_management_audit_reason_nonempty"),
        sa.ForeignKeyConstraint(
            ["teacher_id", "college_id"], ["public.teachers.id", "public.teachers.college_id"],
            name="fk_teacher_management_audit_teacher_college", ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id", "college_id"], ["public.college_memberships.user_id", "public.college_memberships.college_id"],
            name="fk_teacher_management_audit_actor_membership", ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["related_user_id", "college_id"], ["public.college_memberships.user_id", "public.college_memberships.college_id"],
            name="fk_teacher_management_audit_related_membership", ondelete="RESTRICT",
        ),
        schema="public",
    )
    op.create_index(
        "ix_teacher_management_audit_college_teacher_created",
        "teacher_management_audit_events", ["college_id", "teacher_id", "created_at"], schema="public",
    )
    op.create_index(
        "ix_teacher_management_audit_actor_created",
        "teacher_management_audit_events", ["actor_user_id", "college_id", "created_at"], schema="public",
    )
    op.create_index(
        "ix_teacher_management_audit_related_user_college",
        "teacher_management_audit_events", ["related_user_id", "college_id"], schema="public",
    )
    op.execute(sa.text(
        "COMMENT ON TABLE public.teacher_management_audit_events IS "
        "'Append-only College-scoped audit history for sensitive Teacher management actions.'"
    ))
    op.execute(sa.text("""
        CREATE FUNCTION public.reject_teacher_management_audit_mutation()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'Teacher management audit events are append-only';
        END;
        $$
    """))
    op.execute(sa.text("""
        CREATE TRIGGER trg_teacher_management_audit_append_only
        BEFORE UPDATE OR DELETE ON public.teacher_management_audit_events
        FOR EACH ROW EXECUTE FUNCTION public.reject_teacher_management_audit_mutation()
    """))
    op.execute(sa.text("""
        CREATE TRIGGER trg_teacher_management_audit_no_truncate
        BEFORE TRUNCATE ON public.teacher_management_audit_events
        FOR EACH STATEMENT EXECUTE FUNCTION public.reject_teacher_management_audit_mutation()
    """))


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        raise RuntimeError("Teacher profile verification downgrade requires PostgreSQL.")
    table_exists = {}
    for table in ("teacher_management_audit_events", "teacher_profile_verifications"):
        exists = bind.execute(sa.text("SELECT to_regclass(:relation) IS NOT NULL"), {"relation": f"public.{table}"}).scalar_one()
        table_exists[table] = exists
        if exists:
            # Prevent concurrent inserts between the preservation check and DDL.
            op.execute(sa.text(f"LOCK TABLE public.{table} IN ACCESS EXCLUSIVE MODE"))
            count = bind.execute(sa.text(f"SELECT count(*) FROM public.{table}")).scalar_one()
            if count:
                raise RuntimeError(f"Refusing downgrade: public.{table} contains records; preserve them with a forward repair or restore plan.")

    if table_exists["teacher_management_audit_events"]:
        audit_triggers = bind.execute(sa.text(
            "SELECT tgname, tgfoid = to_regprocedure('public.reject_teacher_management_audit_mutation()') "
            "FROM pg_trigger "
            "WHERE tgrelid = to_regclass('public.teacher_management_audit_events') "
            "AND tgname IN ('trg_teacher_management_audit_no_truncate', 'trg_teacher_management_audit_append_only') "
            "AND NOT tgisinternal"
        )).all()
        if any(not row[1] for row in audit_triggers):
            raise RuntimeError("Refusing downgrade: a migration-owned audit trigger name references a different function.")
        trigger_names = {row[0] for row in audit_triggers}
        if "trg_teacher_management_audit_no_truncate" in trigger_names:
            op.execute(sa.text("DROP TRIGGER trg_teacher_management_audit_no_truncate ON public.teacher_management_audit_events"))
        if "trg_teacher_management_audit_append_only" in trigger_names:
            op.execute(sa.text("DROP TRIGGER trg_teacher_management_audit_append_only ON public.teacher_management_audit_events"))
    function_exists = bind.execute(sa.text(
        "SELECT to_regprocedure('public.reject_teacher_management_audit_mutation()') IS NOT NULL"
    )).scalar_one()
    if function_exists:
        remaining_trigger_dependency = bind.execute(sa.text(
            "SELECT EXISTS (SELECT 1 FROM pg_trigger "
            "WHERE tgfoid = to_regprocedure('public.reject_teacher_management_audit_mutation()') "
            "AND NOT tgisinternal)"
        )).scalar_one()
        if remaining_trigger_dependency:
            raise RuntimeError("Refusing downgrade: the audit trigger function is still used by another trigger.")
        op.execute(sa.text("DROP FUNCTION public.reject_teacher_management_audit_mutation()"))
    if table_exists["teacher_management_audit_events"]:
        op.drop_table("teacher_management_audit_events", schema="public")
    if table_exists["teacher_profile_verifications"]:
        op.drop_table("teacher_profile_verifications", schema="public")
