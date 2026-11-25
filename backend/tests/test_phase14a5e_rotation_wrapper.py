"""Mock-only tests for the Phase 14A.5E output/commit verifier."""

import builtins
import os
import socket
import subprocess
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from phase14a5e_rotation_wrapper import (  # noqa: E402
    COMMIT_TOKEN,
    NOT_COMMITTED_TOKEN,
    ExecutionResult,
    RotationCommandInput,
    VerificationOutcome,
    verify_rotation_once,
)


SYNTHETIC_ADMIN_VALUE = b"A" * 43
SYNTHETIC_TEST_VALUE = b"B" * 43


class FakeExecutor:
    def __init__(self, result=None, exception=None):
        self.result = result
        self.exception = exception
        self.calls = 0
        self.entries = None

    def execute_once(self, entries):
        self.calls += 1
        self.entries = entries
        if self.exception is not None:
            raise self.exception
        return self.result


def _invoke_without_external_io(executor, request=None):
    """Invoke the pure wrapper with all external execution surfaces forbidden."""
    if request is None:
        request = RotationCommandInput(SYNTHETIC_ADMIN_VALUE, SYNTHETIC_TEST_VALUE)

    forbidden_calls = []

    def forbidden(*_args, **_kwargs):
        forbidden_calls.append(True)
        raise AssertionError("unexpected external I/O")

    with patch.object(subprocess, "Popen", side_effect=forbidden), \
            patch.object(subprocess, "call", side_effect=forbidden), \
            patch.object(subprocess, "run", side_effect=forbidden), \
            patch.object(subprocess, "check_output", side_effect=forbidden), \
            patch.object(socket, "socket", side_effect=forbidden), \
            patch.object(socket, "create_connection", side_effect=forbidden), \
            patch.object(builtins, "open", side_effect=forbidden), \
            patch.object(Path, "open", side_effect=forbidden), \
            patch.object(os, "open", side_effect=forbidden), \
            patch.object(os, "system", side_effect=forbidden):
        outcome = verify_rotation_once(request, executor)
    if forbidden_calls:
        raise AssertionError("wrapper attempted external I/O")
    return outcome


class Phase14A5ERotationWrapperTests(unittest.TestCase):
    def test_both_role_changes_and_commit_marker_return_fixed_success(self):
        fake = FakeExecutor(ExecutionResult(0, COMMIT_TOKEN + b"\n", b""))

        outcome = _invoke_without_external_io(fake)

        self.assertEqual(outcome, VerificationOutcome.COMMIT_VERIFIED)
        self.assertEqual(fake.calls, 1)
        self.assertIsNotNone(fake.entries)
        transaction_entry, verification_entry = fake.entries
        self.assertEqual(transaction_entry.count(b"ALTER ROLE attendx_cluster_admin WITH PASSWORD"), 1)
        self.assertEqual(transaction_entry.count(b"ALTER ROLE attendx_test_role WITH PASSWORD"), 1)
        self.assertLess(
            transaction_entry.index(b"ALTER ROLE attendx_cluster_admin"),
            transaction_entry.index(b"ALTER ROLE attendx_test_role"),
        )
        self.assertLess(
            transaction_entry.index(b"ALTER ROLE attendx_test_role"),
            transaction_entry.index(b"INSERT INTO pg_temp.phase14a5e_tx_marker"),
        )
        self.assertIn(b"pg_current_xact_id()", transaction_entry)
        self.assertIn(b"pg_xact_status(txid) = 'committed'", verification_entry)
        self.assertTrue(transaction_entry.endswith(b";\n\n"))
        self.assertTrue(verification_entry.endswith(b";\n\n"))

    def test_failure_of_first_role_change_never_returns_success(self):
        fake = FakeExecutor(ExecutionResult(0, b"ERROR: simulated first role failure", b""))
        self.assertNotEqual(_invoke_without_external_io(fake), VerificationOutcome.COMMIT_VERIFIED)

    def test_failure_of_second_role_change_never_returns_success(self):
        fake = FakeExecutor(ExecutionResult(0, b"ERROR: simulated second role failure", b""))
        self.assertNotEqual(_invoke_without_external_io(fake), VerificationOutcome.COMMIT_VERIFIED)

    def test_transaction_rollback_returns_non_committed(self):
        fake = FakeExecutor(ExecutionResult(0, NOT_COMMITTED_TOKEN, b""))
        self.assertEqual(_invoke_without_external_io(fake), VerificationOutcome.NOT_COMMITTED)

    def test_missing_commit_marker_is_unknown(self):
        fake = FakeExecutor(ExecutionResult(0, b"", b""))
        self.assertEqual(_invoke_without_external_io(fake), VerificationOutcome.UNKNOWN)

    def test_malformed_commit_marker_is_unknown(self):
        fake = FakeExecutor(ExecutionResult(0, COMMIT_TOKEN + b" unexpected", b""))
        self.assertEqual(_invoke_without_external_io(fake), VerificationOutcome.UNKNOWN)

    def test_duplicate_commit_marker_is_unknown(self):
        fake = FakeExecutor(ExecutionResult(0, COMMIT_TOKEN + b"\n" + COMMIT_TOKEN, b""))
        self.assertEqual(_invoke_without_external_io(fake), VerificationOutcome.UNKNOWN)

    def test_unexpected_process_exit_or_timeout_is_unknown(self):
        for result in (
            ExecutionResult(None, COMMIT_TOKEN, b""),
            ExecutionResult(1, COMMIT_TOKEN, b""),
            ExecutionResult(0, COMMIT_TOKEN, b"", timed_out=True),
        ):
            with self.subTest(exit_code=result.exit_code, timed_out=result.timed_out):
                fake = FakeExecutor(result)
                self.assertEqual(_invoke_without_external_io(fake), VerificationOutcome.UNKNOWN)

    def test_stdout_password_text_is_never_returned_or_printed(self):
        secret = b"synthetic-output-password-value"
        result = ExecutionResult(0, COMMIT_TOKEN + b"\n" + secret, b"")
        fake = FakeExecutor(result)
        stdout = StringIO()
        stderr = StringIO()

        with redirect_stdout(stdout), redirect_stderr(stderr):
            outcome = _invoke_without_external_io(fake)
        observable = stdout.getvalue() + stderr.getvalue() + str(outcome) + repr(result)

        self.assertEqual(outcome, VerificationOutcome.UNKNOWN)
        self.assertTrue(secret.decode("ascii") not in observable, "stdout secret escaped redaction")

    def test_stderr_sql_and_password_text_is_never_returned_or_printed(self):
        secret = b"synthetic-stderr-password-value"
        result = ExecutionResult(0, COMMIT_TOKEN, b"ERROR simulated SQL " + secret)
        fake = FakeExecutor(result)
        stdout = StringIO()
        stderr = StringIO()

        with redirect_stdout(stdout), redirect_stderr(stderr):
            outcome = _invoke_without_external_io(fake)
        observable = stdout.getvalue() + stderr.getvalue() + str(outcome) + repr(result)

        self.assertEqual(outcome, VerificationOutcome.UNKNOWN)
        self.assertTrue(secret.decode("ascii") not in observable, "stderr secret escaped redaction")

    def test_unexpected_output_fails_closed(self):
        fake = FakeExecutor(ExecutionResult(0, b"NOTICE startup text\n" + COMMIT_TOKEN, b""))
        self.assertEqual(_invoke_without_external_io(fake), VerificationOutcome.UNKNOWN)

    def test_ambiguous_outcome_does_not_retry(self):
        fake = FakeExecutor(ExecutionResult(None, COMMIT_TOKEN, b""))

        outcome = _invoke_without_external_io(fake)

        self.assertEqual(outcome, VerificationOutcome.UNKNOWN)
        self.assertEqual(fake.calls, 1)

    def test_executor_exception_is_sanitized_and_not_retried(self):
        secret = "synthetic-exception-password"
        fake = FakeExecutor(exception=RuntimeError(secret))
        stdout = StringIO()
        stderr = StringIO()

        with redirect_stdout(stdout), redirect_stderr(stderr):
            outcome = _invoke_without_external_io(fake)
        observable = stdout.getvalue() + stderr.getvalue() + str(outcome)

        self.assertEqual(outcome, VerificationOutcome.UNKNOWN)
        self.assertEqual(fake.calls, 1)
        self.assertTrue(secret not in observable, "exception text escaped redaction")

    def test_invalid_input_is_rejected_before_executor_call(self):
        fake = FakeExecutor(ExecutionResult(0, COMMIT_TOKEN, b""))
        invalid = RotationCommandInput(b"too-short", SYNTHETIC_TEST_VALUE)

        outcome = _invoke_without_external_io(fake, invalid)

        self.assertEqual(outcome, VerificationOutcome.REJECTED)
        self.assertEqual(fake.calls, 0)


if __name__ == "__main__":
    unittest.main()
