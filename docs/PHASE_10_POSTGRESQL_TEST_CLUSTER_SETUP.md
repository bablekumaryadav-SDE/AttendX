# Phase 10 — PostgreSQL test cluster setup

**Date:** 2026-11-05  
**Status:** COMPLETE (2026-11-09 recovery update below). Initial setup stopped after initialization; the separately approved offline recovery then completed identity, SCRAM, role, database, and privilege verification. The test cluster is currently running on loopback only.

## Approved target and binaries

- PostgreSQL binaries used: `C:\Program Files\PostgreSQL\18\bin\initdb.exe` (18.6). Read-only checks also confirmed `pg_ctl.exe` and `psql.exe` exist at that version.
- Cluster directory: `D:\AttendX\PostgreSQL-Test\cluster`.
- Port/listener: **NOT STARTED**; no TCP listener was reported for 55432 at a later read-only check. A pre-start port check was not run because startup was blocked before that step.
- Binding: planned startup override was `-h 127.0.0.1 -p 55432`; it has not been applied or verified.

## Initialization result

The approved parent directories and cluster directory were created. The target was confirmed absent immediately before creation. Initialization completed successfully using:

```powershell
& "$pgBin\initdb.exe" -D $target -U attendx_cluster_admin -A scram-sha-256 --pwfile=$pwFile --encoding=UTF8
```

`$pwFile` was a short-lived protected file under `D:\AttendX\PostgreSQL-Test`, with access restricted to the current Windows user; it was removed after `initdb` returned. The generated bootstrap password was not displayed or logged. `initdb` reported SCRAM-SHA-256 authentication, UTF-8 encoding, data checksums enabled, locale `English_American Samoa.1252`, and cluster-file owner `Asus`. `PG_VERSION` is 18. The directory remains intact; it has not been started or connected to.

## Blocker and operations not completed

The bootstrap password remained only in the short-lived command process and was not retained in a protected store. I cannot authenticate the required first connection. I stopped before starting the server rather than bypassing SCRAM or changing authentication beyond the explicit approval.

- Cluster identity SQL: **NOT TESTED**.
- Listening address/port: **NOT TESTED** (cluster process not started).
- `attendx_test_role`: **NOT CREATED**.
- `attendx_integration_test`: **NOT CREATED**.
- Role/database ownership and privileges: **NOT TESTED**.
- Existing Windows service: `postgresql-x64-18` remains Running/Automatic with the same service executable, data directory `C:\Program Files\PostgreSQL\18\data`, and account `NT AUTHORITY\NetworkService` observed before initialization.
- No application database, test URL, migration, backup, restore, or PostgreSQL application test was used/performed.

One initial script attempt stopped before invoking `initdb` because this runtime lacked `RandomNumberGenerator.GetBytes`; no password was generated or cluster initialized in that attempt. A corrected cryptographic-random implementation completed initialization. No assertion/test failure is involved; no regression suite was run in Phase 10.

## Initial setup blocker (historical; resolved 2026-11-09)

Phase 10 explicitly approved initialization, start, first identity connection, and role/database creation. Because the required bootstrap credential was not retained, those later steps cannot safely be completed with the current credential. Approve one recovery path before continuation:

1. A temporary, loopback-only HBA override for this isolated cluster to set a new bootstrap password, then stop and restore SCRAM-only authentication before the first verified connection; or
2. Reinitialize this new cluster, explicitly authorizing replacement of its current initialized contents and a protected way to retain the generated bootstrap credential.

No recovery, reinitialization, authentication override, service change, or database operation has been performed. The cluster directory and files are preserved.

## Phase 10 credential recovery review (2026-11-05; historical, superseded below)

**Status: BLOCKED before any authentication change or server start.** Read-only inspection confirmed the cluster path and expected markers (`PG_VERSION=18`, `postgresql.conf`, `pg_hba.conf`, `global\pg_control`). The `pg_hba.conf` SHA-256 is `0C8DC6E6E57399790417A6E13B3A8E1B5E27AA19708A2122148FBFE3BDCECD42`. Its host rules for IPv4 loopback and IPv6 loopback, plus local and replication rules, all use `scram-sha-256`. The file was not modified.

The newly approved recovery scope requires an HBA-only authentication override, while explicitly prohibiting `trust` and the original bootstrap password is unavailable. Every configured method currently requires credentials or an external identity/certificate mapping that is not authorized or configured. There is no compliant HBA-only way to authenticate as the cluster administrator and replace its password under these constraints. I did not edit `pg_hba.conf`, start the cluster, connect, reset a credential, or create the test role/database.

A separate explicit approval is required for an alternative recovery operation, such as an offline single-user password reset. The current instructions prohibit `trust`; do not use a temporary `trust` rule. Offline single-user recovery would occur before the requested first TCP identity query, so it also needs explicit approval. Preserve the cluster as initialized and stopped.

## Phase 10 offline recovery and isolated database setup — 2026-11-09

**Final status: PASS for approved cluster setup and verification.** Follow-on application testing and database operations remain outside scope.

### Approval and preflight

- Explicit approval obtained for offline single-user reset of `D:\AttendX\PostgreSQL-Test\cluster` and user-scoped DPAPI retention at `D:\AttendX\PostgreSQL-Test\credentials.dpapi`.
- PostgreSQL `postgres.exe`, `pg_ctl.exe`, `psql.exe`, and `pg_controldata.exe` verified as version 18.6.
- Exact cluster path was verified. `PG_VERSION=18`; `pg_controldata` reported system identifier `7704647215459077108` and state `shut down`; `postmaster.pid` was absent.
- The PostgreSQL worker process tree was associated with existing Windows service PID 5140. No other server process referenced/used the target. Service `postgresql-x64-18` remained Running/Automatic with its original service command and `C:\Program Files\PostgreSQL\18\data` directory.
- `pg_hba.conf` SHA-256 remained `0C8DC6E6E57399790417A6E13B3A8E1B5E27AA19708A2122148FBFE3BDCECD42`; no HBA rule or authentication file was modified. No `trust` rule was used.

### Recovery, credential storage, and listener

- **DPAPI storage: PASS.** Bootstrap and test-role passwords are retained only in `D:\AttendX\PostgreSQL-Test\credentials.dpapi`, encrypted with Windows PowerShell CurrentUser DPAPI. The ACL is protected from inheritance and has one FullControl entry for `LAPTOP-G6VAKMU3\Asus`. A same-user decrypt/round-trip check passed, and the on-disk ciphertext does not contain either plaintext password. No secret appears in this report or command output.
- **Offline reset: PASS.** Used PostgreSQL 18.6 single-user mode against only the exact test-cluster directory; set `password_encryption` to `scram-sha-256`, reset only `attendx_cluster_admin`, and verified the SCRAM verifier offline. The single-user process exited and the cluster was confirmed shut down before normal startup.
- **Loopback startup: PASS.** A fresh port-55432 check preceded startup. `pg_ctl` started only this data directory with `-h 127.0.0.1 -p 55432`. PostgreSQL's server log reported listening on IPv4 `127.0.0.1`, port `55432`, and ready for connections. Successful fresh SQL connections also verified this endpoint. The test server remains running only on loopback.
- **First identity/SCRAM connection: PASS.** Connected to maintenance database `postgres` as `attendx_cluster_admin`. SQL returned address `127.0.0.1`, port `55432`, data directory `D:\AttendX\PostgreSQL-Test\cluster`, system identifier `7704647215459077108`, and PostgreSQL 18.6. The HBA file remains SCRAM-only; the account has a SCRAM verifier and a fresh password-authenticated connection succeeded.

### Role and database verification

- **Role: PASS.** `attendx_test_role` has LOGIN; SUPERUSER, CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS, and INHERIT are all false. Its password verifier is SCRAM-SHA-256. A fresh login as this role succeeded.
- **Database: PASS.** `attendx_integration_test` is owned by `attendx_test_role`. The owner has CONNECT, CREATE, and TEMPORARY privileges required for isolated test schema setup. Public CONNECT and TEMPORARY privileges were revoked.
- A successful role connection returned database `attendx_integration_test`, user `attendx_test_role`, address `127.0.0.1`, port `55432`, and `password_encryption=scram-sha-256`. The role can create in the public schema. The admin-only `data_directory` setting was not requested from this restricted role; its exact value was verified from the bootstrap connection.

### Errors and corrections

Several verification attempts stopped the test cluster as the fail-closed checks required. These were tooling/assertion-shape issues, not identity mismatches: `Get-NetTCPConnection` returned no rows, so the server log plus SQL endpoint identity were used; a PowerShell regex capture variable collision and newline parsing mistake were corrected; `inet_server_addr()::text` includes `/32`, so `host(inet_server_addr())` was used; `pg_hba_file_rules.address` is text; and a role query initially asked the non-superuser for superuser-only `data_directory`. The test-role login itself succeeded. All retries were restricted to the isolated cluster; existing service configuration was not changed.

### Explicitly not performed

No application URL or `.env` change, application integration test, backup, restore, migration, rollback, College/Membership data operation, production access, install, build, cache clear, service change, system PATH change, Git commit, or push. Both tenant migration drafts remain DRAFT / NOT APPLIED. Legacy ownership remains UNKNOWN. These actions require separate approval.
