# Phase 14A.5F — Independent Adversarial Review of Rotation Wrapper

**Date:** 2026-11-09
**Scope:** Source and test review plus focused mock-only test execution. No live PostgreSQL, credentials, DPAPI files, database configuration, or application runtime was accessed.
**Final status:** **FAIL** for use as verified rotation wrapper; mock suite passes but the success contract admits fabricated or stale fixed tokens from the injected executor.
**Reviewer independence:** **UNKNOWN.** This is a separate adversarial pass, but it is performed by the same assistant session that previously implemented the wrapper; it cannot provide organizationally independent assurance.

## Files inspected

- `backend/scripts/phase14a5e_rotation_wrapper.py`
- `backend/tests/test_phase14a5e_rotation_wrapper.py`
- `docs/PHASE_14A5E_WRAPPER_IMPLEMENTATION.md`
- `docs/PHASE_14A5E_INDEPENDENT_REVIEW.md` (treated as prior same-agent review, not authority)
- `docs/PHASE_14A5D_VERIFICATION_DESIGN.md`
- `docs/PHASE_14A5A_OFFLINE_ROTATION_EXECUTION_PLAN.md`
- `docs/PHASE_14A5_CREDENTIAL_ROTATION_APPROVAL_PLAN.md`

## Findings

| Severity | Status | Finding |
|---|---|---|
| **HIGH** | FAIL | Success can be produced without executing SQL or verifying a committed transaction. At wrapper lines 146–151, the result is wholly supplied by an injected executor; lines 115–119 accept a constant token. Counterexample: an executor that returns `ExecutionResult(0, COMMIT_TOKEN, b"")` unconditionally yields `COMMIT_VERIFIED`. No provenance, request binding, nonce, or independent evidence ties those bytes to the just-built SQL. |
| **HIGH** | FAIL | A stale/replayed marker is accepted. The marker token is constant (`COMMIT_TOKEN`, line 18), and the verifier checks only equality (lines 115–119). The tests cover duplicate tokens (test lines 119–121) but not a prior invocation's single valid token replayed in the current invocation. The claim that stale markers fail closed is therefore unsupported. |
| **HIGH** | UNKNOWN | The proposed SQL transaction and `pg_xact_status` sequence have no real executor or PostgreSQL validation. A mock can return any result. The documented exact stdout envelope remains an assumption and cannot establish actual output safety or transaction state. |
| **MEDIUM** | PASS WITH LIMITS | The module itself imports no subprocess, socket, logging, environment, or filesystem API and contains no process-launching code (lines 1–13, 122–151). The tests patch common Python process/socket/file APIs (test lines 47–71), and they execute only a `FakeExecutor`. This proves the exercised wrapper path did not call those patched surfaces; it does not prove every possible native/alternate I/O path is impossible, nor constrain a future injected executor. |
| **MEDIUM** | PASS WITH LIMITS | The wrapper returns fixed enums, rejects nonempty stderr and unexpected stdout, and does not format executor exceptions (lines 98–119, 146–150). Tests cover synthetic output/exception redaction (test lines 133–159, 173–185). However the `execute_once` adapter receives password-bearing SQL bytes (wrapper lines 60–74, 147); adapter-side logging, persistence, tracebacks, or repr of the command entries are outside this wrapper's control. |
| **MEDIUM** | PASS WITH LIMITS | The tests cover first/second simulated error text, rollback token, missing/malformed/duplicate markers, abnormal exit/timeout, unexpected output, exception, and no retry (test lines 99–185). Simulated SQL errors are only arbitrary strings; there is no SQL parser, transaction engine, or commit-state oracle. |
| **LOW** | PASS | Password bytes are constrained to a Base64URL-like alphabet before interpolation and both role identifiers are fixed constants (wrapper lines 16, 21, 45–58, 60–65). This reduces SQL injection through these fields, but does not solve secret lifetime or executor-side exposure. |
| **MEDIUM** | PASS WITH LIMITS | No app startup/config imports appear in the wrapper. Placement under `backend/scripts` and focused import in the test supports isolation; no complete repository-wide import/deployment analysis was performed. |

## Test evidence

Executed from `backend` with synthetic dummy input only:

```text
..\.venv\Scripts\python.exe -m unittest discover -s tests -p test_phase14a5e_rotation_wrapper.py -v
```

Result: **14 passed, 0 failed, 0 skipped**. This is mock-only evidence. No real subprocess, PostgreSQL executable, socket connection, database, or credential file was used. The tests' patched APIs and the wrapper's current imports are not a proof against all possible native I/O or future adapter behavior.

Also ran an in-memory counterexample with an injected executor that did no work and returned the fixed token. The wrapper printed `ROTATION_COMMIT_VERIFIED` (no secret was involved). This directly confirms the HIGH finding; it is a mock counterexample, not a PostgreSQL test.

## Required remediation

1. Do not use `COMMIT_VERIFIED` as authorization or evidence in any credential rotation. A–E remain **NOT READY / NOT APPROVED**.
2. Redesign the result protocol so a result is bound to the exact invocation and cannot be satisfied by a constant or replayed marker. Define a fresh unpredictable challenge generated and retained safely for that invocation, and explain how PostgreSQL's output can bind to it without putting secrets in logs. The present review does not establish that such a protocol is feasible with the documented single-user interface.
3. Add adversarial unit tests where the executor performs no work and returns a fixed success token, and where a previous invocation's success response is replayed. Both must fail closed under a corrected design.
4. Review/validate any proposed protocol against official PostgreSQL documentation before writing an executor. A production adapter needs a separate review of bounded capture, output isolation, exception handling, timeout behavior, no retry, and process identity.
5. Obtain an independent reviewer after remediation. The Phase 14A.5E self-review remains unchanged and does not count as independent assurance.

## Unverified assumptions and boundaries

- PostgreSQL 18's real stdout/stderr format for the two-entry single-user sequence is untested.
- Real `-j` transaction behavior, marker visibility, transaction-ID status, and failure behavior were not exercised.
- The injected executor is trusted by the current wrapper despite being an unconstrained protocol boundary.
- No stale/replay resistance exists in the current constant-token protocol.
- No assumptions here establish that role passwords changed or that rotation is safe.
- Phase 14A.5E review was not replaced; this is an additional adversarial review.

## Actions not taken

No PostgreSQL command, SQL, connection, service, port, credential, DPAPI read/decrypt/write, database, backup, restore, migration, `.env`, or application startup operation occurred. No credential rotation was approved or executed. G, canonical DPAPI activation/retirement, and Phase 14A database operations A–D remain out of scope and unapproved.

## Phase 14A.5G architecture addendum (2026-11-09)

The Phase 14A.5F failure remains in force and is not overwritten: a no-op executor can supply the constant token, and replay is accepted. Phase 14A.5G recommends **REPLACE** for operational use, with a trusted launcher/capture boundary and per-invocation evidence binding as design requirements. PostgreSQL 18's single-user output remains undocumented as a stable machine-readable protocol, so this recommendation is not an executable design or evidence of safety. A–E remain **BLOCKED / NOT APPROVED**. See `PHASE_14A5G_VERIFICATION_ARCHITECTURE.md`.
