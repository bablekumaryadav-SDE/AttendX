# Phase 7 — Isolated PostgreSQL Migration and Restore Rehearsal

**Status: BLOCKED.** PostgreSQL is installed as a running Windows service, but no dedicated disposable database identity was verified. Client/backup utilities were not on PATH. No connection, database creation/drop, backup, restore, or migration was attempted.

## Read-only environment evidence

| Check | Result |
|---|---|
| PostgreSQL Windows service | `postgresql-x64-18`, **Running**. This proves a server service exists, not that its cluster/database is disposable. |
| `postgres`, `psql`, `pg_dump`, `pg_restore`, `initdb`, `pg_ctl`, `createdb` | **NOT_FOUND** via `Get-Command`. |
| Docker | **NOT_FOUND**. |
| Dedicated test connection setting | No `TEST_DATABASE_URL`/`TEST_POSTGRES_URL` in `backend/.env`; no process-level `DATABASE_URL` or `TEST_DATABASE_URL` was set. The existence/presence of the normal `backend/.env` `DATABASE_URL` key was checked without reading or printing its value. |
| Server/database identity | **UNKNOWN / NOT VERIFIED**. No connection was made; the running service was not assumed to be safe or disposable. |
| Disk space | C: **2,102,861,824 bytes free**; D: **264,111,865,856 bytes free** from `cmd /c dir`. `Get-CimInstance Win32_LogicalDisk` was denied by the environment; the `dir` fallback succeeded. |

The only non-secret identity evidence recorded is the Windows service name/status. The server's cluster path, database name, owner, role, host/port, schema/search path, and data contents remain unknown. The configured application database URL was not displayed or used.

## Rehearsal outcome

Backup and restore: **BLOCKED / NOT TESTED**. Synthetic PostgreSQL dataset: **NOT CREATED**. Draft migration application and rollback: **NOT RUN**. PostgreSQL application tests: **NOT TESTED**. No database identity was available to establish a safe separate target, and no client/dump tools were present on PATH. No automatic tool installation or database creation was attempted.

## Safe next step

An authorized operator must provide or explicitly approve a dedicated test cluster/database and test-only role, verify its non-secret identity (database name, loopback address, port, server version, and schema/search path), and make PostgreSQL client/dump tools available. Then separately authorize backup, restore into a new database, and migration rehearsal. The running service by itself is not adequate evidence of isolation.

Static SQL review is recorded in `TENANT_MIGRATION_SQL_REVIEW.md`; PostgreSQL limitations are in `POSTGRESQL_COMPATIBILITY_REPORT.md`. Both migration files remain **DRAFT / NOT APPLIED**.

## Commands executed

Read-only readiness checks (PowerShell):

```powershell
$names = 'postgres','psql','pg_dump','pg_restore','initdb','pg_ctl','createdb','docker'
foreach ($name in $names) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { "$name=FOUND" } else { "$name=NOT_FOUND" }
}
Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'postgres' -or $_.DisplayName -match 'postgres' } | Select-Object Name,Status,DisplayName
cmd /c dir C:\
cmd /c dir D:\
```

The `.env` check read only the file in memory and printed booleans for presence of `DATABASE_URL` and dedicated test URL keys; it did not print values. Static PostgreSQL-dialect compilation and final regression commands are recorded in `TENANT_MIGRATION_SQL_REVIEW.md` and `TEST_RESULTS.md`.
