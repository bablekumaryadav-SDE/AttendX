# Phase 14A.5D — Credential Rotation Verification Design

**Date:** 2026-11-09
**Scope:** Official PostgreSQL 18 documentation research and documentation changes only. No PostgreSQL process, database, role, credential, DPAPI file, port, or Windows service was accessed. No A–E execution or test was performed.

## Decision

**PASS (design, documentation-supported); NOT TESTED (implementation).** PostgreSQL 18 documents a way to establish whether the single-user command-entry transaction containing both role changes committed: record its transaction ID in a temporary marker during that same entry, then use `pg_xact_status()` in the next entry and emit a fixed, non-secret success token only for `committed`. This distinguishes transaction completion from process exit and avoids outputting an XID, password, or verifier. It proves the reviewed SQL entry committed; it does not prove a subsequent SCRAM authentication will work. Authentication/usability remains the separate G gate. No approval or execution is given here.

## Documents reviewed

- `docs/PHASE_14A5A_OFFLINE_ROTATION_EXECUTION_PLAN.md`
- `docs/PHASE_14A5B_INDEPENDENT_SAFETY_REVIEW.md`
- `docs/PHASE_14A5_CREDENTIAL_ROTATION_APPROVAL_PLAN.md`
- `docs/TEST_RESULTS.md`
- `docs/FINAL_ACCEPTANCE_REPORT.md`

## PostgreSQL 18 sources

1. [`postgres` — Options for Single-User Mode and Single-User Mode](https://www.postgresql.org/docs/18/app-postgres.html#APP-POSTGRES-SINGLE-USER): `--single` first, database name last; `-E` echoes commands; `-j` terminator is semicolon plus two newlines; multiple statements in a command entry execute as one transaction; query results are printed in developer-oriented form. It does not document an SQL-error/commit exit-status contract.
2. [`ALTER ROLE` — Notes](https://www.postgresql.org/docs/18/sql-alterrole.html#SQL-ALTERROLE-NOTES): unmentioned attributes retain prior values; memberships are managed separately; cleartext password text may be logged in client history or server logs.
3. [`BEGIN`](https://www.postgresql.org/docs/18/sql-begin.html#SQL-BEGIN-DESCRIPTION), [`COMMIT`](https://www.postgresql.org/docs/18/sql-commit.html#SQL-COMMIT-DESCRIPTION), [`ROLLBACK`](https://www.postgresql.org/docs/18/sql-rollback.html#SQL-ROLLBACK-DESCRIPTION), and [Tutorial: Transactions](https://www.postgresql.org/docs/18/tutorial-transactions.html): transactions are all-or-nothing; successful commit makes changes visible and durable; a failed transaction does not partially apply its steps.
4. [System Information Functions, §9.27.8](https://www.postgresql.org/docs/18/functions-info.html#FUNCTIONS-PG-SNAPSHOT): `pg_current_xact_id()` returns the current transaction ID; `pg_xact_status(xid8)` reports `in progress`, `committed`, `aborted`, or `NULL` when status is no longer retained. The docs describe use to determine outcome after a connection is lost during commit.
5. [`CREATE TABLE` — Temporary Tables](https://www.postgresql.org/docs/18/sql-createtable.html#SQL-CREATETABLE-PARAMETERS): temporary tables are automatically dropped at session end; `ON COMMIT PRESERVE ROWS` keeps the marker across command-entry transactions.
6. [Error Reporting and Logging, §19.8.2–19.8.3](https://www.postgresql.org/docs/18/runtime-config-logging.html#RUNTIME-CONFIG-LOGGING-WHAT): `log_min_error_statement` records the statement causing an error at its configured threshold; `log_statement` can log DDL; documentation warns logged statements might reveal plaintext passwords. `TERSE` reduces logged details but is not itself a complete no-leak guarantee.
7. [Frontend/Backend Protocol, §54.7: `CommandComplete` and `ErrorResponse`](https://www.postgresql.org/docs/18/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COMMANDCOMPLETE): these are frontend/backend protocol messages. They cannot be assumed for standalone single-user shell operation.

## Candidate verification sequence (design only; not executed)

1. A separately reviewed in-memory wrapper constructs one exact `-j` command entry and validates that its reviewed template contains exactly one `ALTER ROLE` for each literal target `attendx_cluster_admin` and `attendx_test_role`. The secret-bearing input is never emitted or persisted.
2. In that same entry, create a uniquely named temporary table with one `xid8` column and `ON COMMIT PRESERVE ROWS`; perform both `ALTER ROLE ... PASSWORD` statements using their separate in-memory values; insert `pg_current_xact_id()` into the marker; then terminate the entry with `;\n\n`. Do not split the role changes across entries or insert an early commit/savepoint. Because marker creation, both role changes, and XID insertion belong to one transaction, a statement failure rolls the whole entry back; it cannot commit only one role change.
3. In a second entry in the same single-user session, query the temporary marker and `pg_xact_status(xid)`. Return a unique fixed literal such as `ATTENDX_ROTATION_TX_COMMITTED_V1` only when there is exactly one marker row and its XID status equals `committed`. The XID stays inside the temporary table. Missing table/row, `aborted`, `in progress`, `NULL`, SQL error, timeout, output truncation, or ambiguity yields no success token and must be reported as UNKNOWN/FAIL CLOSED.
4. The wrapper runs the child without an inherited interactive console; captures both stdout and stderr only through anonymous in-memory pipes; omits `-E` and `-r`; and uses startup overrides `log_statement=none`, `log_min_error_statement=PANIC`, and `log_destination=stderr`. It scans the raw in-memory streams only for the exact fixed token, emits a generic status, and discards all raw output and exception text. It must not use shell transcript/history or file redirection. Any nonzero process exit, absent/duplicate token, capture failure, or other ambiguity is not success. This capture/override implementation requires independent code review before execution approval.
5. The temporary marker table and row disappear when the single-user session ends. It is transient verification metadata, not a persistent application table. Any future A–E approval must explicitly include this marker and logging/capture behavior.

This design uses PostgreSQL's documented transaction ID/status functions and transaction atomicity, not process exit status or an assumed `ALTER ROLE` display tag. A successful committed `ALTER ROLE` entry means the SQL changes were applied as a unit. It does not constitute an authentication exchange; G remains necessary to verify that the new credentials work through SCRAM.

## Distinguishing evidence claims

| Layer | What it establishes | Limitation |
|---|---|---|
| Process exit status | The OS process ended with a status. | Not proof that either SQL statement ran or committed. Never sufficient alone. |
| SQL processing | Reviewed wrapper template provides both role statements in the same entry; transaction errors prevent commit. A later marker query returns a fixed token only for a committed XID. | Wrapper construction and memory-only output handling need independent code review. |
| Transaction commit | The marker row stores that transaction's XID; subsequent documented `pg_xact_status()` reports committed. | If token/capture is ambiguous, outcome remains UNKNOWN. No fallback to exit code. |
| Stored credential state | A committed `ALTER ROLE ... PASSWORD` operation applies both supplied values atomically. | Does not independently verify SCRAM authentication. G does that later with separate approval. No verifier is displayed or retained. |

## Error, logging, and partial execution findings

- With both changes in one `-j` entry, documented all-or-nothing semantics mean an SQL error should not leave a durable one-role-only state. If split across entries, partial rotation is possible and prohibited.
- The transaction marker distinguishes committed from aborted/incomplete without printing the XID. A crash or missing marker output is UNKNOWN; the operator does not assume either credential state.
- `-E` must not be used. `ALTER ROLE` documentation warns password text can be logged; logging defaults may record error-causing statements. The plan therefore requires startup logging overrides and in-memory pipe capture. Because diagnostics could still contain sensitive context, raw streams must never be surfaced or retained; the implementation needs independent review. If output isolation cannot be guaranteed, stop before rotation.
- The fixed token is safe to retain with timestamp and non-secret cluster identity. Do not retain SQL, secrets, verifiers/hashes, raw stdout/stderr, exception text, or server logs.
- The documented stored password catalog is `pg_authid`; no verifier is queried or printed in this design. Actual login success remains outside A–E.

## Results and approval boundary

- Research questions 1 and 3: **PASS (design)** for a transaction completion signal using the marker and `pg_xact_status()`; **NOT TESTED** at implementation level.
- Question 2: **PASS**; process exit, statement processing, transaction commit, and SCRAM authentication are distinct claims.
- Question 4: **PASS (conditional)**; same-entry transaction is atomic; separate entries may partially commit.
- Question 5: **PASS (design)**; retain only a fixed status and non-secret metadata; never persist raw output.
- A–E: **DESIGN PASS / NOT EXECUTED / NOT APPROVED.** Before a new exact approval request, independently review the wrapper's exact transaction construction/output capture and repeat the fresh cluster preflight. This phase does not request approval.
- G authentication remains a later separate approval. Canonical DPAPI activation/compromised-file retirement remain another approval after G. Phase 14A database A–D remain unapproved/out of scope.

No credentials, DPAPI contents, PostgreSQL process, database, port, or service were accessed. No verification method was executed.

## Phase 14A.5E implementation addendum (2026-11-09)

The isolated wrapper and mock-only tests are recorded in `PHASE_14A5E_WRAPPER_IMPLEMENTATION.md`. The verifier accepts only an exact marker-only stdout result and empty stderr; it rejects any extra bytes. This is fail-closed, but **actual PostgreSQL 18 single-user stdout/stderr compatibility is UNKNOWN** because PostgreSQL documents developer-oriented output, not the exact marker-only envelope. No production executor/output adapter was implemented or tested. The original candidate sequence must not be treated as an operationally validated capture procedure. A–E remain **NOT READY / NOT APPROVED** pending an independently reviewed safe output adapter and fresh identity preflight.
