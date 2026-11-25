# Phase 14A.4 — Credential Exposure Containment and Recovery Plan

**Date:** 2026-11-09
**Scope:** Read-only security review and planning. **No credential file, ACL, PostgreSQL data, role, cluster, service, application configuration, or database was changed.** No PostgreSQL login/connection was attempted.

## Findings

| Area | Status | Finding |
|---|---|---|
| Known exposure location | FAIL (confidentiality) | During Phase 14A.3, a diagnostic formatting error emitted decrypted bootstrap and test-role credential values in the assistant tool output. Values are not reproduced here. Treat both as compromised. The tool output is part of the conversation record; its retention/access controls are outside this filesystem inspection and remain UNKNOWN. |
| DPAPI credential file metadata | PASS (metadata only) | `D:\AttendX\PostgreSQL-Test\credentials.dpapi`; size 1,708 bytes; owner `LAPTOP-G6VAKMU3\Asus`; creation UTC `2026-11-09T07:36:12.3683471Z`; modified UTC `2026-11-09T07:36:12.4226992Z`; attributes `Archive, Compressed`. File contents were not read, decrypted, or hashed in Phase 14A.4. |
| Credential-file DACL | PASS | Inheritance disabled. Exactly one explicit allow ACE: current user SID `S-1-5-21-801617878-2430668760-3645567244-1001`, Full Control; no inherited rules. |
| DPAPI context | PASS (documented) / NOT TESTED (this phase) | Phase 10 documents Windows PowerShell CurrentUser DPAPI protection and a prior same-user round trip. CurrentUser DPAPI protects ciphertext at rest for that Windows user; it does not prevent exposure after plaintext is decrypted. This phase did not decrypt or test the file. |
| File/script/log search | UNKNOWN (bounded scan) | A broad heuristic scan examined repository and user temporary text files (including some dependency/virtual-environment files because a directory exclusion did not apply) for password-assignment shapes and long token-like strings. It emitted filenames/counts only, never matched text. No password-assignment candidate was confirmed; generic token-like candidates occurred across code/log/dependency/diagnostic text and could be hashes, test data, or other values. None was confirmed as these credentials. Exact-value comparison was intentionally not performed because it would require reusing/copying the exposed values. Therefore absence of the credentials from every local file cannot be certified. |
| Repository/Git exposure | UNKNOWN | The known tool-output disclosure is not a repository file. No exact-value content search of Git objects or working files was performed. No credential value was intentionally written to a repository file by Phase 14A.4. Git status was inspected; existing modifications and untracked files were preserved. |
| PostgreSQL version and cluster identity | PASS (read-only) | PostgreSQL 18.6; exact data directory `D:\AttendX\PostgreSQL-Test\cluster`; `pg_controldata` system identifier `7704647215459077108`. `postmaster.pid` identifies PID 2452, `127.0.0.1`, port 55432, ready. The file/process identify the isolated test cluster. |
| Process identity | PASS (elevated read-only) | PID 2452 is `C:\Program Files\PostgreSQL\18\bin\postgres.exe`, command line selects the exact D: cluster and `-h 127.0.0.1 -p 55432`. An unprivileged `pg_ctl status` said no server running; this is an environmental/process-visibility false negative, contradicted by the elevated process inventory, PID file, and socket owner. No process was controlled or signaled. |
| HBA authentication methods | PASS (file inspection) | Six active HBA records were found (four `local`, two `host`); every active rule uses `scram-sha-256`. Active include directives were not found. **Zero** active `trust` records. No password/verifier contents were read. No explicit `password_encryption` setting was found in `postgresql.conf` or `postgresql.auto.conf`; the actual stored role verifier algorithms were not queried and remain NOT TESTED. |
| Listener ownership | PASS (partial OS evidence) / UNKNOWN (API discrepancy) | Elevated `Get-NetTCPConnection` returned local `127.0.0.1:55432` with owning PID 2452; the `State` field was blank. `netstat -ano -p tcp` returned no matching row. A prior unprivileged query returned no rows, while the elevated query now returns the endpoint/PID. The process, PID file, and owner row agree on the test server. The precise reason for the `netstat`/PowerShell API disagreement remains UNKNOWN; no TCP probe or database connection was made in this phase. |
| Existing service / port 5432 | NOT TESTED (current state) / PASS (scope) | No service query, port 5432 probe, or service-database connection was made. Prior phase records identify the existing Windows service as separate from the D: test cluster. This phase did not start, stop, restart, or modify any service. |
| Tests / database operations | NOT TESTED | **0 tests run, 0 failed, 0 skipped.** No SQL connection, role query, credential rotation, backup, restore, migration, or application configuration change. |

## Exposure scope

The confirmed exposure location is the Phase 14A.3 assistant tool output, which included decrypted values because a PowerShell interpolation expression rendered fields instead of their lengths. The raw values are deliberately absent from this report and all updated reports. The platform's transcript/log retention and audience cannot be inspected here. The DPAPI file itself was not opened during this review; prior documentation records that it contains CurrentUser-protected ciphertext. DPAPI does not protect a value after an authorized process has decrypted it.

The bounded local text scan is not proof that the values are absent from every script, log, temporary file, backup, Git object, shell transcript, or platform transcript. No matched text or surrounding lines were displayed. Exact-value matching, hashing, decryption, or copying was avoided as required.

## Safe recovery plan (DRAFT; no step executed)

1. **Contain exposure:** Treat both existing credentials as compromised. Do not reuse them or attempt authentication with them. Restrict access to this conversation/output using controls available to the account owner; transcript deletion/retention changes are outside this filesystem and were not attempted. Keep Phase 14A A–D blocked.
2. **Approve an isolated maintenance window:** Obtain separate explicit approval for stopping only the identified test postmaster, performing an offline single-user password update on this exact cluster, and restarting that same cluster on loopback. Reconfirm PID, executable, data directory, system ID, and port immediately beforehand. Do not use `trust`, port 5432, or the existing Windows service.
3. **Preserve cluster identity/data:** Keep the existing D: data directory and system identifier; do not run `initdb`, drop databases, or replace the cluster. Consider a separately approved cold copy of the stopped cluster to a new protected destination before catalog changes; define its path, capacity, ACL, and collision checks in that approval. The Phase 11 empty database dump is not a physical cluster backup.
4. **Generate replacements independently:** After approval, generate two independent high-entropy values with a cryptographic RNG in memory (for example, 32 random bytes each encoded as Base64URL). Do not read, compare, reuse, print, log, place on a command line, clipboard, `.env`, or plaintext temporary file. The generator must not derive from either old value.
5. **Stage protected storage before password change:** Prepare a new candidate credential payload outside the repository using Windows CurrentUser DPAPI for each value. Write only encrypted payload bytes; set a protected file DACL for the current user SID and verify owner, inheritance, and exact ACEs. Test decryption round-trip in memory using equality/length checks only; emit pass/fail, never values. Do not overwrite the current file until the candidate is safely retained and verified. Creation/replacement/removal of these files requires explicit approval.
6. **Invalidate both old passwords offline:** With the exact test cluster stopped and identity rechecked, use PostgreSQL's supported single-user mode on the existing data directory to set `password_encryption` to `scram-sha-256` and replace the passwords for `attendx_cluster_admin` and `attendx_test_role`. Deliver SQL from process memory through a controlled stdin pipe; do not use `trust`, command-line password arguments, or plaintext SQL files/logs. No other role attributes or memberships should change.
7. **Admin and test-role separation:** Use the bootstrap account only for cluster administration and read-only catalog verification. Keep `attendx_test_role` limited: no SUPERUSER, CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS, or unexpected memberships. After restart, use the new credentials for fresh SCRAM authentication and identity checks. Verify role attributes/memberships and database ownership via read-only SQL. Do not test old passwords; successful replacement of both role passwords is the invalidation action.
8. **Commit the credential-store replacement:** After new credential verification succeeds, atomically activate the protected replacement file and remove or retire the old ciphertext file only under the same explicit approval. File deletion cannot guarantee forensic erasure on all storage media; server-side password replacement is what invalidates old credentials. Keep the cluster data intact.
9. **Re-run Phase 14A preflight:** Only after rotation and a fresh identity check should the target database absence, role attributes, admin SQL identity, protected backup DACL, and a unique timestamped filename be rechecked. Phase 14A operations A–D still require their own separate explicit approval after that clean preflight.

## Actions requiring separate explicit approval

- Controlled stop/restart of only the isolated test cluster and offline password changes for both named roles.
- Generation and retention of new credentials; creation of a candidate DPAPI file, its DACL, activation/replacement of the current DPAPI file, and retirement/deletion of the old file.
- Optional cold physical cluster copy, including its exact destination and protected ACL.
- Any follow-up authenticated SQL verification, even if read-only, after credential rotation.
- Phase 14A operations A–D (database create, fixture apply, backup write, backup listing/checksum), separately after fresh preflight. This report does not grant those approvals.
- Any attempt to remove or redact the assistant tool output from a platform transcript, if the platform provides such a control.

## Read-only commands/checks used

```powershell
Get-Item 'D:\AttendX\PostgreSQL-Test\credentials.dpapi'
Get-Acl 'D:\AttendX\PostgreSQL-Test\credentials.dpapi'
& 'C:\Program Files\PostgreSQL\18\bin\postgres.exe' --version
& 'C:\Program Files\PostgreSQL\18\bin\pg_controldata.exe' 'D:\AttendX\PostgreSQL-Test\cluster'
Get-Content 'D:\AttendX\PostgreSQL-Test\cluster\postmaster.pid' -TotalCount 8
Get-CimInstance Win32_Process -Filter "Name='postgres.exe'"
Get-NetTCPConnection -LocalPort 55432
netstat -ano -p tcp | Select-String -SimpleMatch ':55432'
```

The DPAPI file's contents were not read, decrypted, copied, or hashed in this phase. No PostgreSQL connection was made. No port 5432 or existing service database was accessed. No ACL, credential, database, role, cluster, service, or application setting was changed.
