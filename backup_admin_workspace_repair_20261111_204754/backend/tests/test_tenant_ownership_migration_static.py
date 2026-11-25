"""Static contract checks for the unexecuted PostgreSQL ownership draft."""

import re
import unittest
from pathlib import Path


MIGRATION = Path(__file__).resolve().parents[2] / "database/migrations/DRAFT_20261109_add_tenant_ownership_v1.sql"


class TenantOwnershipMigrationStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = MIGRATION.read_text(encoding="utf-8")
        cls.sql = re.sub(r"(?m)^\s*--.*$", "", cls.source)
        cls.normalized = re.sub(r"\s+", " ", cls.sql).strip().lower()

    def test_draft_is_transactional_and_preflights_before_any_schema_change(self):
        self.assertTrue(self.normalized.startswith("begin;"))
        self.assertTrue(self.normalized.endswith("commit;"))
        self.assertLess(self.normalized.index("do $tenant_ownership_preflight$"), self.normalized.index("alter table"))
        self.assertIn("to_regclass(format('public.%i', required_table)) is null", self.normalized)
        self.assertIn("c.conkey = array[a.attnum]::smallint[]", self.normalized)
        self.assertIn("already has college_id", self.normalized)
        self.assertIn("$tenant_ownership_preflight$", self.normalized)
        self.assertIn("tenant ownership requires the reviewed public.% unique index", self.normalized)

    def test_ownership_additions_are_nullable_and_never_backfill_legacy_rows(self):
        self.assertEqual(self.normalized.count("add column college_id integer;"), 12)
        self.assertNotRegex(self.normalized, r"\b(insert\s+into|update\s+public\.)\b")
        self.assertNotRegex(self.normalized, r"set\s+college_id\s*=")
        self.assertIn("null means legacy college ownership unknown", self.source.lower())
        self.assertNotIn("default 1", self.normalized)

    def test_composite_same_college_relationships_are_declared(self):
        expected = (
            "foreign key (teacher_id, college_id) references public.teachers(id, college_id)",
            "foreign key (subject_id, college_id) references public.subjects(id, college_id)",
            "foreign key (class_id, college_id) references public.classes(id, college_id)",
            "foreign key (student_id, college_id) references public.students(id, college_id)",
            "foreign key (session_id, college_id) references public.attendance_sessions(id, college_id)",
        )
        for declaration in expected:
            with self.subTest(declaration=declaration):
                self.assertIn(declaration, self.normalized)
        self.assertGreaterEqual(self.normalized.count("not valid"), 20)

    def test_tenant_query_indexes_and_manual_downgrade_are_documented(self):
        for index_name in (
            "ix_students_college_id",
            "ix_teacher_assignments_college_active",
            "ix_attendance_records_college_date",
            "ix_attendance_sessions_college_status_start",
            "ix_notification_events_college_created",
            "ix_attendance_audit_logs_college_created",
        ):
            self.assertIn(index_name, self.normalized)
        self.assertIn("alter table public.attendance_events drop column college_id", self.source.lower())
        self.assertIn("confirming every college_id is null", self.source.lower())
        self.assertIn("never execute automatically", self.source.lower())

    def test_college_local_identifiers_preserve_unknown_legacy_uniqueness(self):
        expected = (
            "drop index if exists public.ix_students_roll_number",
            "uq_students_unknown_roll_number",
            "uq_students_college_roll_number",
            "drop index if exists public.ix_teachers_employee_id",
            "uq_teachers_unknown_employee_id",
            "uq_teachers_college_employee_id",
            "drop index if exists public.ix_subjects_code",
            "uq_subjects_unknown_code",
            "uq_subjects_college_code",
        )
        for fragment in expected:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.normalized)
        self.assertRegex(
            self.source.lower(),
            r"before restoring the former global identifier indexes, verify that no two\s+--\s+colleges share a roll_number, employee_id, or subject code",
        )


if __name__ == "__main__":
    unittest.main()
