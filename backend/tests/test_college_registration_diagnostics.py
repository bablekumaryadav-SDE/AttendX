"""Secret-free unit tests for structured registration DB diagnostics."""

import unittest
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy.exc import ProgrammingError

from app.api.college_registration import (
    _REGISTRATION_STAGE_CONTEXT,
    _safe_database_diagnostics,
    _service_unavailable,
)
from app.api.platform_colleges import _db_unavailable
from app.schemas.college_registration import CollegeRegistrationCreate


class CollegeRegistrationDiagnosticTests(unittest.TestCase):
    def _error(self, diagnostic, message="synthetic database error"):
        class OriginalError(Exception):
            sqlstate = "42P01"
            pgcode = None

            def __init__(self, details, text):
                super().__init__(text)
                self.diag = details

        original = OriginalError(diagnostic, message)
        return ProgrammingError("synthetic statement", None, original)

    def test_structured_missing_relation_metadata_is_returned(self):
        error = self._error(SimpleNamespace(
            schema_name="public",
            table_name="college_registration_applications",
            constraint_name=None,
        ))
        self.assertEqual(
            _safe_database_diagnostics(error),
            (
                "ProgrammingError",
                "42P01",
                None,
                "public",
                "college_registration_applications",
                None,
                "schema_missing_table",
            ),
        )

    def test_missing_structured_relation_metadata_is_not_guessed_from_message(self):
        error = self._error(SimpleNamespace(schema_name=None, table_name=None, constraint_name=None))
        self.assertIsNone(_safe_database_diagnostics(error)[4])

    def test_untrusted_identifier_with_newline_is_omitted(self):
        error = self._error(SimpleNamespace(
            schema_name="public\nforged-log-line",
            table_name="table\nforged-log-line",
            constraint_name=None,
        ))
        details = _safe_database_diagnostics(error)
        self.assertIsNone(details[3])
        self.assertIsNone(details[4])
        self.assertIsNone(details[5])

    def test_missing_column_identifier_is_extracted_from_driver_metadata_only(self):
        error = self._error(SimpleNamespace(
            schema_name="public",
            table_name="colleges",
            column_name="gps_accuracy_limit_m",
            constraint_name=None,
        ), message="synthetic error with untrusted values")
        details = _safe_database_diagnostics(error)
        self.assertEqual(details[3:6], ("public", "colleges", "gps_accuracy_limit_m"))
        self.assertNotIn("synthetic error", repr(details))

    def test_platform_college_error_handler_returns_sanitized_503_and_logs_six_fields(self):
        class SessionStub:
            rolled_back = False

            def rollback(self):
                self.rolled_back = True

        db = SessionStub()
        error = self._error(SimpleNamespace(
            schema_name="public",
            table_name="colleges",
            constraint_name=None,
        ))
        with self.assertLogs("app.api.platform_colleges", level="ERROR") as captured:
            with self.assertRaises(HTTPException) as raised:
                _db_unavailable(db, error, stage="college_list_query")
        self.assertTrue(db.rolled_back)
        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(raised.exception.detail, "College management service is unavailable.")
        self.assertIn("relation=colleges", captured.output[0])
        self.assertIn("column=unknown", captured.output[0])
        self.assertIn("stage=college_list_query", captured.output[0])
        self.assertNotIn("synthetic statement", captured.output[0])

    def test_admin_email_is_limited_to_the_existing_user_column_width(self):
        payload = {
            "college_name": "Example College",
            "college_type": "University",
            "address": "123 Sample Avenue",
            "city": "Sample City",
            "state": "Sample State",
            "postal_code": "12345",
            "country": "Exampleland",
            "official_email": "office@example.org",
            "contact_number": "+14155550123",
            "admin_name": "Synthetic Applicant",
            "admin_email": f"{'a' * 144}@x.com",
            "admin_contact_number": "+14155550124",
            "password": "Synthetic!Registration123",
            "password_confirmation": "Synthetic!Registration123",
        }
        parsed = CollegeRegistrationCreate.model_validate(payload)
        self.assertEqual(len(parsed.admin_email), 150)
        payload["admin_email"] = f"{'a' * 145}@x.com"
        with self.assertRaises(ValueError):
            CollegeRegistrationCreate.model_validate(payload)

    def test_duplicate_lookup_failure_has_safe_relation_and_migration_context(self):
        class SessionStub:
            def rollback(self):
                self.rolled_back = True

        self.assertEqual(
            _REGISTRATION_STAGE_CONTEXT["duplicate_application_lookup"],
            (
                "public.college_registration_applications",
                "DRAFT_20261110_add_college_registration_workflow.sql",
            ),
        )
        db = SessionStub()
        failure = self._error(SimpleNamespace(schema_name=None, table_name=None, constraint_name=None))
        with self.assertLogs("app.api.college_registration", level="ERROR") as captured:
            with self.assertRaises(HTTPException) as raised:
                _service_unavailable(db, failure, stage="duplicate_application_lookup")
        self.assertTrue(db.rolled_back)
        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(raised.exception.detail, "College application service is unavailable.")
        self.assertIn("failure_class=schema_missing_table", captured.output[0])
        self.assertIn("expected_relation=public.college_registration_applications", captured.output[0])
        self.assertIn("DRAFT_20261110_add_college_registration_workflow.sql", captured.output[0])
        self.assertNotIn("synthetic statement", captured.output[0])
        self.assertNotIn("synthetic database error", captured.output[0])


if __name__ == "__main__":
    unittest.main()
