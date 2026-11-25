# Phase 14A.5J — Offline Secret-Delivery Design Review

**Date:** 2026-11-09
**Conclusion:** **INCONCLUSIVE — no defensible complete delivery mechanism is established for the stated threat model.** No prototype code or credential-related tests were added/run.
**Status:** A–E remain **BLOCKED / NOT APPROVED**.

## Scope and threat model

Reviewed Phase 14A.5I/G/H/A/F materials and the existing Phase 14A.5E wrapper/test source. Researched official PostgreSQL 18, Microsoft Windows, and IETF SCRAM documentation. This is architecture-only: no real secrets or credentials were generated or used, and no PostgreSQL executable, process, connection, service, port, DPAPI file, `.env`, database, or application configuration was accessed.

The requested protections cover more than command-line visibility. They require keeping password-equivalent material out of command arguments, environment, shell history, persistent files, logs, stdout/stderr, tracebacks/reports, process listings, crash dumps and persistent test artifacts. The threat model must also decide whether same-user malware, local administrators, debuggers, kernel/OS crash collection, and a compromised PostgreSQL executable are in scope. No existing project document establishes that boundary or the Windows diagnostic configuration.

## Candidate mechanisms evaluated

### Command arguments, environment, shell text, or plaintext file — REJECT

Command arguments can be exposed by process inspection and are explicitly prohibited. Environment variables are inherited process state and may be inspected or captured. Shell text can enter history/transcripts. A temporary plaintext file is persistent data until securely removed; ordinary deletion is not guaranteed secure erasure. PostgreSQL `initdb --pwfile` is documented to read its bootstrap password from a file, so it is not a suitable offline rotation delivery channel under this requirement.

### Standard input / anonymous pipe — useful transport property, not complete protection

PostgreSQL single-user mode accepts commands from shell input; Microsoft documents anonymous pipes as parent-child byte streams typically used to redirect child standard input/output. A pipe avoids placing input in the command line, environment, or a named filesystem object. Windows documents that pipe handles can be inheritable and that `CreateProcess` can inherit them; only explicitly required handles should be inherited. A broken handle protocol, extra inheritable handles, wrong child, concurrent writer, or accidental console/file redirection can disclose or misdirect content.

Pipe bytes and buffers are not encrypted or erased by the pipe abstraction. The parent and child both hold secret-bearing memory; process termination, exception paths, debuggers, page files, and crash dumps are outside the pipe guarantee. Microsoft documents that WER can collect full user-mode dumps after crashes when configured, and that full dumps include process memory. A stdin pipe therefore mitigates command-line/history/file exposure but does not meet the full stated confidentiality guarantee by itself.

### Named pipe — REJECT as a default alternative

A named pipe can have an explicit security descriptor, but it introduces a discoverable name, endpoint ACL, connection/authentication, impersonation, and cleanup concerns. It does not protect bytes from the authorized reader or memory dumps and is unnecessary for a direct parent-child single-user invocation. No named-pipe design is established here.

### In-memory buffer — necessary but insufficient

An in-memory buffer avoids intentional disk writes, but a Python `bytes` value is immutable and cannot be reliably zeroized; copies can arise during encoding, formatting, IPC and exception handling. Memory can be captured by debuggers, diagnostics, paging and crash dumps. Existing wrapper input formatting builds SQL containing plaintext password values, so it must not be reused as an execution component. Redacted `repr` does not remove the underlying bytes or constrain adapters.

### Client-generated SCRAM verifier — promising reduction, still sensitive and unproven end-to-end

PostgreSQL 18 documents that if a `CREATE ROLE`/`ALTER ROLE` password string is already in recognized SCRAM-encrypted format, PostgreSQL stores it as supplied. The IETF SCRAM standard defines the derivation components used to form SCRAM verifier material. This suggests a design that derives a SCRAM verifier in the trusted parent and sends only that verifier in the offline SQL input, keeping the raw new password out of the PostgreSQL child. See [PostgreSQL 18 `CREATE ROLE`, password parameter](https://www.postgresql.org/docs/18/sql-createrole.html) and [RFC 5802, SCRAM](https://www.rfc-editor.org/rfc/rfc5802.html).

This does **not** establish a safe mechanism: the verifier is highly sensitive authentication material. SCRAM's RFC states stolen authentication information permits offline dictionary/brute-force guessing; it also notes the stored information alone is not sufficient to impersonate the client. Do not assume it is safe to log merely because it is not the raw password. The server receives it in the SQL text; PostgreSQL documentation warns role/password statements can be logged, and server logs can contain sensitive information. An error or diagnostic path could retain the verifier. A verifier-generation implementation must match PostgreSQL's accepted exact format, iteration policy, salt requirements and password processing. The docs establish store-as-is behavior, not that a home-grown generator is interoperable or that every PostgreSQL/Windows diagnostic path can be prevented from recording the verifier. A wrong verifier could lock out the role. No such implementation should be used without independent algorithm review and separate disposable-cluster interoperability testing.

## Decision

**INCONCLUSIVE.** Anonymous stdin pipes are the least-bad transport candidate for avoiding command-line and file exposure, and client-generated SCRAM verifier input might reduce raw-password exposure to the server. Neither meets the complete requirement on documented evidence: password-equivalent bytes still exist in parent/child memory and may reach diagnostics, logs, or crash dumps, while the intended process, handle, logging, WER, and verifier behavior have not been verified. Do not invent a prototype that gives a false assurance or provides a callable secret-bearing interface to an arbitrary sink.

No code was changed or implemented. The existing Phase 14A.5E wrapper remains retired for operational use and must not be used to deliver credentials. The 14A.5E mock tests are historical only; they do not test secret delivery and were not rerun in this phase.

## Conditions before a future prototype could be considered

1. Define the protected threat boundary, including same-user/admin/debugger and Windows dump/pagefile handling.
2. Independently review a Windows launcher that creates the child directly, uses an explicit restricted handle list, attaches only a one-way anonymous stdin pipe, and closes every unused handle before writing.
3. Decide whether raw password or client-generated SCRAM verifier is delivered. If verifier: independently validate RFC-based derivation, exact PostgreSQL accepted format and iteration/salt policy; treat verifier as credential material and protect all output paths.
4. Document and verify all logging destinations/overrides and Windows WER/local dump behavior without changing them implicitly; fail closed when state is unknown.
5. Specify bounded writes, timeout, broken pipe, partial write, child launch/identity, interruption, cleanup, and no-retry behavior. No cleanup claim may imply reliable memory zeroization.
6. Implement mock tests for argument/env/file/output/exception/no-retry behavior and separate adversarial review.
7. Obtain separate approval for controlled isolated-cluster interoperability and SCRAM verification; no production or Phase 14A database scope.

## Independent-review checklist (future work)

- [ ] Confirm no password/verifier in argv, environment, shell input/history, source, persistent files, logs, console, stderr, tracebacks, reports, process listings, or test artifacts.
- [ ] Confirm direct child executable identity and exact target arguments; no shell and no arbitrary executor callback.
- [ ] Audit Windows handle inheritance; only required stdin/stdout/stderr handles are inherited; parent closes child ends before I/O.
- [ ] Test incomplete write, broken pipe, child never reads, timeout, child crash, interrupt, output overflow, and ambiguous completion. Each must return fixed UNKNOWN and never retry.
- [ ] Verify no unexpected output, error path, PostgreSQL log, WER dump, crash report, or OS diagnostic retains password-equivalent material.
- [ ] If using SCRAM verifier input, verify format/derivation/iterations/salt against official PostgreSQL 18 behavior using synthetic values in a separately approved disposable environment.
- [ ] Ensure tests patch/prohibit subprocess launch, sockets, DPAPI, application config, database connections and filesystem writes; tests must not claim mocks prove real PostgreSQL behavior.
- [ ] Independently inspect the threat model, source, tests and test evidence; reviewer must not be the implementer.
- [ ] Require fresh cluster identity preflight and separate explicit approval before any live integration or credential operation.

This checklist is not evidence that any item has passed and does not approve A–E, G, DPAPI activation/retirement, or Phase 14A database operations.

## Sources

- [PostgreSQL 18 `postgres`, Single-User Mode](https://www.postgresql.org/docs/18/app-postgres.html#APP-POSTGRES-SINGLE-USER)
- [PostgreSQL 18 `CREATE ROLE`, password parameter](https://www.postgresql.org/docs/18/sql-createrole.html)
- [PostgreSQL 18 `ALTER ROLE`](https://www.postgresql.org/docs/18/sql-alterrole.html)
- [PostgreSQL 18 log-file maintenance](https://www.postgresql.org/docs/18/logfile-maintenance.html)
- [Microsoft Windows Anonymous Pipe Operations](https://learn.microsoft.com/en-us/windows/desktop/ipc/anonymous-pipe-operations)
- [Microsoft Windows Pipe Handle Inheritance](https://learn.microsoft.com/en-us/windows/win32/ipc/pipe-handle-inheritance)
- [Microsoft Windows process creation and handle inheritance](https://learn.microsoft.com/en-us/windows/win32/procthread/creating-processes)
- [Microsoft Windows Error Reporting user-mode dumps](https://learn.microsoft.com/en-us/windows/win32/wer/collecting-user-mode-dumps)
- [IETF RFC 5802 — SCRAM](https://www.rfc-editor.org/rfc/rfc5802.html)

## Validation

Only documentation checks (`git diff --check` and trailing-whitespace scan) are in scope. No tests, Python execution, PostgreSQL commands, process operations, credential generation, or DPAPI operations are authorized or performed.
