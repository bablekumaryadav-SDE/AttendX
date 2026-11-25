"""Database-free contract tests for the draft PostgreSQL tenant foundation."""

import re
import unittest
from pathlib import Path

from app.models import College, CollegeMembership


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
MIGRATION = REPOSITORY_ROOT / "database/migrations/DRAFT_20261105_add_tenant_foundation_postgresql_v2.sql"
FIXTURE = REPOSITORY_ROOT / "database/fixtures/phase13b_tenant_users_schema.sql"


def _without_line_comments(sql: str) -> str:
    return re.sub(r"(?m)^\s*--.*$", "", sql)


class TenantMigrationStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = MIGRATION.read_text(encoding="utf-8")
        cls.sql = _without_line_comments(cls.source)
        cls.normalized = re.sub(r"\s+", " ", cls.sql).strip().lower()

    def test_upgrade_is_explicitly_transactional_and_has_reviewed_downgrade_order(self):
        self.assertTrue(self.normalized.startswith("begin;"))
        self.assertTrue(self.normalized.endswith("commit;"))
        downgrade = re.search(
            r"-- ROLLBACK PLAN.*?-- DROP TABLE public\.college_memberships;.*?-- DROP TABLE public\.colleges;",
            self.source,
            flags=re.IGNORECASE | re.DOTALL,
        )
        self.assertIsNotNone(downgrade)
        self.assertLess(
            downgrade.group(0).lower().index("drop table public.college_memberships"),
            downgrade.group(0).lower().index("drop table public.colleges"),
        )

    def test_legacy_users_schema_is_preflighted_before_any_create(self):
        guard = self.normalized.index("do $tenant_users_preflight$")
        first_create = self.normalized.index("create table public.colleges")
        self.assertLess(guard, first_create)
        preflight = self.normalized[guard:first_create]
        self.assertIn("to_regclass('public.users') is null", preflight)
        self.assertIn("column_info.data_type = 'integer'", preflight)
        self.assertIn("column_info.is_nullable = 'no'", preflight)
        self.assertIn("constraint_info.contype = 'p'", preflight)
        self.assertIn("public.users(id integer primary key)", preflight)

    def test_fixture_and_all_user_foreign_keys_are_explicit_public_integer_parent(self):
        fixture = _without_line_comments(FIXTURE.read_text(encoding="utf-8"))
        self.assertRegex(fixture, r"(?is)create table public\.users\s*\(\s*id integer not null,\s*primary key\s*\(id\)\s*\)")
        self.assertEqual(self.normalized.count("references public.users(id)"), 4)
        for declaration in (
            "user_id integer not null references public.users(id) on delete restrict",
            "created_by_user_id integer references public.users(id) on delete set null",
            "activated_by_user_id integer references public.users(id) on delete set null",
            "revoked_by_user_id integer references public.users(id) on delete set null",
        ):
            self.assertIn(declaration, self.normalized)
        self.assertIn(
            "college_id integer not null references public.colleges(id) on delete restrict",
            self.normalized,
        )

    def test_college_database_checks_and_unique_slug_are_present(self):
        self.assertIn(
            "constraint ck_colleges_slug_format check (slug ~ '^[a-z0-9_-]{1,80}$')",
            self.normalized,
        )
        self.assertIn(
            "constraint ck_colleges_official_name check (length(btrim(official_name)) > 0)",
            self.normalized,
        )
        self.assertIn("constraint ck_colleges_status", self.normalized)
        self.assertIn("create unique index ix_colleges_slug on public.colleges (slug)", self.normalized)
        # Slug/name validation also exists in the ORM, but these database checks
        # intentionally protect direct SQL writes and are not ORM constraints.
        self.assertTrue(College.slug.unique)

    def test_unique_membership_and_role_status_checks_match_metadata(self):
        activation_draft = (Path(__file__).resolve().parents[2] / "database" / "migrations" / "DRAFT_20261112_account_activation_invitations.sql").read_text(encoding="utf-8").lower()
        self.assertIn("unique (user_id, college_id)", self.normalized)
        self.assertIn("role in ('college_admin', 'teacher', 'student')", self.normalized)
        self.assertIn("status in ('pending', 'active', 'suspended', 'revoked')", self.normalized)
        self.assertEqual(
            {constraint.name for constraint in CollegeMembership.__table__.constraints if constraint.name},
            {
                "uq_college_memberships_user_college",
                "uq_college_memberships_id_user_college",
                "ck_college_memberships_status",
                "ck_college_memberships_role",
            },
        )
        self.assertIn(
            "constraint uq_college_memberships_id_user_college unique (id, user_id, college_id)",
            self.normalized,
        )
        activation_normalized = " ".join(activation_draft.split())
        self.assertIn("uq_college_memberships_id_user_college", activation_normalized)
        self.assertIn("constraint_info.contype = 'u'", activation_normalized)
        self.assertIn("constraint_info.conkey = array[", activation_normalized)
        self.assertIn(
            "references public.college_memberships(id, user_id, college_id)",
            activation_normalized,
        )
        self.assertNotIn("add constraint uq_college_memberships_id_user_college", activation_normalized)

    def test_index_definitions_match_metadata_without_redundant_primary_key_indexes(self):
        expected = {
            "create unique index ix_colleges_slug on public.colleges (slug)",
            "create index ix_college_memberships_user_status on public.college_memberships (user_id, status)",
            "create index ix_college_memberships_college_status on public.college_memberships (college_id, status)",
        }
        actual = {
            statement.strip().rstrip(";")
            for statement in self.normalized.split(";")
            if statement.strip().startswith("create ") and " index " in statement
        }
        self.assertEqual(actual, expected)
        self.assertEqual({index.name for index in College.__table__.indexes}, {"ix_colleges_slug"})
        self.assertEqual(
            {index.name for index in CollegeMembership.__table__.indexes},
            {"ix_college_memberships_user_status", "ix_college_memberships_college_status"},
        )

    def test_draft_does_not_seed_or_mutate_legacy_ownership_or_roles(self):
        self.assertNotRegex(self.normalized, r"\binsert\s+into\s+(?:public\.)?colleges\b")
        self.assertNotRegex(self.normalized, r"\bupdate\s+(?:public\.)?users\b")
        self.assertNotRegex(self.normalized, r"\b(?:update|delete)\s+(?:public\.)?(?:students|teachers|attendance|classes|subjects|teacher_assignments)\b")
        self.assertNotIn("super_admin", self.normalized)
        self.assertNotIn("role in ('admin'", self.normalized)

    def test_profile_draft_rejects_incompatible_existing_columns_before_additive_ddl(self):
        profile_draft = (
            REPOSITORY_ROOT / "database/migrations/DRAFT_20261110_add_college_status_history.sql"
        ).read_text(encoding="utf-8")
        normalized = re.sub(r"\s+", " ", _without_line_comments(profile_draft)).strip().lower()
        preflight_end = normalized.index("-- nullable additive profile fields") if "-- nullable additive profile fields" in normalized else normalized.index("alter table public.colleges")
        preflight = normalized[:preflight_end]
        self.assertIn("information_schema.columns", preflight)
        self.assertIn("actual_type <> 'character varying'", preflight)
        self.assertIn("actual_length <> expected_column.character_limit", preflight)
        self.assertIn("actual_nullable <> 'yes'", preflight)
        self.assertIn("raise exception 'existing public.colleges.% column is incompatible", preflight)

    def test_application_workflow_has_explicit_prerequisites_and_transaction(self):
        application_draft = (
            REPOSITORY_ROOT
            / "database/migrations/DRAFT_20261110_add_college_registration_workflow.sql"
        ).read_text(encoding="utf-8")
        normalized = re.sub(r"\s+", " ", _without_line_comments(application_draft)).strip().lower()
        self.assertTrue(normalized.startswith("begin;"))
        self.assertTrue(normalized.endswith("commit;"))
        for prerequisite in ("public.users", "public.colleges", "public.college_memberships"):
            self.assertIn(f"to_regclass('{prerequisite}') is null", normalized)
        self.assertIn("create table public.college_registration_applications", normalized)
        self.assertIn("create table public.college_registration_reviews", normalized)


if __name__ == "__main__":
    unittest.main()
