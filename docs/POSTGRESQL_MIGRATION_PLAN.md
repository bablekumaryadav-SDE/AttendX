# PostgreSQL Migration Readiness Plan

**Date:** 2026-11-04  
**Execution status:** No database connection, migration apply, write, reset, or drop was performed. Live schema and migration state are **UNKNOWN**.

## Files and order to review

There is no Alembic or central migration ledger in the inspected repository. Filenames alone do not establish what has already run. Proposed dependency order for a new, verified target:

1. `20261101_add_session_face_attendance.sql` — requires existing `students`, `classes`, `teachers`, `subjects`, `users`; adds enrollment, sessions, attendance events/audit and the unique session/student constraint.
2. `20261101_allow_session_close_method.sql` — depends on step 1's `attendance_events`; adjusts the allowed method constraint to include `session_close`. Inspect actual constraint names first because it drops two candidate names then adds one.
3. `20261103_add_notification_events_postgresql.sql` — requires `users` and `students`; creates notification table and indexes. It uses `IF NOT EXISTS`, but that does not reconcile a preexisting table with missing/wrong columns or constraints; compare the catalog before considering a rerun.
4. `20261104_add_classroom_gis_location_postgresql.sql` — alters existing `classes`; optional coordinate pair, range checks and `radius_m DEFAULT 100`. Existing out-of-range coordinates/radii or only-one-coordinate rows can make constraints fail. Existing `radius_m` is not overwritten by `ADD COLUMN IF NOT EXISTS`.
5. `20261105_add_student_guardians_postgresql.sql` — requires `students`; creates one row per student with cascade FK, allowed relationship/channel checks and phone index. `CREATE TABLE IF NOT EXISTS` does not reconcile a preexisting mismatched table; the guardian endpoint uses PostgreSQL `ON CONFLICT` syntax.

`20261103_add_notification_events_sqlite.sql` is a SQLite counterpart, not a PostgreSQL migration. Do not apply both dialect files to one PostgreSQL database.

## Safe pre-check (read-only) after explicit target authorization

1. Obtain an explicitly approved isolated PostgreSQL target; verify its database identity using a read-only connection and a separate credential. Do not reuse the local configured URL by assumption. Current live PostgreSQL state remains unknown.
2. Take a full custom-format backup, store it access-controlled on D:, calculate checksum, and test restore into a distinct scratch database before DDL. Example only after target approval and using protected environment variables:

   ```powershell
   pg_dump --format=custom --file 'D:\SecureBackups\attendx-pre-migration.dump' --dbname $env:APPROVED_ATTENDX_TEST_DATABASE_URL
   Get-FileHash 'D:\SecureBackups\attendx-pre-migration.dump' -Algorithm SHA256
   ```

3. Record PostgreSQL version, current database/schema identity, table/row counts, existing indexes, constraints, sequences and extensions. Check for an application migration ledger; this repository has none that was verified.
4. Compare `information_schema.columns`, `pg_constraint`, `pg_indexes`, defaults, FK targets/delete actions and check expressions to each migration's expected result. Do not rely on `IF NOT EXISTS` as a schema repair.
5. Before GIS constraints, query NULL-pair consistency, coordinate ranges and `radius_m` between 10 and 5000. Before guardian constraints, inspect existing `student_guardians` shape, duplicates/orphans and relationship/channel values. Before attendance unique index/table creation, inspect duplicate student/session data and source-table keys.
6. Review lock/rewrite risk and a maintenance window. Run SQL in dependency order against a restored isolated copy first; record checksums and outcomes. Only proceed on a separately approved test target and separately approved apply.

## Expected effects and compatibility

- Attendance migration creates tables/indexes and references existing integer IDs. Confirm the production PK types and FK names/types exactly match.
- Attendance unique constraint prevents multiple events per session/student, including manual updates; reconcile duplicates before applying rather than deleting automatically.
- GIS migration adds nullable coordinates and a non-null radius default; constraints reject partial/out-of-range coordinates and radius outside 10–5000 m.
- Guardian migration adds optional per-student contact records only; it does not add/alter `students`. Existing API expects relationship values `Father`, `Mother`, `Guardian`, `Brother`, `Sister`, `Other` and channels `sms_email`, `sms`, `email`.
- Notification migration uses `IF NOT EXISTS` for table/index creation but is not a schema-repair migration; inspect existing columns, indexes and constraints before considering execution.

## Rollback and recovery

- DDL files use transactions except the SQLite counterpart; validate transaction behavior on the target PostgreSQL version.
- A failure before commit should roll back transactional DDL. Keep logs and verify actual state after any interrupted session.
- After commit, do not run destructive reverse SQL automatically. Restore the verified backup to a separate database and validate application data. For additive GIS columns/tables with writes already received, prefer a forward repair or restore plan; dropping a populated guardian/notification/attendance table loses data.
- Restore procedure: stop writes/ingress, preserve failed DB snapshot/logs, restore backup to a new database, verify counts/constraints/application smoke tests, then obtain explicit cutover approval. Never overwrite the only backup.

## Current status

All listed SQL files are present in source and inspected. None was applied in this audit. No PostgreSQL test target/credential was supplied, so migration execution, catalog pre-check, live schema compatibility and restore drill are **NOT TESTED**.

## Phase 9 — isolated PostgreSQL test setup and command plan

**Execution: NOT TESTED.** PostgreSQL client/server tools were unavailable in this environment. No production or development URL was used. The commands below target only a new local cluster on `127.0.0.1:55432`; never change those values to a production server. Run on a host with PostgreSQL binaries. Keep cluster data and dumps on D:. Passwords must be entered at hidden prompts; do not put them in a URL, command history, script, or report.

### 1. Create a fresh isolated local cluster

```powershell
$pgRoot = 'D:\AttendX-pg-test'
$pgData = Join-Path $pgRoot 'cluster'
if (Test-Path $pgData) { throw 'Target exists; choose a new test path.' }
New-Item -ItemType Directory -Path $pgRoot | Out-Null
initdb -D $pgData -U postgres --auth=scram-sha-256 --pwprompt
pg_ctl -D $pgData -o '-h 127.0.0.1 -p 55432' -l (Join-Path $pgRoot 'postgres.log') start
createdb -h 127.0.0.1 -p 55432 -U postgres -W attendx_migration_test
```

`initdb` creates a new empty cluster; do not point it at an existing directory. Use a separate test-only password. These commands do not need or use the application `.env`.

Set target parameters and verify identity before any SQL:

```powershell
$env:PGHOST = '127.0.0.1'
$env:PGPORT = '55432'
$env:PGUSER = 'postgres'
$env:PGDATABASE = 'attendx_migration_test'
psql -W -v ON_ERROR_STOP=1 -Atc 'SELECT current_database(), inet_server_addr(), inet_server_port()'
```

Expected identity: `attendx_migration_test`, loopback address, port `55432`. If it differs, stop. Do not use `backend/create_tables.py`: it uses the configured app DB engine and prints database host/name.

### 2. Prepare migration prerequisites

The SQL files require legacy `users`, `students`, `teachers`, `subjects`, `classes` tables. Prefer a sanitized schema-only dump from an approved **separate test environment**. Without one, the following parent-table stubs validate SQL ordering, syntax and FK mechanics only; they do not prove application-schema compatibility:

```powershell
$baselinePath = 'D:\AttendX-pg-test\migration-prerequisites.sql'
if (Test-Path $baselinePath) { throw 'Choose a new SQL file path; preserve the existing file.' }
$baseline = @(
  'CREATE TABLE users (id INTEGER PRIMARY KEY);',
  'CREATE TABLE students (id INTEGER PRIMARY KEY);',
  'CREATE TABLE teachers (id INTEGER PRIMARY KEY);',
  'CREATE TABLE subjects (id INTEGER PRIMARY KEY);',
  'CREATE TABLE classes (id INTEGER PRIMARY KEY);'
)
[System.IO.File]::WriteAllLines($baselinePath, [string[]]$baseline, [System.Text.UTF8Encoding]::new($false))
psql -W -v ON_ERROR_STOP=1 -f $baselinePath
```

### 3. Backup, pre-check, apply in order

After confirming test DB identity, create a new backup path (never overwrite an existing dump):

```powershell
$backup = 'D:\AttendX-pg-test\attendx-migration-test-before.dump'
if (Test-Path $backup) { throw 'Backup exists; choose a new path and preserve the existing backup.' }
pg_dump -h 127.0.0.1 -p 55432 -U postgres -W -Fc -f $backup attendx_migration_test
Get-FileHash -LiteralPath $backup -Algorithm SHA256
pg_restore --list $backup
```

Read-only pre-checks on the isolated target:

```powershell
psql -W -v ON_ERROR_STOP=1 -c "SELECT current_database(), current_schema(), version();"
psql -W -v ON_ERROR_STOP=1 -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;"
psql -W -v ON_ERROR_STOP=1 -c "SELECT conrelid::regclass AS table_name, conname, contype FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY 1,2;"
```

Apply the five PostgreSQL files individually, stopping at the first error. Each includes its own transaction. Skip `20261103_add_notification_events_sqlite.sql`.

```powershell
$migrations = @(
  'database\migrations\20261101_add_session_face_attendance.sql',
  'database\migrations\20261101_allow_session_close_method.sql',
  'database\migrations\20261103_add_notification_events_postgresql.sql',
  'database\migrations\20261104_add_classroom_gis_location_postgresql.sql',
  'database\migrations\20261105_add_student_guardians_postgresql.sql'
)
foreach ($migration in $migrations) {
  psql -W -v ON_ERROR_STOP=1 -f $migration
  if ($LASTEXITCODE -ne 0) { throw 'Migration failed; stop and inspect the test DB state.' }
}
```

Run from repository root. These steps do not authorize a live/production apply.

### 4. Verify schema and rehearse restore

```powershell
psql -W -v ON_ERROR_STOP=1 -c "SELECT to_regclass('public.student_class_assignments'), to_regclass('public.attendance_sessions'), to_regclass('public.attendance_events'), to_regclass('public.attendance_audit_logs'), to_regclass('public.notification_events'), to_regclass('public.student_guardians');"
psql -W -v ON_ERROR_STOP=1 -c "SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('classes','student_guardians') ORDER BY table_name,ordinal_position;"
psql -W -v ON_ERROR_STOP=1 -c "SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY 1,2;"
psql -W -v ON_ERROR_STOP=1 -c "SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname;"
```

Confirm expected relations, GIS columns/checks, guardian checks/index, attendance unique/method constraints and foreign keys. Run API integration tests only against a full isolated schema, never the minimal stubs. To test recovery without deleting or overwriting the migrated test DB, restore the pre-migration backup into a new database:

```powershell
createdb -h 127.0.0.1 -p 55432 -U postgres -W attendx_migration_restore_check
pg_restore -h 127.0.0.1 -p 55432 -U postgres -W --no-owner --dbname attendx_migration_restore_check $backup
psql -h 127.0.0.1 -p 55432 -U postgres -W -d attendx_migration_restore_check -c 'SELECT current_database();'
```

Do not drop either test DB in this procedure. After preserving logs and dumps, stop only the isolated cluster with `pg_ctl -D $pgData stop`.

### Migration readiness status

- Migration source order/dependencies: **PASS — reviewed**.
- Separate PostgreSQL test DB setup instructions: **PASS — documented**.
- Actual isolated PostgreSQL provision, apply, schema verification and restore drill: **NOT TESTED** (utilities/server unavailable).
- Production DB access or migration apply: **NOT PERFORMED**; explicit approval remains required.
