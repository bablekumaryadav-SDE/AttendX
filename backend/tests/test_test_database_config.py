"""No-connect tests for PostgreSQL integration-test URL selection."""

import unittest
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path

from app.test_database_config import (
    TestDatabaseConfigurationError,
    require_test_database_url,
)


APP_URL = "postgresql+psycopg2://app_role:app-secret@127.0.0.1:5432/attendx"
SAFE_TEST_URL = "postgresql+psycopg2://attendx_test_role:test-secret@localhost:55432/attendx_test"


class TestDatabaseConfigurationTests(unittest.TestCase):
    def _env(self, test_url=SAFE_TEST_URL, app_url=APP_URL):
        values = {}
        if test_url is not None:
            values["ATTENDX_TEST_DATABASE_URL"] = test_url
        if app_url is not None:
            values["DATABASE_URL"] = app_url
        return values

    def test_missing_test_url_never_falls_back_to_application_url(self):
        with self.assertRaises(TestDatabaseConfigurationError) as raised:
            require_test_database_url(self._env(test_url=None), application_env_file=Path("missing.env"))
        self.assertIn("ATTENDX_TEST_DATABASE_URL", str(raised.exception))
        self.assertNotIn("app-secret", str(raised.exception))

    def test_missing_application_identity_fails_closed(self):
        with self.assertRaises(TestDatabaseConfigurationError):
            require_test_database_url(self._env(app_url=None), application_env_file=Path("missing.env"))

    def test_safe_distinct_local_postgresql_test_url_is_returned_without_connecting(self):
        url = require_test_database_url(self._env(), application_env_file=Path("missing.env"))
        self.assertEqual(url.database, "attendx_test")
        self.assertEqual(url.host, "localhost")
        self.assertEqual(url.username, "attendx_test_role")

    def test_same_database_is_rejected_even_with_different_credentials_and_host_alias(self):
        same_target = "postgresql://other_role:other-secret@localhost:5432/attendx"
        with self.assertRaises(TestDatabaseConfigurationError):
            require_test_database_url(self._env(test_url=same_target), application_env_file=Path("missing.env"))

    def test_non_loopback_host_is_rejected(self):
        remote = "postgresql://attendx_test_role:test-secret@db.example.org:5432/attendx_test"
        with self.assertRaises(TestDatabaseConfigurationError):
            require_test_database_url(self._env(test_url=remote), application_env_file=Path("missing.env"))

    def test_production_like_target_name_is_rejected(self):
        production = "postgresql://attendx_test_role:test-secret@localhost:55432/attendx_prod_test"
        with self.assertRaises(TestDatabaseConfigurationError):
            require_test_database_url(self._env(test_url=production), application_env_file=Path("missing.env"))

    def test_same_test_role_as_application_role_is_rejected(self):
        same_role = "postgresql://app_role:test-secret@localhost:55432/attendx_test"
        with self.assertRaises(TestDatabaseConfigurationError):
            require_test_database_url(self._env(test_url=same_role), application_env_file=Path("missing.env"))

    def test_sqlite_target_is_rejected(self):
        with self.assertRaises(TestDatabaseConfigurationError):
            require_test_database_url(
                self._env(test_url="sqlite:///attendx_test.db"),
                application_env_file=Path("missing.env"),
            )

    def test_malformed_url_error_does_not_echo_credentials(self):
        with self.assertRaises(TestDatabaseConfigurationError) as raised:
            require_test_database_url(
                self._env(test_url="postgresql://secret-payload@bad host/db_test"),
                application_env_file=Path("missing.env"),
            )
        self.assertNotIn("secret-payload", str(raised.exception))

    def test_unsafe_target_rejection_does_not_print_credentials(self):
        stdout = StringIO()
        stderr = StringIO()
        unsafe_url = "postgresql://private_user:private_password@db.example.org/attendx_test"
        with redirect_stdout(stdout), redirect_stderr(stderr):
            with self.assertRaises(TestDatabaseConfigurationError):
                require_test_database_url(
                    self._env(test_url=unsafe_url),
                    application_env_file=Path("missing.env"),
                )
        self.assertNotIn("private_user", stdout.getvalue() + stderr.getvalue())
        self.assertNotIn("private_password", stdout.getvalue() + stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
