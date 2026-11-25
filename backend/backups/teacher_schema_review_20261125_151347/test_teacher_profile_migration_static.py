"""Static contract checks for the first Alembic Teacher verification revision."""

from pathlib import Path
import unittest


REVISION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261125_01_teacher_profile_verification_and_management_audit.py"
)


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
            '"ix_teacher_management_audit_college_teacher_created"',
            '"ix_teacher_management_audit_actor_created"',
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


if __name__ == "__main__":
    unittest.main()
