# Phase 14A.5A — Offline Rotation and Pending DPAPI Execution Plan

**Revision:** Phase 14A.5C blocker remediation, 2026-11-09 10:10 UTC
**Status: DESIGN PASS; NOT EXECUTED; NOT APPROVED.** A–E has no active approval request. The transaction-marker design addresses the prior completion-evidence gap; implementation review and a fresh runtime preflight are still prerequisites to any new exact approval request.

## Scope and identity basis

This document records the previously documented identity; it is not a fresh runtime preflight. Before any later approved operation, recheck identity read-only and stop if any identity is missing or inconsistent.

| Item | Expected identity (historical/documented) |
|---|---|
| PostgreSQL | 18.6; binaries under `C:\Program Files\PostgreSQL\18\bin` |
| Data directory | `D:\AttendX\PostgreSQL-Test\cluster` |
| System identifier | `7704647215459077108` |
| Pre-stop process | Historical PID 2452; `postgres.exe -D D:/AttendX/PostgreSQL-Test/cluster -h 127.0.0.1 -p 55432`; not evidence for a future process |
| Expected endpoint | `127.0.0.1:55432` only |
| Roles | `attendx_cluster_admin`; `attendx_test_role` |
| Canonical credential file | `D:\AttendX\PostgreSQL-Test\credentials.dpapi` — untouched during A–E |
| Pending credential file | `D:\AttendX\PostgreSQL-Test\backups\phase14a-protected\credentials.dpapi.phase14a5.pending` |
| Pending file parent | `D:\AttendX\PostgreSQL-Test\backups\phase14a-protected` |

The protected directory was created in Phase 14A.2 with inheritance disabled and three explicit Full Control ACEs: current-user SID `S-1-5-21-801617878-2430668760-3645567244-1001`, SYSTEM `S-1-5-18`, and local Administrators `S-1-5-32-544`. This is historical documentation, not a current ACL verification. At future execution, verify the directory owner, protected/inheritance state, and exact ACE set by SID before creating anything. If the live ACL differs, contains any extra ACE, or cannot be read, stop; do not change this directory, its parent, or siblings.

## Proposed sequence (not approved and not ready)

### C — Generate independent values

Only after explicit approval, generate two independent cryptographic RNG values in process memory. Never derive from, compare with, reuse, or test either exposed old value. Do not place values in command arguments, environment variables, clipboard, shell history, logs, console output, reports, Git, or plaintext temporary files. Emit status only.

### D/E — Stage and silently verify the pending DPAPI file before cluster shutdown

1. Recheck the protected parent directory DACL described above. Verify exact owner, inheritance disabled, and only the three approved SIDs, each Full Control. This check precedes file creation. Stop on any unexpected ACE or uncertainty; do not repair ACLs in this phase.
2. Verify that the exact pending path does not exist. Create it with no-overwrite semantics and an explicit security descriptor that permits inheritance only from the already-protected parent; do not create it under `D:\AttendX\PostgreSQL-Test` or any broadly writable inherited directory. If creation cannot guarantee no-overwrite and the resulting ACL, stop before writing content.
3. Verify the new file owner is the current user; inspect the DACL by SID and inheritance flags. Expected effective file ACEs are only inherited Full Control for current-user SID `S-1-5-21-801617878-2430668760-3645567244-1001`, SYSTEM `S-1-5-18`, and Administrators `S-1-5-32-544`, with no broad groups or unexpected ACEs. The parent remains protected and unchanged. Stop on mismatch; write no encrypted payload until verified.
4. Protect the two new values with Windows DPAPI CurrentUser and write only the encrypted structured payload to the pending file. Never echo ciphertext or values. Flush and close. Recheck owner, DACL, inheritance, and file metadata. Do not modify or activate canonical `credentials.dpapi`.
5. Read/decrypt the staged payload only in process memory and compare each recovered value to its corresponding generated value internally. Emit only generic pass/fail status; do not print values, lengths, hashes, payload, or exception text. If staging or round-trip fails, stop before cluster shutdown. Any later cleanup of a partial pending file requires a separate exact authorization; do not overwrite/reuse it.

The protected directory grants SYSTEM and Administrators access in addition to the user. DPAPI CurrentUser protects the payload for the user context, but these principals can read/modify ciphertext; this is a known property of the approved directory ACL, not a claim of user-exclusive access.

### A/B — Offline password change (design; implementation review required)

PostgreSQL 18 documents that one `-j` command entry (semicolon plus two newlines) is one transaction and transaction effects are all-or-nothing. Both role changes must remain in that single entry. A statement failure then cannot durably commit only one password change; separating the statements into entries is prohibited.

The design uses a transient transaction marker to verify commit without relying on process exit or an undocumented `ALTER ROLE` output tag. In the same command entry, create a uniquely named temporary marker table, issue exactly one `ALTER ROLE` for each of `attendx_cluster_admin` and `attendx_test_role`, and store `pg_current_xact_id()` in the marker. A following command entry queries `pg_xact_status()` for that XID and emits a fixed non-secret success token only for `committed`. A missing table/row, error, unknown transaction status, missing/duplicate token, output-capture failure, or other ambiguity is UNKNOWN and stops the procedure. The temporary table is automatically dropped when the single-user session ends. This is a transaction-commit signal for the exact reviewed entry, not a SCRAM authentication test; G remains separate.

Phase 14A.5E added a pure wrapper with an injected executor and mocked tests. It accepts success only when stdout is exactly the fixed commit token (optionally followed by one line ending) and stderr is empty. This is deliberately fail-closed, but PostgreSQL 18 documents developer-oriented single-user output and does not promise that exact envelope. No production executor or real-output adapter exists. **Real PostgreSQL output compatibility is UNKNOWN.** Do not request A–E approval until an independent review establishes a safe, documented output adapter and the exact output envelope; real PostgreSQL execution remains prohibited unless separately approved. No raw SQL/output/server log may be retained. Process exit status is never sufficient evidence.

The operation changes no test-role attributes or memberships. PostgreSQL documents that unmentioned attributes remain unchanged. The wrapper is implemented and mock-tested only; no real executor, output adapter, or PostgreSQL operation was implemented or run. The plan remains **NOT READY for approval** until real-output compatibility is established safely, the adapter receives independent review, and a fresh runtime preflight is completed. See `PHASE_14A5D_VERIFICATION_DESIGN.md` and `PHASE_14A5E_WRAPPER_IMPLEMENTATION.md`.
### Shutdown impact and preconditions

The previously proposed command is:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -D 'D:\AttendX\PostgreSQL-Test\cluster' stop -m fast -w
```

PostgreSQL `pg_ctl` fast shutdown disconnects active clients and rolls back their active transactions. This interruption is not harmless. Before any future stop, confirm via read-only OS-level process/socket inventory that there is no unexpected client workload and that the listener belongs to the exact D: cluster. Because A–E does not include a database query, any ambiguous/incomplete OS inventory is a stop condition. An approving user would have to accept the known disconnection/rollback impact. Never stop the C: Windows service. See [PostgreSQL 18 `pg_ctl` documentation](https://www.postgresql.org/docs/18/app-pg-ctl.html).

### Restart identity checks (only after a future verified A/B outcome)

Do not restart after an uncertain or failed password operation. If a reviewed success gate is later established and passes, start only the exact D: cluster with explicit loopback and port options. The proposed `-l` path is `D:\AttendX\PostgreSQL-Test\cluster\server.log`; PostgreSQL documents `-l` as append. Before use, check existence and ACL read-only. Do not truncate, overwrite, or use this log for SQL input/output; if its state or ACL is ambiguous, stop and seek a separately reviewed log path.

After start, use only OS/control-file inspection; do not authenticate or probe a TCP port. Verify all of the following from newly collected, mutually consistent evidence:

1. Capture the new process PID independently. It must differ from historical pre-stop PID `2452`; if equal, stop unless a documented PID-reuse explanation is established before continuing.
2. Confirm the executable is PostgreSQL 18.6 and its command line identifies `D:\AttendX\PostgreSQL-Test\cluster`.
3. Confirm `postmaster.pid` is fresh and agrees with the new PID, expected data directory, port `55432`, address `127.0.0.1`, and ready state.
4. Re-run `pg_controldata` against the exact D: directory and confirm system identifier `7704647215459077108`.
5. Confirm the only listener for this server is `127.0.0.1:55432` and its owning PID is the newly captured PID. If Windows listener APIs disagree, no owner row exists, or any evidence is stale/ambiguous, stop. Do not use port 5432 or control another process.

No historical PID, socket, or preflight result can substitute for these post-start observations.

### Failure handling

- Pending directory/file ACL, no-overwrite, write, or round-trip failure: do not stop the cluster or alter passwords. Preserve canonical file; do not clean up or reuse a partial pending file without separate approval.
- Unsafe/ambiguous shutdown preflight: do not stop or signal any process.
- Either password operation fails or completion evidence is unknown: stop; do not claim both changed and do not restart under a success assumption. Treat partial state as UNKNOWN. Preserve cluster and encrypted pending candidate. Recovery must begin with a separately approved plan that does not assume either role’s password state; do not use old exposed values.
- Restart or any identity check fails: do not authenticate, retry start, change port, recover/reinitialize/restore, or control another server. Preserve state and report exact non-secret evidence; further action needs separate approval.
- At every point, canonical `credentials.dpapi` remains untouched; no pending activation or compromised-file retirement occurs in A–E.

## Approval boundaries and supersession

- The older Phase 14A.5 **A–F** approval request is **superseded and withdrawn**. It is not actionable and must not be relied on as authorization.
- Only this corrected A–E plan could be submitted for a new explicit approval after all blockers are resolved. It is currently **NOT READY**, so no A–E approval is requested here.
- G (new-credential authentication) remains a separate later explicit approval.
- Canonical DPAPI activation and compromised-file retirement require another separate approval, only after G passes.
- Phase 14A database operations A–D remain unapproved and outside this scope.

## Status

**MOCKED WRAPPER PASS / REAL EXECUTION UNKNOWN / NOT APPROVED.** ACL, shutdown, restart identity, and approval scope requirements are documented. Mock tests validate the fixed-token verifier, but PostgreSQL 18 does not specify the exact marker-only output envelope and no real executor is present. A–E remain NOT READY pending safe output-adapter design/review and fresh identity preflight. No operation was performed.

## Phase 14A.5G architecture addendum (2026-11-09)

The Phase 14A.5F adversarial counterexample is decisive: the injected executor can return the constant success token without launching PostgreSQL or executing SQL, and stale output is not invocation-bound. Do not use this wrapper's `COMMIT_VERIFIED` status as evidence. Phase 14A.5G recommends **REPLACE** for operational use with a trusted launcher/capture boundary and fresh invocation-bound evidence, but documents that PostgreSQL's single-user output protocol and evidence provenance remain unverified. A–E remain **BLOCKED / NOT APPROVED**; this addendum does not authorize execution or request approval.

## Phase 14A.5H alternative research addendum (2026-11-09)

PostgreSQL 18 documents a possible authenticated-client route: use a valid authorized administrator session, change both passwords in one explicit transaction using a secret-safe client method such as psql `\\password`, obtain the transaction's `xid8`, and reconcile a lost COMMIT response with `pg_xact_status(xid8)` from a new authenticated connection to the verified cluster. The manual documents `\\password` as protecting cleartext from history/server logs, but the exact two-role prompt/transaction workflow and remaining verifier/OS diagnostic exposure require validation. This route does not bypass authentication. No uncompromised administrator credential or follow-up identity is established in project evidence; therefore it is **INCONCLUSIVE / NOT AVAILABLE ON VERIFIED FACTS**. Do not alter this plan's operational steps or request approval based on this candidate. A–E remain **BLOCKED / NOT APPROVED**. See `PHASE_14A5H_ALTERNATIVE_VERIFICATION_RESEARCH.md`.

## Phase 14A.5I recovery planning addendum (2026-11-09)

The conditional direction is **DESIGN CONTROLLED OFFLINE RECOVERY**, because no uncompromised administrator login is established. Do not treat this as approval or a finalized executable procedure. Replace the prior proposed marker-output proof: the independent outcome candidate is later, separately approved SCRAM authentication of both newly rotated roles to the freshly verified cluster. Both successes prove the new credentials are accepted; any failure or identity ambiguity leaves the overall result UNKNOWN and must not trigger automatic retry. The offline secret-delivery method remains a blocker because no independently reviewed method prevents plaintext/diagnostic residue. A–E remain **BLOCKED / NOT APPROVED**. Reinitialization is not a recovery shortcut and would require separate data-loss/retention approval. See `PHASE_14A5I_ADMIN_ACCESS_RECOVERY_PLAN.md`.

## Phase 14A.5J secret-delivery addendum (2026-11-09)

No defensible complete secret-delivery mechanism is established. Do not use a password-bearing SQL builder or caller-provided sink. Anonymous stdin piping is only a transport improvement; memory, handle inheritance, server diagnostics/logging, and WER/crash-dump exposure remain unresolved. A SCRAM verifier could reduce raw-password exposure to the server only if separately validated; the verifier must still be treated as a credential. No prototype or tests were added/run. A–E remain **BLOCKED / NOT APPROVED**. See `PHASE_14A5J_SECRET_DELIVERY_DESIGN.md` and its reviewer checklist.
