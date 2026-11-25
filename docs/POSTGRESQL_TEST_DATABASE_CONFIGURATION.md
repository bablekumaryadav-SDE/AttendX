# PostgreSQL Test Database Configuration

**Status: isolated PostgreSQL test database configured; application test URL NOT CONFIGURED.** The test URL guard is parse-only and does not itself create or verify a server/database or establish that a cluster is disposable.

## Separate variable and fail-closed helper

Future PostgreSQL integration tests must obtain a URL through `backend/app/test_database_config.py::require_test_database_url()` and use `ATTENDX_TEST_DATABASE_URL`. The helper:

- Never falls back to `DATABASE_URL`; it raises if the test URL is missing.
- Requires a configured application URL, obtained from process `DATABASE_URL` or parsed locally from `backend/.env` without printing it.
- Requires PostgreSQL, a loopback host, a test/integration/CI marker in the database name, and a separate non-empty role.
- Rejects production-like database-name markers and targets with the same backend/host/port/database identity as the application URL. Loopback aliases (`localhost`, `127.0.0.1`, `::1`) compare as the same host.
- Parses the URL only; it does not create an engine, connect, query, or log credentials.

Tests for this helper use synthetic URL strings only and open no database connection. They cover missing test URL/no fallback, missing app identity, same database under alternate credentials/host alias, non-loopback host, production-like names, shared role, non-PostgreSQL URLs, malformed URL redaction, and accepted distinct local test target.

This guard cannot prove that a local PostgreSQL server/cluster is disposable. An operator must independently identify and explicitly approve the test cluster/database before any connection. A loopback URL and `_test` suffix alone are not proof of isolation.

## Local secret handling

Do not commit an `.env` file or place secrets in test output. Provision `ATTENDX_TEST_DATABASE_URL` only in a protected local environment or secret store after approval. Use a dedicated test-only role and a database name such as `attendx_integration_test`; never point it at the application database. Keep the normal `DATABASE_URL` unchanged. The test URL is currently **NOT CONFIGURED**.

## Example of future use (placeholder only; do not execute before approval)

```powershell
# Supply this only through an approved secret store/process environment.
# Do not place a real URL in the repository or command history.
$env:ATTENDX_TEST_DATABASE_URL = '<approved-local-test-URL-with-test-role>'
$env:DATABASE_URL = '<configured-application-URL-is-already-protected>'
```

Integration-test setup code must call `require_test_database_url()` before `create_engine`. Existing isolated SQLite tests do not use this variable. PostgreSQL integration tests remain **BLOCKED** until a test target is explicitly approved and verified.

## Phase 9 discovery update (2026-11-05)

PostgreSQL 18.6 binaries were found under `C:\Program Files\PostgreSQL\18\bin`; they are not on PATH. The existing service is `postgresql-x64-18` (Running/Automatic, `NT AUTHORITY\NetworkService`) and points to `C:\Program Files\PostgreSQL\18\data`. The selected non-secret settings in its `postgresql.conf` are port 5432 and `listen_addresses='*'`. No database connection or identity query was made. Existing-cluster identity remains **UNKNOWN**, and reuse is **NO** unless later positively proven and approved.

Proposed isolated target is a new manual cluster at `D:\AttendX\PostgreSQL-Test\cluster`, loopback port 55432, with database `attendx_integration_test` and role `attendx_test_role`. The test URL remains unconfigured. The guard continues to reject missing URLs and unsafe target identities and does not claim URL validation establishes cluster disposability. Added a no-connect test confirming credentials from an unsafe URL are not written to stdout/stderr. See `POSTGRESQL_TEST_CLUSTER_PLAN.md`.

No cluster, database, connection, service change, backup, restore, or migration was performed. Setup, first connection, role/database creation, and all backup/restore activity require explicit approval for the exact target and operation.

## Phase 10 setup status update (2026-11-05)

The Phase 9 cluster plan is now partially executed under the user's Phase 10 approval. `D:\AttendX\PostgreSQL-Test\cluster` was initialized with PostgreSQL 18.6 using SCRAM-SHA-256, UTF-8, and data checksums. Its files are owned by Windows user `Asus`. The approved parent directories were created. No backup directory was created.

The bootstrap password was generated with a cryptographic random source and passed to `initdb` through a temporary file whose ACL was restricted to the current user. That file was removed after successful initialization and the password was not printed. The short-lived command process ended without securely retaining the bootstrap password, so the authorized first TCP connection cannot be authenticated. The cluster remains initialized and untouched; it was not started. Do not use or overwrite it until a specific recovery operation is approved.

No role/database was created. Port 55432 was not checked immediately before startup because startup did not occur. A later read-only query showed no listener rows on 55432. Existing service `postgresql-x64-18` remains Running/Automatic with its previous startup path and data directory. No existing service or port 5432 setting was modified.

A first attempt failed before `initdb` because the installed .NET runtime does not support the selected static `RandomNumberGenerator.GetBytes` call. The approved directories existed but the cluster target remained empty. The compatible `RandomNumberGenerator.Create().GetBytes(...)` retry initialized successfully. No cluster data was deleted or recreated.

To continue, the user must explicitly approve a credential recovery method for this new isolated cluster (for example, a temporary loopback-only authentication override followed by setting a new SCRAM credential and restoring SCRAM-only authentication, or reinitializing this new cluster after approving replacement of its current initialized contents and a protected credential-retention method). No recovery method is authorized by Phase 10 as written. No connection, role/database creation, backup, restore, migration, test URL, or PostgreSQL application test occurred.

## Phase 10 recovery authorization update (2026-11-05; historical, superseded by the configured target update below)

The user approved a temporary loopback-only authentication override but explicitly prohibited `trust`. Read-only inspection found the original cluster `pg_hba.conf` requires SCRAM for all local/loopback records. The file SHA-256 is `0C8DC6E6E57399790417A6E13B3A8E1B5E27AA19708A2122148FBFE3BDCECD42`; its rules were left untouched. With the original bootstrap password unavailable, the approved HBA-only recovery cannot authenticate the administrator without the prohibited `trust` method or an unconfigured external identity/certificate mechanism.

No HBA edit, cluster start, database connection, password reset, role/database creation, or other DB operation was performed. The cluster remains stopped and preserved. Progress requires separate approval for an offline single-user password reset, which bypasses the requested first SQL identity query before credential reset. The current instruction prohibits `trust`; do not use it. See `PHASE_10_POSTGRESQL_TEST_CLUSTER_SETUP.md`.

## Phase 10 configured isolated PostgreSQL target (2026-11-09)

The approved isolated cluster is running on loopback only at `127.0.0.1:55432`, with data directory `D:\AttendX\PostgreSQL-Test\cluster`, PostgreSQL 18.6, and verified system identifier `7704647215459077108`. The dedicated database `attendx_integration_test` is owned by the SCRAM-authenticated, non-superuser role `attendx_test_role`. The role has no CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS, or INHERIT; public database CONNECT/TEMPORARY privileges are revoked. Fresh bootstrap and test-role logins succeeded using SCRAM.

Both generated credentials are retained only in the user-scoped Windows DPAPI encrypted file `D:\AttendX\PostgreSQL-Test\credentials.dpapi`, protected by a non-inheriting ACL for the current Windows user. The DPAPI decrypt round trip passed. This file is outside the repository; do not copy its contents or commit it. The application's `ATTENDX_TEST_DATABASE_URL` remains **NOT CONFIGURED**; `DATABASE_URL` and `.env` were not changed. The URL guard's tests remain parse-only; it does not prove cluster isolation.

No application integration tests, migrations, backups, restores, or production/application database connections were performed. Follow-on use still requires separate approval.
