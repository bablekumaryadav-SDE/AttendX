# PostgreSQL Backup and Restore Rehearsal

This guide describes a future isolated rehearsal. No backup or restore was performed in Phase 4, and no backup is claimed to be verified.

## Preconditions

- Obtain explicit authorization and identify the source database/owner without relying on a local `.env` alone.
- Confirm the source is the intended environment and that a consistent backup is permitted. For any production source, follow its approved change, privacy, and retention process.
- Confirm sufficient protected disk space and an isolated, empty restore target with a different database name, cluster/port, and credentials.
- Store backup artifacts and hashes in access-controlled storage. Do not put database data, secrets, or biometric data in Git.

## Rehearsal sequence

1. Record source identity, server/version, database, time, operator, approval, and expected recovery point in the controlled rehearsal record.
2. Create a new custom-format dump using the approved source credentials and a unique output filename on an approved protected volume. Use password prompting or a protected password file; do not embed passwords in command arguments.
3. Compute a cryptographic checksum and inspect the archive listing. Preserve the original dump as read-only; do not overwrite the only copy.
4. Create a fresh, separately named restore database on the isolated test cluster. Verify its identity before restore.
5. Restore into that empty test database with errors treated as failure, without owner/privilege replay. Do not use `--clean` or `--create`; never target the source database.
6. Verify schema objects, migration version, row counts, primary-key set hashes, FK/orphan checks, and application-level smoke behavior in the restored copy. Sanitize all reports.
7. Record command versions, results, duration, errors, checksums, and reviewer sign-off. A successful restore is demonstrated only by the completed verification record, not by dump creation alone.

## Failure handling

On any failure, stop. Preserve the source and original backup unchanged. Quarantine the failed restore database for investigation; do not retry by dropping or overwriting a database until its identity and ownership are verified. A retry uses a newly created target. Escalate any source impact or ambiguous target identity through the owning operations process.

## Phase 4 result

Backup/restore rehearsal: **NOT TESTED**. PostgreSQL tools were unavailable, no database was connected, no backup was created, and no restore was attempted.

## Phase 7 result

The PostgreSQL 18 Windows service was found running, but no database/cluster identity or disposable restore target was verified. `pg_dump`/`pg_restore` and `psql` were unavailable on PATH. Backup/restore remains **BLOCKED / NOT TESTED**; no backup command, database creation, restore, or cleanup was run. See `POSTGRESQL_BACKUP_RESTORE_RESULTS.md` for evidence and the exact status matrix.

## Phase 8 future rehearsal commands (NOT RUN)

These commands are templates only. Before using them, receive separate approval to connect and create/provision the test/restore databases, positively verify both identities, and configure a protected `pg_service.conf` plus ACL-restricted `PGPASSFILE`. Do not place a password or URL containing a password in the command line. Use a unique backup path and preserve the original database and dump.

```powershell
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$env:PGSERVICEFILE = '<protected-local-path>\pg_service.conf'
$env:PGPASSFILE = '<protected-local-path>\pgpass.conf'
$sourceService = 'attendx_phase8_test'       # provisioned disposable source
$restoreService = 'attendx_phase8_restore'   # separate empty disposable target
$backupFile = Join-Path 'D:\Temp' ("attendx_test_{0}.dump" -f (Get-Date -Format 'yyyyMMdd_HHmmss'))

# Confirm source identity before backup; inspect only a verified test service.
& "$pgBin\psql.exe" --no-psqlrc --set=ON_ERROR_STOP=1 --dbname="service=$sourceService" --command="SELECT current_database(), inet_server_addr(), inet_server_port();"
if ($LASTEXITCODE -ne 0) { throw 'Source identity check failed.' }

# Refuse to overwrite any prior backup artifact.
if (Test-Path -LiteralPath $backupFile) { throw 'Backup output already exists.' }
& "$pgBin\pg_dump.exe" --format=custom --no-owner --no-privileges --file="$backupFile" --dbname="service=$sourceService"
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed.' }
Get-Item -LiteralPath $backupFile | Select-Object FullName,Length
Get-FileHash -LiteralPath $backupFile -Algorithm SHA256
& "$pgBin\pg_restore.exe" --list "$backupFile"
if ($LASTEXITCODE -ne 0) { throw 'Backup archive listing failed.' }

# Restore only into a separately verified, pre-created empty restore database.
# Do not add --clean or --create; this never targets the source service.
& "$pgBin\psql.exe" --no-psqlrc --set=ON_ERROR_STOP=1 --dbname="service=$restoreService" --command="SELECT current_database(), inet_server_addr(), inet_server_port();"
if ($LASTEXITCODE -ne 0) { throw 'Restore target identity check failed.' }
& "$pgBin\pg_restore.exe" --exit-on-error --no-owner --no-privileges --dbname="service=$restoreService" "$backupFile"
if ($LASTEXITCODE -ne 0) { throw 'Restore failed; preserve source and backup, and stop.' }

# Run the same read-only verification on source and restore, record outputs,
# then rerun on source to confirm it stayed unchanged.
$verifySql = "SELECT 'users' AS table_name, count(*) FROM users UNION ALL SELECT 'colleges', count(*) FROM colleges UNION ALL SELECT 'college_memberships', count(*) FROM college_memberships; SELECT count(*) AS memberships_without_college FROM college_memberships m LEFT JOIN colleges c ON c.id=m.college_id WHERE c.id IS NULL; SELECT count(*) AS memberships_without_user FROM college_memberships m LEFT JOIN users u ON u.id=m.user_id WHERE u.id IS NULL;"
& "$pgBin\psql.exe" --no-psqlrc --set=ON_ERROR_STOP=1 --dbname="service=$sourceService" --command=$verifySql
& "$pgBin\psql.exe" --no-psqlrc --set=ON_ERROR_STOP=1 --dbname="service=$restoreService" --command=$verifySql
& "$pgBin\psql.exe" --no-psqlrc --set=ON_ERROR_STOP=1 --dbname="service=$sourceService" --command=$verifySql
```

Compare the three source/restore outputs for exact counts and zero orphan relationships. Record database/server identity, schema/migration version, backup hash, command versions and reviewer in the controlled rehearsal record. Stop on any mismatch. Do not drop the source, restore target, or backup as cleanup; any later cleanup requires separate target verification and explicit approval.
