# Phase 14A.5E — Secret-Safe Wrapper and Mocked Safety Tests

**Date:** 2026-11-09
**Status:** **IMPLEMENTED / MOCK TESTS PASS / REAL POSTGRESQL OUTPUT COMPATIBILITY UNKNOWN.** This phase does not authorize or perform A–E credential rotation.

## Files

- `backend/scripts/phase14a5e_rotation_wrapper.py` — isolated in-memory command builder and one-shot result verifier. It is not imported by application startup and contains no PostgreSQL, subprocess, socket, environment, logging, or filesystem adapter.
- `backend/tests/test_phase14a5e_rotation_wrapper.py` — 14 tests using a fake executor and synthetic password-like strings only.

## Wrapper contract

`RotationCommandInput` accepts two distinct, already-generated ASCII Base64URL values in the documented 32-byte-output form (43 unpadded characters or 43 characters plus one `=`). It builds two in-memory entries: one `-j` transaction entry that includes both role changes and the transaction-XID marker; and a following `pg_xact_status()` query entry. `verify_rotation_once` validates inputs, calls the injected `execute_once` adapter once, and returns only one of four fixed enum values: `ROTATION_COMMIT_VERIFIED`, `ROTATION_NOT_COMMITTED`, `ROTATION_REQUEST_REJECTED`, or `ROTATION_OUTCOME_UNKNOWN`.

The verifier accepts success only when the result has exit code zero, no timeout/truncation, empty stderr, and stdout consisting solely of the exact fixed commit token with at most one line ending. It accepts the fixed not-committed token under the same conditions. Missing, duplicate, malformed, oversized, or otherwise unexpected output returns UNKNOWN. Process exit status alone never yields success. Exceptions are not formatted, chained, printed, or returned.

The wrapper itself performs no I/O. The executor is an injected interface; **no production executor is included**. An adapter must capture into bounded memory, avoid console/log/file output, and never retry. Mock tests cannot establish that a future adapter meets those requirements.

## Mocked test results

Command:

```text
..\.venv\Scripts\python.exe -m unittest discover -s tests -p test_phase14a5e_rotation_wrapper.py -v
```

Result: **14 tests passed, 0 failed, 0 skipped**. Coverage includes valid two-role/commit marker input; simulated first- and second-role errors; rollback; absent, malformed, and duplicate markers; abnormal exit/timeout; simulated secrets in stdout, stderr, and exceptions; unexpected output; one-shot/no-retry behavior; invalid input rejection; and blocking subprocess, socket, and file I/O surfaces during every wrapper invocation.

These are mock-only verifier tests. They do not execute SQL, validate PostgreSQL parsing, validate PostgreSQL’s actual single-user stdout/stderr format, test transaction behavior against a server, or verify SCRAM authentication.

## Limitations and approval boundaries

- **UNKNOWN:** PostgreSQL 18 documents single-user query output as developer-oriented, not as a stable marker-only envelope. The exact-envelope parser intentionally fails closed on any additional bytes. No real PostgreSQL output was observed, so compatibility is unknown and a real executor cannot be approved from these tests.
- **UNKNOWN:** The injected executor could persist or expose raw output if implemented incorrectly. The wrapper cannot enforce behavior inside an adapter it does not contain.
- **NOT TESTED:** End-to-end SQL-to-marker behavior, logging overrides, process creation, timeout/pipe handling, real commit status, post-restart identity, and SCRAM authentication.
- **NOT AUTHORIZED:** A–E rotation, G authentication, canonical DPAPI activation/retirement, and Phase 14A database operations A–D remain separate approval gates. No real or historical credential was used.

No PostgreSQL process, database, port, Windows service, credential, DPAPI file, or application configuration was accessed or changed. No dependency was installed and no build was run.
