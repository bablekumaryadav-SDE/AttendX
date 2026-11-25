"""Mock-oriented, fail-closed verifier for the Phase 14A.5 rotation protocol.

This module has no PostgreSQL, subprocess, socket, environment, logging, or
filesystem adapter. An executor is injected by the caller. This phase provides
no production executor; tests use an in-memory fake only.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import Protocol


EXPECTED_ROLE_NAMES = ("attendx_cluster_admin", "attendx_test_role")
MARKER_TABLE = "phase14a5e_tx_marker"
COMMIT_TOKEN = b"ATTENDX_ROTATION_TX_COMMITTED_V1"
NOT_COMMITTED_TOKEN = b"ATTENDX_ROTATION_TX_NOT_COMMITTED_V1"
MAX_CAPTURE_BYTES = 64 * 1024
_PASSWORD_RE = re.compile(rb"^[A-Za-z0-9_-]{43}=?$")


class VerificationOutcome(str, Enum):
    """Fixed, non-secret statuses suitable for reporting."""

    COMMIT_VERIFIED = "ROTATION_COMMIT_VERIFIED"
    NOT_COMMITTED = "ROTATION_NOT_COMMITTED"
    REJECTED = "ROTATION_REQUEST_REJECTED"
    UNKNOWN = "ROTATION_OUTCOME_UNKNOWN"


@dataclass(frozen=True, slots=True, repr=False)
class RotationCommandInput:
    """In-memory command entries; never persist or display this object."""

    cluster_admin_password: bytes
    test_role_password: bytes

    def __repr__(self) -> str:
        return "RotationCommandInput(<redacted>)"

    def entries(self) -> tuple[bytes, bytes]:
        """Build the documented transaction and following status-query entries."""
        if type(self.cluster_admin_password) is not bytes or type(self.test_role_password) is not bytes:
            raise ValueError("invalid rotation input")
        if not _PASSWORD_RE.fullmatch(self.cluster_admin_password):
            raise ValueError("invalid rotation input")
        if not _PASSWORD_RE.fullmatch(self.test_role_password):
            raise ValueError("invalid rotation input")
        if self.cluster_admin_password == self.test_role_password:
            raise ValueError("invalid rotation input")

        try:
            admin = self.cluster_admin_password.decode("ascii")
            test_role = self.test_role_password.decode("ascii")
        except UnicodeDecodeError:
            raise ValueError("invalid rotation input") from None

        first = (
            "SET password_encryption = 'scram-sha-256';\n"
            f"CREATE TEMP TABLE {MARKER_TABLE} (txid xid8 NOT NULL) ON COMMIT PRESERVE ROWS;\n"
            f"ALTER ROLE {EXPECTED_ROLE_NAMES[0]} WITH PASSWORD '{admin}';\n"
            f"ALTER ROLE {EXPECTED_ROLE_NAMES[1]} WITH PASSWORD '{test_role}';\n"
            f"INSERT INTO pg_temp.{MARKER_TABLE} VALUES (pg_current_xact_id());\n\n"
        ).encode("ascii")
        second = (
            "SELECT CASE WHEN COUNT(*) = 1 AND COALESCE("
            "bool_and(pg_xact_status(txid) = 'committed'), false) "
            f"THEN '{COMMIT_TOKEN.decode('ascii')}' "
            f"ELSE '{NOT_COMMITTED_TOKEN.decode('ascii')}' END "
            f"FROM pg_temp.{MARKER_TABLE};\n\n"
        ).encode("ascii")
        return first, second


@dataclass(frozen=True, slots=True, repr=False)
class ExecutionResult:
    """Raw captured process result, held only in memory and always redacted."""

    exit_code: int | None
    stdout: bytes
    stderr: bytes
    timed_out: bool = False
    truncated: bool = False

    def __repr__(self) -> str:
        return "ExecutionResult(<redacted>)"


class SingleShotExecutor(Protocol):
    """Injected adapter contract. Implementations must execute at most once."""

    def execute_once(self, command_entries: tuple[bytes, bytes], /) -> ExecutionResult:
        """Return captured bytes without printing or persisting them."""


def _verify_result(result: object) -> VerificationOutcome:
    """Accept only the exact marker-only envelope; never return captured data."""
    if type(result) is not ExecutionResult:
        return VerificationOutcome.UNKNOWN
    if type(result.exit_code) is not int or result.exit_code != 0:
        return VerificationOutcome.UNKNOWN
    if type(result.timed_out) is not bool or result.timed_out:
        return VerificationOutcome.UNKNOWN
    if type(result.truncated) is not bool or result.truncated:
        return VerificationOutcome.UNKNOWN
    if type(result.stdout) is not bytes or type(result.stderr) is not bytes:
        return VerificationOutcome.UNKNOWN
    if len(result.stdout) > MAX_CAPTURE_BYTES or len(result.stderr) > MAX_CAPTURE_BYTES:
        return VerificationOutcome.UNKNOWN
    if result.stderr:
        return VerificationOutcome.UNKNOWN

    if result.stdout in (COMMIT_TOKEN, COMMIT_TOKEN + b"\n", COMMIT_TOKEN + b"\r\n"):
        return VerificationOutcome.COMMIT_VERIFIED
    if result.stdout in (NOT_COMMITTED_TOKEN, NOT_COMMITTED_TOKEN + b"\n", NOT_COMMITTED_TOKEN + b"\r\n"):
        return VerificationOutcome.NOT_COMMITTED
    return VerificationOutcome.UNKNOWN


def verify_rotation_once(
    command_input: RotationCommandInput,
    executor: SingleShotExecutor,
) -> VerificationOutcome:
    """Submit one in-memory request to an injected executor and verify its result.

    The executor is called once only. Exceptions and raw process output are
    deliberately discarded. This function does not construct a process,
    connect to PostgreSQL, or perform any filesystem operation.
    """
    if type(command_input) is not RotationCommandInput:
        return VerificationOutcome.REJECTED
    try:
        execute_once = getattr(executor, "execute_once", None)
    except BaseException:
        return VerificationOutcome.REJECTED
    if not callable(execute_once):
        return VerificationOutcome.REJECTED

    try:
        command_entries = command_input.entries()
    except BaseException:
        return VerificationOutcome.REJECTED

    try:
        result = execute_once(command_entries)
    except BaseException:
        # Never format or chain the exception: it may contain command input.
        return VerificationOutcome.UNKNOWN
    return _verify_result(result)
