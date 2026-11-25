# Phase 14A — Disposable Tenant Migration Database Preparation

**Date:** 2026-11-09
**Overall:** **BLOCKED at approval gate.** Read-only cluster/database preflight passed, but the requested backup directory is not protected. No approval request for the combined A–D bundle is actionable until that storage blocker is resolved.

## Read-only preflight

| Check | Status | Finding |
|---|---|---|
| PostgreSQL version | PREFLIGHT PASS | `postgres.exe --version` reports PostgreSQL 18.6. |
| Exact server process | PREFLIGHT PASS | Elevated read-only process query: PID 2452, executable `C:\Program Files\PostgreSQL\18\bin\postgres.exe`, command line `-D D:/AttendX/PostgreSQL-Test/cluster -h 127.0.0.1 -p 55432`. `pg_ctl status` reports the same PID and options. |
| Cluster directory / system identifier | PREFLIGHT PASS | Exact data directory is `D:\AttendX\PostgreSQL-Test\cluster`; `PG_VERSION=18`; `pg_controldata` system identifier is `7704647215459077108`, matching Phase 10–13 documentation. `pg_controldata` says `in production`; process, `pg_ctl`, data directory, and endpoint checks independently confirm the running server. |
| Endpoint / service separation | PREFLIGHT PASS | Loopback TCP probe to `127.0.0.1:55432` succeeded. The existing service `postgresql-x64-18` is Running/Automatic and configured for `C:\Program Files\PostgreSQL\18\data`; its service PID 5140 and postmaster PID 7628 differ from target PID 2452. No connection or TCP probe was sent to port 5432; no service setting or process was changed. |
| Live SQL identity | PREFLIGHT PASS | Read-only connection to maintenance database `postgres` as `attendx_cluster_admin` returned server `127.0.0.1:55432`, data directory `D:/AttendX/PostgreSQL-Test/cluster`, system ID `7704647215459077108`, and version `18.6`. DPAPI credentials were used in process memory only; no credential was printed or placed on the command line. |
| Proposed database absence | PREFLIGHT PASS | Read-only `pg_database` check returned `target_exists=false` for `attendx_tenant_migration_verify_20261109`. It was not created. |
| Test role | PREFLIGHT PASS | `attendx_test_role` exists, LOGIN true; SUPERUSER, CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS, INHERIT all false; role memberships are empty. It cannot create a database under its current documented least-privilege attributes. If A is later approved, only the bootstrap cluster administrator can perform `CREATE DATABASE ... OWNER attendx_test_role`; use the test role for fixture and backup work where its privileges suffice. No privilege change is proposed. |
| Fixture | PREFLIGHT PASS | `database/fixtures/phase13b_tenant_users_schema.sql` exists and exactly matches the reviewed Phase 13B fixture: one `CREATE TABLE public.users (id INTEGER NOT NULL, PRIMARY KEY (id));`, with comments only, no data statements. SHA-256: `48A2A04871299E758A235C6991C4C2737DEA7D3684EF7457BB59E38DE8BF7A4B`. It has not been applied. |
| Proposed backup path/collision | BLOCKED | Proposed exact file is `D:\AttendX\PostgreSQL-Test\backups\attendx_tenant_migration_verify_20261109_phase14a.dump`; the directory exists and that exact file is absent. However, the directory ACL is inheritable (`AreAccessRulesProtected=false`) and grants `NT AUTHORITY\Authenticated Users` **Modify**. Therefore the directory is not protected as required. No file was written and no ACL was changed. |
| Application URL isolation | PREFLIGHT PASS | `backend/.env` and `frontend/.env` contain no reference to the proposed database name. Process variables `DATABASE_URL`, `ATTENDX_TEST_DATABASE_URL`, `TEST_DATABASE_URL`, `TEST_POSTGRES_URL`, and `APP_DATABASE_URL` are unset. URL values were not displayed. |

## Approval gate status

| Operation | Status | Planned actor/effect |
|---|---|---|
| A. Create `attendx_tenant_migration_verify_20261109`, owned by `attendx_test_role` | AWAITING APPROVAL | Would require `attendx_cluster_admin` for `CREATE DATABASE`, because the test role has `CREATEDB=false`; owner would be `attendx_test_role`. Target absence must be rechecked immediately before execution. |
| B. Apply only the reviewed zero-row Phase 13B fixture | AWAITING APPROVAL | Would use `attendx_test_role` against the new database. No row insertion. |
| C. Create custom-format backup at the exact path above | BLOCKED | Do not write while `Authenticated Users` has inherited Modify access. The directory ACL must be made appropriately restricted outside this read-only phase, or a separately reviewed protected destination must be specified. |
| D. Run `pg_restore --list` and record SHA-256 | AWAITING APPROVAL / BLOCKED WITH C | Depends on creating the approved backup at a protected destination. |

**No A, B, C, or D operation was performed.** No target database/table, backup, or restore was created. No migration DDL, production/application database, port 5432, Phase 11 database, or Windows service was accessed for modification. The current database connection was limited to read-only identity/catalog queries on the isolated server's `postgres` maintenance database.

## Exact operations after the storage blocker is resolved

1. Re-run the read-only identity, role, target-absence, fixture, and backup ACL/collision checks. Stop on any mismatch.
2. After separate explicit approval, use `attendx_cluster_admin` only to create the absent target database with owner `attendx_test_role`; do not grant the test role CREATEDB.
3. After separate explicit approval, connect as `attendx_test_role`, apply only the reviewed zero-row `public.users(id INTEGER PRIMARY KEY)` fixture, then verify the table, integer type, primary key, and zero-row count.
4. After separate explicit approval, create the custom-format backup as `attendx_test_role` at the protected exact path; refuse if the file exists.
5. Run `pg_restore --list` on that artifact and calculate SHA-256. Do not restore it in Phase 14A.

These actions require explicit approval after the protected backup destination passes preflight. This report does not grant approval. The tenant migration itself remains **NOT TESTED / NOT APPLIED** and is outside Phase 14A.
