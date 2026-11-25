# Phase 8 — Safe PostgreSQL Test Environment Setup

**Status:** Local PostgreSQL installation diagnostic **PASS**; disposable test database **BLOCKED / NOT CONFIGURED**. No database connection, creation, drop, service change, PATH change, installation, backup, restore, or migration occurred.

## Environment findings

- PostgreSQL service `postgresql-x64-18` is Running and Automatic, service account `NT AUTHORITY\NetworkService`.
- PostgreSQL 18.6 binaries exist under `C:\Program Files\PostgreSQL\18\bin`, but the directory is not on PATH. See `POSTGRESQL_INSTALLATION_DIAGNOSTIC.md` for exact binary paths and temporary-process PATH instructions.
- The service points to `C:\Program Files\PostgreSQL\18\data`; cluster marker files exist and `PG_VERSION` reads `18`. This identifies the service's cluster directory, not whether it is disposable. No config file contents or database identity were read.
- Disk space: C: 2,102,861,824 bytes free; D: 264,111,865,856 bytes free.
- No `ATTENDX_TEST_DATABASE_URL` is configured. The configured application URL was not printed or used.

## Prepared test safety

Added `backend/app/test_database_config.py`, a parsing-only guard for future PostgreSQL integration tests, and no-connect unit tests in `backend/tests/test_test_database_config.py`. It requires a separate test URL and application identity, local PostgreSQL target, explicit test database naming, and separate role; it never creates an engine or connects. The guard cannot prove that the underlying cluster is disposable, so explicit operator approval and independent identity verification remain required.

No PATH variable was changed. If the user later chooses, a process-only PATH update is documented in `POSTGRESQL_INSTALLATION_DIAGNOSTIC.md`. No machine-wide settings or services were changed.

## Status and next step

Test database: **NOT CONFIGURED**. Backup/restore: **NOT TESTED**. Migration: both drafts **DRAFT / NOT APPLIED**. PostgreSQL compatibility: **NOT TESTED**. Ownership: **UNKNOWN**. To proceed, the user must explicitly approve a dedicated database/cluster, any creation or service work, and the first connection. Do not use the existing running service without identifying its database and confirming the target is disposable.

## Commands executed (read-only or isolated tests only)

The service was inspected with `Get-CimInstance Win32_Service -Filter "Name='postgresql-x64-18'"` and `sc.exe qc postgresql-x64-18`; binary presence/version was checked with `Test-Path` and `Get-Item` under `C:\Program Files\PostgreSQL\18\bin`. The data directory was checked for `PG_VERSION`, `postgresql.conf`, `pg_hba.conf`, and `global\pg_control`; only the `PG_VERSION` value was read. No configuration file content or database was accessed.

The PATH check compared only the PostgreSQL `bin` directory to `$env:PATH`; it did not print the full environment PATH. Regression and syntax command lines/results are in `TEST_RESULTS.md`.
