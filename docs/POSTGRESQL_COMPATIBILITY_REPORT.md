# PostgreSQL Compatibility Report

**Overall PostgreSQL runtime compatibility: NOT TESTED.** No database connection, migration, PostgreSQL test, backup or restore was performed.

## Read-only evidence

- PostgreSQL Windows service `postgresql-x64-18` exists and is **Running**; the service's cluster/database identity was not verified.
- PostgreSQL 18.6 binaries exist under `C:\Program Files\PostgreSQL\18\bin`; that directory is missing from PATH. A session-only PATH command is documented; no PATH change was made.
- Service configuration points to `C:\Program Files\PostgreSQL\18\data`, with PostgreSQL 18 cluster marker files. This is an installed active cluster, not a verified disposable target.
- Docker was not found. PostgreSQL binaries were found at the installation path but not available by bare command name from PATH.
- No dedicated test URL was found in `backend/.env`; only the presence of the ordinary `DATABASE_URL` key was checked. Its value and secrets were not displayed or used.
- A separate `ATTENDX_TEST_DATABASE_URL` guard is implemented and tested without connecting. No test URL is configured and no database has been approved.
- C: free space: 2,102,861,824 bytes. D: free space: 264,111,865,856 bytes. No build or dependency installation was run.

## Static compatibility checks

SQLAlchemy PostgreSQL dialect compilation of `College` and `CollegeMembership` succeeded. It emitted standard PostgreSQL `SERIAL`, `TIMESTAMPTZ`, primary keys, check constraints, indexes, unique membership pair, and the expected FK actions. This compiler output is static source evidence only; it is not server parsing or execution.

The migration review identified differences and limitations documented in `TENANT_MIGRATION_SQL_REVIEW.md`. The original draft remains preserved; v2 is the preferred candidate for a future isolated rehearsal because its index form follows ORM metadata more closely. Both are **DRAFT / NOT APPLIED**. No PostgreSQL compatibility claim is based on SQLite tests.

## Not verified

- SQL syntax against the running PostgreSQL server.
- PostgreSQL major-version behavior for either draft.
- Actual `users` table schema, schema/search path, permissions, constraints, or migration state.
- College/membership persistence, FK rejection, uniqueness, rollback, tenant API, or transaction behavior on PostgreSQL.
- Backup archive validity and restore integrity.

Rehearsal is **BLOCKED** until an isolated target's non-secret identity is verified and PostgreSQL client/backup tools are available. Production readiness remains **NOT ESTABLISHED**.
