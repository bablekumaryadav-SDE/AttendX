# Phase 11 — Isolated PostgreSQL backup and restore rehearsal

**Date:** 2026-11-09
**Approval:** PASS — explicit approval received for the exact source, backup path, and restore database.
**Overall:** PASS for isolated backup, restore, and verification. No application/production database was used.

## Approved target identities

| Item | Verified value |
|---|---|
| PostgreSQL | 18.6 |
| Cluster directory | `D:\AttendX\PostgreSQL-Test\cluster` |
| Cluster system identifier | `7704647215459077108` |
| Server endpoint | `127.0.0.1:55432` (loopback only) |
| Source database / owner | `attendx_integration_test` / `attendx_test_role` |
| Restore database / owner | `attendx_restore_verify_20261109_133428` / `attendx_test_role` |
| Backup artifact | `D:\AttendX\PostgreSQL-Test\backups\attendx_integration_test_phase11_20261109_133428.dump` |
| Credential handling | Credentials read through approved CurrentUser DPAPI file and supplied only to short-lived PostgreSQL client processes; no secrets in report or command line. |

## Backup result

- **PASS:** Before backup, a fresh SQL identity check confirmed host `127.0.0.1`, port `55432`, exact test data directory and system identifier. Source connection used `attendx_test_role`; source owner matched.
- **PASS:** Backup directory was created outside the repository because it did not exist. The exact approved artifact was absent before creation.
- **PASS:** Custom-format `pg_dump` completed. `pg_restore --list` accepted the archive.
- **Size:** 1,167 bytes.
- **Timestamp:** 2026-11-09 13:40:33 (local Asia/Calcutta time).
- **SHA-256:** `03838FCE5FBF61D6645385BF64186605955401517CB04D3AFFB59E72D1786134`.

## Restore result

- **PASS:** A live admin query confirmed the exact restore database name was absent before creation. The new database was created with `attendx_test_role` as owner; public CONNECT and TEMPORARY were revoked. Before restore it contained zero user relations, routines, and custom types.
- **PASS:** `pg_restore` restored the custom archive into the separate target, using `--no-owner --no-privileges --exit-on-error`. No `--clean` or `--create` option was used. The original source database was not overwritten.
- **PASS:** Fresh connections as `attendx_test_role` to both source and restore databases verified their distinct database names, same role, loopback address, port 55432, and SCRAM setting.
- **PASS:** Source and restored catalog signatures match. Both contain one user schema (`public`), zero user relations (tables/views/sequences), zero user routines, and zero custom enum/domain/range/multirange types. There were no user tables, therefore no user-table row counts to compare. The empty source state is consistent with Phase 10, where no application tests or migrations ran.
- **PASS:** Both databases are owned by `attendx_test_role`. It retains database CONNECT/CREATE/TEMPORARY access; public CONNECT/TEMPORARY are revoked. The role remains non-superuser and has no CREATEDB, CREATEROLE, REPLICATION, or BYPASSRLS attributes.

## Isolation and service checks

- Target cluster is still running only at `127.0.0.1:55432`; `pg_ctl` reports the exact D: data directory and port arguments.
- Existing service `postgresql-x64-18` remains Running/Automatic with its original C: data directory and service configuration. It was not stopped, restarted, or modified; port 5432 was not used.
- No `.env` or test URL changes, application tests, migrations, backup of any other database, production connection, role/user/College change, build, install, cache clear, commit, or push occurred.
- Both tenant migration drafts remain DRAFT / NOT APPLIED; legacy data ownership remains UNKNOWN. This rehearsal does not establish application or production readiness.

## Exact operations (PowerShell command forms)

All client processes used PostgreSQL 18.6 binaries under `C:\Program Files\PostgreSQL\18\bin`. Passwords were supplied from the DPAPI store via short-lived process environment, not command arguments.

```powershell
& "$pgBin\pg_dump.exe" --format=custom --host 127.0.0.1 --port 55432 --username attendx_test_role --dbname attendx_integration_test --file $backupPath -w
& "$pgBin\pg_restore.exe" --list $backupPath
& "$pgBin\createdb.exe" --host 127.0.0.1 --port 55432 --username attendx_cluster_admin --owner attendx_test_role --no-password $restoreDb
# Through psql -f - as attendx_cluster_admin:
REVOKE CONNECT, TEMPORARY ON DATABASE attendx_restore_verify_20261109_133428 FROM PUBLIC;
& "$pgBin\pg_restore.exe" --host 127.0.0.1 --port 55432 --username attendx_test_role --dbname $restoreDb --no-owner --no-privileges --exit-on-error -w $backupPath
```

Read-only SQL gates verified the source endpoint, cluster identifier, source owner and restore-database absence before target creation; post-restore catalog signatures, endpoint, owner, and privileges were compared before completion.
