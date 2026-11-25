# Proposed isolated PostgreSQL test cluster plan

**Status: PHASE 10 SETUP COMPLETE (2026-11-09).** The approved isolated cluster is initialized, has a DPAPI-protected user-scoped credential file, and is running only on `127.0.0.1:55432`. Identity, SCRAM, role, and database privileges were verified. The test URL remains unconfigured; application integration tests, migration, backup, and restore remain NOT TESTED and need separate approval. The existing `postgresql-x64-18` cluster remains **NOT SAFE TO REUSE**; its identity is UNKNOWN.

The command sketches below are historical planning material. Phase 10 completed the approved initialization/start/role/database steps. Do not rerun creation commands against the existing target. Consult `PHASE_10_POSTGRESQL_TEST_CLUSTER_SETUP.md` for actual results; any later database operation still needs its own approval.

## Proposed target

| Purpose | Proposed value |
|---|---|
| PostgreSQL binaries | `C:\Program Files\PostgreSQL\18\bin` (version 18.6; use absolute paths, no PATH change) |
| Separate cluster data directory | `D:\AttendX\PostgreSQL-Test\cluster` |
| Local-only test port | `55432` (no listener observed at discovery time; recheck before setup/start) |
| Cluster bootstrap administrator | `attendx_cluster_admin` (only for this disposable cluster) |
| Application integration-test role | `attendx_test_role` (separate, non-superuser role) |
| Test database | `attendx_integration_test` |
| Backup directory | `D:\AttendX\PostgreSQL-Test\backups` |
| Restore database convention | `attendx_integration_restore_YYYYMMDD_HHMMSS` |
| Process/service model | Manually run `pg_ctl` as the approved interactive Windows user. Do not register or modify a Windows service. Bind only to `127.0.0.1`. |

D: currently has about 264 GB free from the previous read-only check. The proposed directories do not exist. D: root ACL lists Modify for Authenticated Users, but effective access for the eventual operator was not proven. The operator must have write/modify rights on D:; do not elevate or adjust ACLs without separate approval. The cluster should be initialized and run by the same Windows account so its ownership and file permissions remain consistent.

## Historical setup sketch (already completed; do not rerun)

These commands document the proposed initialization that was subsequently approved and completed. The cluster directory is no longer absent; do not execute this block again. Later start/stop operations must target only the exact data directory and loopback port described above.

```powershell
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$cluster = 'D:\AttendX\PostgreSQL-Test\cluster'
$backupDir = 'D:\AttendX\PostgreSQL-Test\backups'
$testPort = 55432

# Recheck immediately before setup; stop if cluster directory exists or port is occupied.
Test-Path -LiteralPath 'D:\AttendX'
Test-Path -LiteralPath 'D:\AttendX\PostgreSQL-Test'
Test-Path -LiteralPath $cluster
Test-Path -LiteralPath $backupDir
Get-NetTCPConnection -State Listen -LocalPort $testPort -ErrorAction SilentlyContinue

# After approval only: create the two new directories, then initialize this new cluster.
New-Item -ItemType Directory -Path 'D:\AttendX'
New-Item -ItemType Directory -Path 'D:\AttendX\PostgreSQL-Test'
New-Item -ItemType Directory -Path $cluster
New-Item -ItemType Directory -Path $backupDir
& "$pgBin\initdb.exe" -D $cluster -U attendx_cluster_admin -A scram-sha-256 -W --encoding=UTF8

# After separate approval to start it: bind only to loopback and use the selected port.
& "$pgBin\pg_ctl.exe" -D $cluster -l "$cluster\server.log" -o "-h 127.0.0.1 -p $testPort" -w start
```

`initdb -W` prompts for a bootstrap password; do not put a password in a command, script, repository, or report. `pg_ctl` starts a separate process; it does not change the existing Windows service. Do not use `pg_ctl register`.

## Positively identify before creating any role/database or running tests

The first connection itself requires approval. After separately approved initialization and startup, use the bootstrap credentials at a protected prompt and run this identity query before any database operation:

```powershell
& "$pgBin\psql.exe" -X -h 127.0.0.1 -p 55432 -U attendx_cluster_admin -d postgres -Atc "SELECT current_database(), inet_server_addr(), inet_server_port(), current_setting('data_directory'), version();"
```

Proceed only if the output identifies database `postgres`, address `127.0.0.1`, port `55432`, data directory `D:\AttendX\PostgreSQL-Test\cluster` (compare paths after normalizing slash direction), and PostgreSQL 18.6. If any value differs, stop. Re-run this identity check before role/database creation, test-suite use, backup, restore, or migration rehearsal. `pg_ctl -D $cluster status` alone is not enough to identify the connected server.

## Role, database, and test URL (separate approval required)

After explicit approval for these exact operations and after positive identity verification:

```powershell
& "$pgBin\createuser.exe" --host 127.0.0.1 --port 55432 --username attendx_cluster_admin --no-superuser --no-createdb --no-createrole --no-replication --pwprompt attendx_test_role
& "$pgBin\createdb.exe" --host 127.0.0.1 --port 55432 --username attendx_cluster_admin --owner attendx_test_role attendx_integration_test
```

`createuser --pwprompt` prompts for the test role password. Provision `ATTENDX_TEST_DATABASE_URL` only in a protected process environment or secret store, using the approved `127.0.0.1:55432/attendx_integration_test` endpoint and test-only role. Do not echo or commit the value. The existing application `DATABASE_URL` is never to be used as a test fallback. The helper checks URL identity and naming but cannot prove that a cluster is disposable.

## Backup and restore conventions (separate approval required)

Use a new timestamped custom-format file and never overwrite/delete an existing backup. Recheck and query target identity first.

```powershell
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$backup = Join-Path $backupDir "attendx_integration_test_$stamp.dump"
& "$pgBin\pg_dump.exe" --format=custom --host 127.0.0.1 --port 55432 --username attendx_test_role --dbname attendx_integration_test --file $backup
& "$pgBin\pg_restore.exe" --list $backup
$restoreDb = "attendx_integration_restore_$stamp"
& "$pgBin\createdb.exe" --host 127.0.0.1 --port 55432 --username attendx_cluster_admin --owner attendx_test_role $restoreDb
& "$pgBin\pg_restore.exe" --host 127.0.0.1 --port 55432 --username attendx_test_role --dbname $restoreDb --no-owner --no-privileges $backup
```

Restoring creates a separate database; verify its name and contents with approved read-only queries. Do not use `--clean`, `--create`, or any command that overwrites a target. Approval for backup does not automatically authorize restore or migration.

## Stop and preserve

After separately approved use, verify the exact `-D` directory and stop only this manually started test cluster:

```powershell
& "$pgBin\pg_ctl.exe" -D 'D:\AttendX\PostgreSQL-Test\cluster' status
& "$pgBin\pg_ctl.exe" -D 'D:\AttendX\PostgreSQL-Test\cluster' -m fast -w stop
```

Preserve the cluster directory and all backups. Do not remove files or register a service. Before a later restart, repeat the port and identity checks. Any cleanup/deletion requires separate explicit approval.

## Risks and required permissions

- Port 55432 was free only at discovery time; recheck it immediately before startup.
- The existing service uses port 5432 and `listen_addresses='*'`; the test process must explicitly bind `127.0.0.1` and port 55432.
- The operator needs D: write/modify access to create and maintain the cluster and backup directories. `initdb` creates a new cluster; data loss is possible if the chosen directory is wrong or later removed. The proposal uses a new absent path and prohibits deletion/overwrite.
- The operator must protect bootstrap and test-role passwords. Do not grant the runtime test role superuser, database creation, role creation, replication, or access to the application database.
- A port, directory, or URL label is not proof of target identity. Verify the connected server's address, port, data directory, database name, and version before each approved operation.
- Windows service changes, system PATH changes, ACL changes, applying migrations, legacy ownership backfill, and operations on the existing cluster are outside this proposal and require separate explicit review/approval.

## Exact operations requiring approval

1. Create `D:\AttendX\PostgreSQL-Test\cluster` and `D:\AttendX\PostgreSQL-Test\backups`, then initialize the separate cluster with PostgreSQL 18.6.
2. Start/stop the standalone test `pg_ctl` process on loopback port 55432.
3. Make the first PostgreSQL connection and run the identity query.
4. Create `attendx_test_role` and `attendx_integration_test`.
5. Set the protected test URL and run PostgreSQL integration tests.
6. Create a backup, restore it into the timestamped restore database, and run verification queries.
7. Any migration rehearsal or rollback is a separate approval; no migration is included in Phase 9 setup approval.

No item above has been performed. Existing application database, service settings, PATH, drafts, and legacy records remain untouched.
