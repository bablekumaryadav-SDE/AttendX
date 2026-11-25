"""Static contract checks only; this module never opens a database connection."""

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "database" / "migrations" / "DRAFT_20261114_06_notification_events_college_scope.sql"
MODELS = ROOT / "backend" / "app" / "models.py"


class NotificationCollegeScopeMigrationStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8")
        cls.models = MODELS.read_text(encoding="utf-8")

    def test_migration_is_explicitly_draft_and_transaction_fenced(self):
        self.assertRegex(self.sql.splitlines()[0], r"^-- STATUS: DRAFT / NOT APPLIED\.")
        self.assertRegex(self.sql, r"(?m)^BEGIN;\s*$")
        self.assertRegex(self.sql, r"(?m)^COMMIT;\s*$")
        self.assertIn("existing public.notification_events table", self.sql)
        self.assertIn("tenant-ownership migration", self.sql)
        self.assertIn("requires nullable INTEGER college_id from tenant ownership", self.sql)
        self.assertIn("idempotency or delivery-status constraint is missing/incompatible", self.sql)
        self.assertIn("foreign keys are missing or have unsafe delete actions", self.sql)

    def test_historical_rows_are_not_backfilled_and_coursework_requires_college(self):
        self.assertNotRegex(self.sql, r"(?im)^\s*ADD COLUMN college_id\s+INTEGER")
        self.assertIn("Historical rows retain NULL ownership", self.sql)
        self.assertIn("NOT VALID", self.sql)
        self.assertRegex(
            self.sql,
            r"CHECK\s*\(substr\(event_type,\s*1,\s*11\)\s*<>\s*'coursework_'\s*OR\s*college_id\s+IS\s+NOT\s+NULL\)",
        )
        self.assertIn("ADD CONSTRAINT ck_notification_events_coursework_requires_college", self.sql)
        self.assertNotRegex(self.sql, r"(?im)^\s*(INSERT\s+INTO|UPDATE\s+public\.notification_events|DELETE\s+FROM)")

    def test_same_college_constraints_and_required_indexes_are_declared(self):
        for fragment in (
            "uq_notification_events_id_college",
            "constraint_row.confrelid = 'public.colleges'::regclass",
            "constraint_row.confrelid = 'public.students'::regclass",
            "constraint_row.confdeltype = 'r'",
            "constraint_row.conkey = ARRAY[local_student.attnum, local_college.attnum]::smallint[]",
            "ix_notification_events_college_created",
            "index_info.indkey[0] = college_attribute.attnum",
            "index_info.indkey[1] = created_attribute.attnum",
        ):
            self.assertIn(fragment, self.sql)
        self.assertNotRegex(self.sql, r"(?im)^\s*ADD CONSTRAINT\s+fk_notification_events_(college|student_college)")
        self.assertNotRegex(self.sql, r"(?im)^\s*ADD CONSTRAINT\s+uq_notification_events_id_college")

    def test_orm_declares_matching_tenant_constraints(self):
        self.assertIn('UniqueConstraint("id", "college_id", name="uq_notification_events_id_college")', self.models)
        self.assertIn('name="fk_notification_events_student_college"', self.models)
        self.assertIn('name="ck_notification_events_coursework_requires_college"', self.models)
        self.assertIn('name="ck_notification_events_delivery_status"', self.models)
        self.assertIn("substr(event_type, 1, 11) <> 'coursework_' OR college_id IS NOT NULL", self.models)
        self.assertIn('Index("ix_notification_events_college_created", "college_id", "created_at")', self.models)


if __name__ == "__main__":
    unittest.main()
