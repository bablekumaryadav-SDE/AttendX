# Phase 14A.5H — Alternative PostgreSQL Credential-Rotation Verification Research

**Date:** 2026-11-09
**Scope:** Official PostgreSQL 18 documentation research and documentation update only. No PostgreSQL command, SQL, connection, wrapper/test, credential, DPAPI file, service, or port was accessed.
**Conclusion:** **INCONCLUSIVE** for this cluster's usable rotation path. PostgreSQL documents an authenticated-client candidate with stronger transaction/outcome evidence than single-user stdout, but it requires a valid, uncompromised cluster-administrator credential and a separately approved authenticated connection. The available project record does not establish such a credential. No secret rotation method is approved here.

## Research findings

### 1. Authenticated SQL client: documented candidate, conditional on a trusted login

PostgreSQL supports changing role passwords with `ALTER ROLE`; a database superuser can change another role's password. `ALTER ROLE` changes only attributes specified in its statement, so a password-only statement leaves other role attributes as-is. However, PostgreSQL warns that a cleartext password in `ALTER ROLE` can appear in client history or the server log. See [PostgreSQL 18 `ALTER ROLE`](https://www.postgresql.org/docs/18/sql-alterrole.html), Notes and Description.

`psql` documents `\\password [username]`: it prompts for a password, encrypts it client-side, then sends an `ALTER ROLE` statement, and states this avoids the new password appearing in cleartext in command history, server log, or elsewhere. This is preferable to placing a cleartext password in SQL text, command arguments, or a shell here-string. It does not establish that the generated SCRAM verifier can never be logged, captured in memory, included in a crash dump, or exposed by an unreviewed client/OS diagnostic path. See [PostgreSQL 18 `psql`, `\\password`](https://www.postgresql.org/docs/18/app-psql.html#APP-PSQL-META-COMMAND-PASSWORD).

Two changes can be sent in one explicit transaction through a single authenticated client session. `psql --single-transaction` (`-1`) wraps `-c`/`-f` commands in `BEGIN` and `COMMIT`, and sends `ROLLBACK` if a command fails when `ON_ERROR_STOP` is set. The docs also state that individual `-c` strings are server requests and several statements in one request run as one transaction unless explicit transaction commands divide them. The documented `\\password` is a psql meta-command, not a server SQL command string; the manual does not give a ready-made example that combines two interactive `\\password` prompts with an explicit transaction. Therefore, whether/how to combine both `\\password` commands in one reviewed transaction must be confirmed in a disposable approved test before relying on it. Do not assume that `-1` can simply combine SQL and psql meta-commands: `-c` requires either server-parsable SQL or a single backslash command. See [PostgreSQL 18 `psql`, `-c` and `-1`](https://www.postgresql.org/docs/18/app-psql.html#APP-PSQL-OPTIONS).

**Assessment:** A controlled local client path is technically supported when an uncompromised superuser can authenticate, the server identity is verified, and transaction framing for secure password entry is validated. It is not an authentication bypass and does not solve the present absence of a documented safe administrator login. Do not use the exposed old credentials to make this alternative available.

### 2. Transaction identity and outcome after disconnect

PostgreSQL documents `pg_current_xact_id()` as returning the current transaction's 64-bit `xid8`; unlike 32-bit `xid`, `xid8` includes the epoch and does not wrap during an installation's lifetime. `pg_xact_status(xid8)` reports `in progress`, `committed`, or `aborted` while the status is retained, and can return `NULL` once the status has been discarded. PostgreSQL specifically gives the example of resolving a transaction after a disconnect while `COMMIT` is in progress. See [PostgreSQL 18 system information functions, §9.27.2](https://www.postgresql.org/docs/18/functions-info.html#FUNCTIONS-PG-SNAPSHOT) and [transaction IDs, §67.1](https://www.postgresql.org/docs/18/transaction-id.html).

A client can obtain the XID during the same explicit transaction and retain that non-secret XID in protected operation metadata. After a lost COMMIT response, a **new authenticated connection to the independently verified same cluster** can query `pg_xact_status(xid)`. A returned `committed` is evidence for that transaction; `aborted` establishes rollback; `in progress` is unresolved and should not trigger a retry; `NULL`, missing/never-received XID, wrong-server identity, or query failure is UNKNOWN. The query does not require reading `pg_authid` or any password verifier.

This mechanism is only useful if (a) the XID is received before the connection is lost, (b) the XID is correctly associated with the exact transaction and target server, and (c) some valid credential remains available for the follow-up read-only connection. A lost connection before the XID is received may leave no independently queryable identifier. If both roles' credentials were changed and no other trusted administrator identity exists, reconnecting to inspect status may itself be blocked until a new credential can authenticate. That dependency is unresolved for the current environment.

### 3. Connection loss and atomicity

If both role changes are processed in one explicit transaction and `COMMIT` completes, PostgreSQL's `COMMIT` documentation says all changes become visible and are guaranteed durable if a crash occurs. If the session ends before commit, the transaction is rolled back when server-side session termination is processed. If the client loses the connection after sending COMMIT but before receiving its result, the client cannot infer the outcome from its own exit status; the transaction status query above is the documented reconciliation mechanism when the XID and a valid follow-up connection are available. See [PostgreSQL 18 `COMMIT`](https://www.postgresql.org/docs/18/sql-commit.html) and [transaction status functions](https://www.postgresql.org/docs/18/functions-info.html#FUNCTIONS-PG-SNAPSHOT).

Do not automatically repeat a password-changing transaction after an unknown outcome. `in progress` is not equivalent to aborted. If the outcome cannot be queried, stop with UNKNOWN and use a separately approved recovery plan that does not assume either role's password state.

### 4. Server-side password state and SCRAM verification

Transaction status establishes transaction commit/abort, not the exact stored password verifier and not successful authentication. PostgreSQL stores role passwords in `pg_authid`; this plan should not select, log, or report that catalog field. `\\password` generates/encrypts the new password client-side for transmission and is documented to avoid cleartext exposure in history/logs, but no claim is made here that every verifier-bearing diagnostic path is impossible.

To establish usability, a later separately approved SCRAM authentication must test each new role against the exact isolated server. Successful authentication establishes that each tested credential is accepted by that server; it does not alone prove both changes were part of the same atomic transaction. Failed authentication does not prove the transaction aborted. These are separate evidence claims.

## Comparison of documented approaches

| Approach | Security/evidence properties | Failure modes and limits | Assessment |
|---|---|---|---|
| Authenticated local client + explicit transaction | Normal PostgreSQL SQL path; `\\password` prompts/encrypts client-side; transaction status can be queried by XID on a new authenticated session; standard client/server protocol returns structured results. | Requires a valid uncompromised administrator credential; secure two-prompt transaction mechanics need validation; lost XID or no follow-up credential means UNKNOWN; never use cleartext SQL password text. | **Preferred candidate only if prerequisite admin identity is established and separately approved.** Not currently available on documented facts. |
| PostgreSQL single-user mode | Does not require network authentication; `-j` groups each command entry into one transaction; XID status functions are available in SQL. | Output format is explicitly developer-oriented, not documented as stable machine-readable framing; process output provenance and replay resistance remain unresolved; broad implicit superuser powers. | Supported recovery mode but no trustworthy automated completion evidence has been established for this project. |
| `pg_xact_status(xid8)` after disconnect | Documented committed/aborted/in-progress/NULL status; addresses lost response around COMMIT; does not reveal password verifiers. | Needs correct XID, same-cluster connection, retained status, and a valid authenticated session. `in progress`/`NULL`/missing XID are not success. | Strong independent transaction-outcome query when prerequisites exist; not a password-rotation method by itself. |
| Independent SCRAM login | Directly proves the tested role/password can authenticate to the verified server; no verifier query is required. | Requires secret use and connection; separate approval; cannot alone prove atomicity or explain a failure. | Required later usability check (G), separate from transaction evidence. |
| PostgreSQL prepared transactions (2PC) | `PREPARE TRANSACTION` gives a durable GID and a later `COMMIT PREPARED`/`ROLLBACK PREPARED` decision; prepared entries are queryable in `pg_prepared_xacts`. | PostgreSQL says this is for external transaction managers, warns not to leave transactions prepared, requires configuration, retains locks, and disallows some session-bound features. It adds operational risk and does not itself make password-verifier handling safe. Documentation reviewed does not establish it as an appropriate role-password rotation/recovery protocol. | **Not recommended** as a workaround. Not validated for this use case. See [PREPARE TRANSACTION](https://www.postgresql.org/docs/18/sql-prepare-transaction.html) and [Two-Phase Transactions, §67.4](https://www.postgresql.org/docs/18/two-phase.html). |

## Answers to the requested questions

1. **Atomic two-role change:** PostgreSQL transactions can atomically include multiple role changes. A safe psql `\\password`-based two-role transaction is a candidate, but the exact prompt/transaction orchestration must be validated and requires an authenticated administrator.
2. **Query after disconnect/crash:** Yes, with `pg_xact_status(xid8)` if the XID was safely obtained and a valid authenticated session can reconnect to the same cluster.
3. **Unique identity:** `xid8` is the documented 64-bit transaction ID including epoch, does not wrap during the installation's life, and can identify the transaction. Its association to the intended cluster/transaction must be independently recorded and checked.
4. **Server-side verification without verifiers:** Yes, transaction status can be queried without selecting `pg_authid` password fields. It proves transaction state only.
5. **Plaintext leakage:** `psql \\password` is documented to avoid cleartext in command history and server log. Do not put passwords in SQL source, process arguments, shell history, or files. Residual in-memory, verifier logging, crash-dump, and OS diagnostic paths need separate review; no complete universal guarantee is claimed.
6. **Connection lost around COMMIT:** If before commit, the transaction aborts when the backend detects disconnect; if commit completed, changes are durable. A lost response after sending COMMIT is ambiguous to the client until status is queried using the XID.
7. **Distinguish states:** `pg_xact_status` documents committed, aborted, in progress, and NULL. Treat in-progress, NULL, missing XID, mismatched server, or failed query as UNKNOWN; never retry automatically.
8. **Unknown recovery:** No universal automatic recovery. Stop, preserve the cluster, and obtain a separately approved plan. If a valid administrator connection remains, read-only status query may resolve it. If no valid credential/XID exists, the documented evidence path is blocked; don't assume rollback or reuse exposed credentials.
9. **Supported alternative to single-user:** Authenticated SQL (`ALTER ROLE`, preferably psql `\\password`) is supported, but requires a valid authorized login. It does not bypass authentication.
10. **SCRAM claims:** Separate fresh authentication for each role is required to prove each new password works. Authentication does not replace transaction-state evidence.

## Decision

**INCONCLUSIVE.** Official PostgreSQL docs describe a stronger candidate than parsing single-user output, but the project has no established uncompromised administrator credential for the isolated cluster, and the exact secure `\\password` plus single-transaction workflow has not been validated. This report does not authorize authentication or any cluster operation. A–E remain **BLOCKED / NOT APPROVED**. G authentication, canonical DPAPI activation/retirement, and Phase 14A database operations A–D remain separate and unapproved.

## Validation and actions not taken

Only `git diff --check` and a trailing-whitespace scan were run. No tests or PostgreSQL commands were run. No SQL, process, service, port, database, credential, DPAPI file, application configuration, backup, restore, or migration was accessed or modified. No rotation approval was requested.
