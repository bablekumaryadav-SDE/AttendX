# PostgreSQL Backup and Restore Results

**Status: BLOCKED / NOT TESTED.** No database was connected, no synthetic PostgreSQL data was created, and no backup or restore was attempted.

## Blocking evidence

- The PostgreSQL service `postgresql-x64-18` is running, but its cluster/database identity is unknown. No verified disposable database or restore target was provided.
- PostgreSQL 18.6 `psql`, `pg_dump`, `pg_restore`, `initdb`, `pg_ctl`, and `createdb` binaries exist under `C:\Program Files\PostgreSQL\18\bin`, but that directory is not on PATH. Docker was not found.
- No dedicated test URL was configured. The configured application URL was not read out or used.
- Disk check succeeded via `cmd /c dir`: C: 2,102,861,824 bytes free; D: 264,111,865,856 bytes free.

## Result matrix

| Rehearsal step | Result |
|---|---|
| Confirm disposable source identity | **BLOCKED** — unknown service/database identity; no connection. |
| Create synthetic test dataset | **NOT TESTED** — no verified isolated target. |
| Create PostgreSQL backup | **NOT TESTED** — `pg_dump` unavailable and no source target. |
| Check backup size/hash/archive | **NOT TESTED** — no backup exists. |
| Restore to separate database | **NOT TESTED** — `pg_restore` unavailable and no approved restore target. |
| Compare schema/counts/keys/relationships | **NOT TESTED** — no PostgreSQL database used. |
| Confirm source remained unchanged | **NOT TESTED** — no source connection made; no source operations occurred. |

## Commands actually used for readiness

- `Get-Command postgres,psql,pg_dump,pg_restore,initdb,pg_ctl,createdb,docker` (checked individually; none found on PATH).
- `Get-Service` filtered for PostgreSQL service names (found service `postgresql-x64-18`, Running).
- `cmd /c dir C:\` and `cmd /c dir D:\` for free-space evidence.

No backup/restore command was run. Do not interpret the server-service check as database identity or a successful rehearsal. Use `POSTGRESQL_BACKUP_RESTORE_REHEARSAL.md` after a dedicated test target is verified and separately authorized.

## Phase 8 update

Binary paths and service data-directory markers were verified read-only (see `POSTGRESQL_INSTALLATION_DIAGNOSTIC.md`). This resolved the earlier PATH uncertainty but did not provide a disposable database identity or test/restore database. Backup and restore remain **BLOCKED / NOT TESTED**; still no connection, dump, restore, database creation, or deletion has been performed. The revised future commands are documented in `POSTGRESQL_BACKUP_RESTORE_REHEARSAL.md` and were not run.

## Phase 11 backup/restore result (2026-11-09)

Approved source `attendx_integration_test` was backed up from the isolated `127.0.0.1:55432` cluster to `D:\AttendX\PostgreSQL-Test\backups\attendx_integration_test_phase11_20261109_133428.dump`. The 1,167-byte custom-format archive passed `pg_restore --list`; SHA-256 is `03838FCE5FBF61D6645385BF64186605955401517CB04D3AFFB59E72D1786134`.

The archive restored to the separately created `attendx_restore_verify_20261109_133428`, owned by `attendx_test_role`. Source and restore identities and catalog signatures match; both have only `public`, zero user relations/routines/custom types. No user tables existed, so row-count comparison was not applicable. Public database CONNECT/TEMPORARY privileges remain revoked. Existing service/port 5432 was untouched; application URL, tests and migrations remain unperformed. Detailed results are in `PHASE_11_POSTGRESQL_BACKUP_RESTORE.md`.
