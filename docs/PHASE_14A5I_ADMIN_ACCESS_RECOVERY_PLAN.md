# Phase 14A.5I — Isolated PostgreSQL Administrator Access Recovery Plan

**Date:** 2026-11-09
**Scope:** Planning and documentation only. No live cluster, process, service, port, credential, or DPAPI file was accessed.
**Decision:** **DESIGN CONTROLLED OFFLINE RECOVERY** as the conditional candidate, followed by separately approved fresh SCRAM authentication of both newly rotated roles. This is a plan, not an execution approval. A–E remain **BLOCKED / NOT APPROVED**.

## Project evidence reviewed

- `docs/PHASE_14A5H_ALTERNATIVE_VERIFICATION_RESEARCH.md`
- `docs/PHASE_14A5G_VERIFICATION_ARCHITECTURE.md`
- `docs/PHASE_14A5A_OFFLINE_ROTATION_EXECUTION_PLAN.md`
- `docs/PHASE_14A5_CREDENTIAL_ROTATION_APPROVAL_PLAN.md`
- `docs/PHASE_14A5F_INDEPENDENT_ADVERSARIAL_REVIEW.md`
- `docs/FINAL_ACCEPTANCE_REPORT.md`

These documents record an isolated PostgreSQL 18.6 cluster at `D:\AttendX\PostgreSQL-Test\cluster`, expected system ID `7704647215459077108`, port `55432`, and roles `attendx_cluster_admin` and `attendx_test_role`. These are historical documented values, **not freshly checked in this phase**. The previous credentials and existing `credentials.dpapi` ciphertext remain compromised and must not be reused or tested. No separate uncompromised administrator credential is established in the project record. No conclusion is made about whether another credential exists.

## Option comparison

### A. Recover using a verified uncompromised administrator credential

**Preconditions:** A distinct credential must already exist in an independently controlled approved vault/custody path, be explicitly identified as not exposed, have authorization sufficient to alter both target role passwords, and be usable without revealing its value. The actual cluster identity must be freshly verified before any connection. The existing DPAPI ciphertext and values known to be exposed are not candidates.

**Method/evidence:** PostgreSQL supports authenticated SQL `ALTER ROLE`; psql `\\password` prompts and encrypts client-side, and the PostgreSQL manual says it prevents cleartext password appearance in command history/server log. A single explicit transaction could change both roles atomically if the secure prompt commands are proven to participate in that transaction. A transaction XID may be retained as non-secret metadata and later checked with `pg_xact_status(xid8)` from an authenticated connection to the same verified cluster. Separately approved SCRAM logins for both new credentials establish their usability. See official references below.

**Risks/limitations:** PostgreSQL documentation does not provide a complete assurance against OS memory dumps, all diagnostics, or verifier-bearing output. Exact two-prompt transaction framing remains unvalidated. Transaction-status query requires a known XID and a new valid authenticated connection. If both role credentials are changed and no third valid administrator credential exists, using a new role credential for reconciliation is itself an authentication gate.

**Approvals:** Fresh read-only identity/credential-source preflight; separate explicit approval for use of that exact administrator identity and the two-role transaction; separate G approval for each new SCRAM authentication; later, separate DPAPI canonical activation/compromised-file retirement approval. This planning phase grants none.

**Impact/recovery:** Preserves the existing cluster and system ID if successful. Connection loss around COMMIT can make the client's outcome unknown; use XID status only if available. If status/authentication cannot establish success, stop and treat role state as unknown; no automatic retry.

**Current assessment:** **BLOCKED / NOT ESTABLISHED.** Do not use a previously exposed credential to unlock this option.

### B. Controlled offline single-user recovery

**Preconditions:** Future exact cluster identity and stopped-state preflight; approved maintenance window; approved protected DPAPI staging with new values; approved process shutdown/start procedure; verified PostgreSQL 18 binary and data directory. No `trust` changes. The two role changes must be one transaction/command entry so a statement error cannot durably update only one role.

**Outcome verification redesign:** Do not accept process exit status or single-user output token as commit proof. Treat single-user output as diagnostic and never display or persist it. After the single-user child has definitely exited and the exact cluster is restarted, independently establish cluster identity using newly collected process/data-directory/system-ID/listener evidence. Then, only under a separate G approval, attempt fresh SCRAM authentication to the exact verified loopback cluster using each new replacement credential, without printing either value. Successful authentication for both named roles is direct evidence that both tested replacement credentials are accepted by that server; it avoids relying on single-user output framing and does not require querying `pg_authid` password verifiers. The test should also bind the session to the expected cluster using separately reviewed identity evidence.

This verifies the **credential usability result**, not the precise single-user SQL transcript or atomic transaction history by itself. If either authentication fails, the result is **UNKNOWN** about the overall rotation; do not infer rollback, try the old exposed values, or automatically rerun the reset. Preserve the cluster/candidate credential state and obtain a new approved recovery plan. If the process hangs, crashes, output/capture raises a secret-safety concern, identity checks disagree, or the cluster cannot be safely restarted, stop and report unknown state. Do not start another copy or signal an uncertain process.

PostgreSQL documents `--single` as a recovery/debugging mode, grants its session user implicit superuser power, and describes `-j` transaction-entry framing. It also explicitly says query output is in a form more useful to developers than end users. Thus this plan avoids using that output as verification evidence. See [PostgreSQL 18 `postgres`, Single-User Mode](https://www.postgresql.org/docs/18/app-postgres.html#APP-POSTGRES-SINGLE-USER).

**Credential exposure risk:** Offline SQL needs the new password to reach PostgreSQL. Existing code constructs password-bearing SQL bytes; do not reuse that implementation as an execution tool. Any future method must be independently designed to prevent cleartext, SQL, verifiers, and exception text from being retained in console, logs, shell history, process arguments, temporary files, or reports. PostgreSQL documents that `ALTER ROLE ... PASSWORD` can expose cleartext in client history/server logs, while psql `\\password` is a client workflow and is not directly available to the offline single-user backend. No safe secret-delivery method for offline SQL is certified here. This is a **BLOCKER** requiring separate design/review before approval.

**Approvals:** Separate exact A–E approval only after credential-delivery and process-output handling are independently reviewed; fresh cluster identity preflight immediately before operation; separate later G approval for the two new SCRAM tests; separate later approval for canonical DPAPI activation/retirement. None is granted by this plan.

**Impact/recovery:** Preserves cluster files, system ID, roles, databases, and data if performed correctly. Restart after a completed offline session is part of recovery, but must only target the verified D: test cluster. Any uncertain transaction or restart state is UNKNOWN and requires a new approved plan; never restore/use exposed values.

**Current assessment:** **CONDITIONAL DESIGN CANDIDATE / NOT READY.** Fresh SCRAM checks can prove new-credential usability without the single-user output marker, but the offline secret-delivery implementation is currently not safely established.

### C. Reinitialize only the isolated test cluster

**Preconditions:** Separate explicit approval naming the exact cluster and data directory, independent inventory of every database/role/tablespace and any external data directory, a reviewed retention/backup strategy, confirmed owner and ACLs, replacement cluster configuration, replacement credential custody plan, loopback-only listener plan, and verification of the new cluster identity. Phase 14A.5I does not establish current contents or authorize backup/restore.

**Impact:** `initdb` creates a new database cluster, including new shared catalogs and default databases. Reinitializing the current cluster would replace its system identity and would make existing databases, roles, tablespaces/catalogs, and data unavailable from the new cluster; loss may be permanent without a separately approved valid backup. The isolated cluster may contain Phase 11 test databases or other artifacts; do not assume it is empty. Safest future design, if selected, is a new separately named data directory while preserving the old cluster untouched until a separate retention decision, not wiping/reusing the existing path.

**Credential confidentiality:** Bootstrap password entry must not go in command arguments, shell history, logs, source, or a plaintext password file left behind. PostgreSQL `initdb --pwfile` reads the password from a file, so that method itself requires a separately reviewed protected ephemeral input path and cleanup. Do not use `trust`. A new DPAPI CurrentUser-protected credential store requires separate staging/verification and later canonical activation approvals. Microsoft documents DPAPI CurrentUser protection as tied to the encrypting user on the same machine by default; it does not protect plaintext after decryption or make previously exposed ciphertext safe. See [Microsoft `CryptProtectData`](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata).

**Verification:** Verify new data directory, PostgreSQL version, newly generated system identifier, roles/attributes, authentication configuration and loopback-only process/listener. Test both fresh credentials through separately approved SCRAM connections. Do not infer anything about the old cluster from the new one.

**Approvals:** Requires a completely separate explicit approval for creation/use of a new cluster directory and configuration, plus retention/decommission decision for the existing test cluster, any backup, data loss, and new credential handling. Existing service/port 5432 must remain outside scope.

**Failure behavior:** Do not delete/reinitialize the original cluster as a recovery shortcut. If initialization or verification fails, leave both existing cluster and new partial directory untouched pending a separately approved response. No automatic cleanup.

**Current assessment:** **NOT AUTHORIZED / HIGH DATA-LOSS IMPACT.** Reinitialization is a last-resort replacement strategy, not recovery of the existing cluster.

## Credential custody gates

1. Treat both exposed role credentials and the old DPAPI ciphertext as compromised. Do not decrypt, test, reuse, copy, or activate the old ciphertext.
2. Generate any replacements only after exact-scope approval, using a cryptographically secure generator in memory; never print them or place them in command arguments, shell history, logs, source files, or plaintext temporary files.
3. Stage replacement credentials only in a previously verified protected directory, verify ACLs and DPAPI round-trip without displaying values, and keep canonical `credentials.dpapi` untouched at this stage.
4. Credential rotation execution is a distinct approval gate. For offline reset, the delivery mechanism must receive an independent security review before this gate can be requested.
5. Fresh SCRAM authentication of each new role is a separate G approval and must be directed only at the freshly verified isolated cluster.
6. Canonical DPAPI activation and retirement of the old compromised ciphertext are a later, separate approval after successful G checks. No secrets belong in reports; record only statuses and non-secret metadata.

DPAPI user scoping is an at-rest protection mechanism, not a remedy for exposure that happened after decryption. Microsoft documentation says default `CryptProtectData` data is normally decryptable only by the same user on the same computer; it also describes a machine-scope flag, which is not the intended mode for future user-scoped storage.

## Decision and exact blockers

**DESIGN CONTROLLED OFFLINE RECOVERY** is the conditional direction because no uncompromised administrator credential is established and the existing single-user mode can reset access without network authentication. However, **do not request A–E approval yet**. The earlier fixed-token wrapper is explicitly rejected. Offline password delivery without cleartext disclosure and diagnostic residue still lacks an independently reviewed implementation. SCRAM authentication of both new credentials is the proposed independent usability verification, but it remains a separate later G approval and cannot be performed now.

Before any new approval request, the project must provide: (1) independent review of a secret-safe offline input mechanism or establish an independently controlled uncompromised administrator credential; (2) a reviewed fail-closed transaction/state handling sequence; (3) exact protected DPAPI staging and custody procedure; (4) approval of the isolated cluster outage/restart; (5) fresh identity preflight; (6) a separate, exact G plan for each role; and (7) explicit separate approval for canonical credential-file activation/retirement. Reinitialization requires its own distinct approval and data-loss/retention plan.

## Official references

- [PostgreSQL 18 `postgres`, Single-User Mode](https://www.postgresql.org/docs/18/app-postgres.html#APP-POSTGRES-SINGLE-USER) — recovery mode, implicit superuser, command-entry transaction framing, developer-oriented output.
- [PostgreSQL 18 `ALTER ROLE`](https://www.postgresql.org/docs/18/sql-alterrole.html) — authority and cleartext password cautions.
- [PostgreSQL 18 `psql`, `\\password`](https://www.postgresql.org/docs/18/app-psql.html#APP-PSQL-META-COMMAND-PASSWORD) — prompt/client encryption and history/log claim.
- [PostgreSQL 18 transaction status functions](https://www.postgresql.org/docs/18/functions-info.html#FUNCTIONS-PG-SNAPSHOT) — `pg_current_xact_id()` and `pg_xact_status(xid8)` statuses/limitations.
- [PostgreSQL 18 SCRAM/password authentication](https://www.postgresql.org/docs/18/auth-password.html) and [HBA authentication methods](https://www.postgresql.org/docs/18/auth-pg-hba-conf.html) — client authentication semantics.
- [PostgreSQL 18 `initdb`](https://www.postgresql.org/docs/18/app-initdb.html) — creation of a new cluster and password-file option.
- [Microsoft `CryptProtectData`](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata) — DPAPI current-user/machine protection scope.

## Validation and prohibited actions

Only `git diff --check` and trailing-whitespace checks on changed documentation files were run. No tests or PostgreSQL commands were run. No cluster preflight, process/service/port operation, SQL, connection, authentication, secret generation/rotation, DPAPI access, database, backup, restore, migration, `.env`, or configuration change occurred. A–E remain **BLOCKED / NOT APPROVED**.

## Phase 14A.5J secret-delivery addendum (2026-11-09)

Secret delivery remains **INCONCLUSIVE**. An anonymous stdin pipe avoids command-line/environment/plaintext-file placement but does not protect process memory, inherited-handle mistakes, logs, diagnostics, or Windows crash dumps. Client-generated SCRAM verifier delivery is a research candidate only; the verifier is itself password-equivalent material, and the exact generation/format and diagnostic behavior are not independently validated. No prototype was created. Offline password delivery remains a blocker; A–E stay **BLOCKED / NOT APPROVED**. See `PHASE_14A5J_SECRET_DELIVERY_DESIGN.md` for the threat model and future review checklist.
