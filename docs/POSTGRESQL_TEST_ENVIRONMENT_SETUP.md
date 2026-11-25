# Isolated PostgreSQL Test Environment Setup

This is a future operator runbook. It was not executed during Phase 4. The current `backend/.env` PostgreSQL URL was not used and must not be presumed disposable.

## Isolation requirements

1. Install/use a dedicated local PostgreSQL server or disposable isolated service, bound to loopback only. Use a separate cluster, port (example `55432`), database, and least-privilege test role. Never reuse the application URL, a production/staging database, or an existing cluster of uncertain identity.
2. Store database credentials in an ACL-protected password file or secret manager; do not put secrets in the repository, shell history, logs, test output, or reports.
3. Create a dedicated empty database, for example `attendx_test_phase4`. Before any test command, connect with the test credentials and verify the expected database name, loopback server address, and dedicated port. Stop if any value differs.
4. Set `DATABASE_URL` only in the test process environment so application dotenv loading cannot select the local `.env` URL. Keep it out of command transcripts and reports. Do not print the URL.
5. Keep test data synthetic. Never copy production student, staff, guardian, biometric, or attendance data into the test cluster.
6. Apply schema setup only after a separately reviewed test plan explicitly authorizes it. Phase 4 did not authorize or perform migrations.

Example target properties (not a ready-to-run credential-bearing command):

| Property | Required value |
|---|---|
| Server | Dedicated disposable local test server |
| Address | Loopback only |
| Port | Dedicated port such as `55432` |
| Database | New, clearly named test database |
| Role | Test-only least-privilege role |
| Data | Synthetic fixtures only |
| Production/staging reachability | None |

## Preflight record

Record the server/cluster identity, database name, port, test role, database owner, backup location, and operator/reviewer. Verify the connection identity from inside the test session before running application tests. Capture only sanitized identifiers. If identity cannot be conclusively verified, do not connect or run database tests.

## Phase 4 readiness

PostgreSQL utilities were not on PATH and Docker was not found; no test database was configured or verified. This setup was **BLOCKED / NOT TESTED**. No database connection, schema creation, migration, or cleanup was attempted.

## Phase 7 environment check

The machine has a running Windows service named `postgresql-x64-18` and PostgreSQL 18.6 binaries under `C:\Program Files\PostgreSQL\18\bin`; that directory is absent from PATH. The service points to `C:\Program Files\PostgreSQL\18\data`, which has PostgreSQL 18 cluster markers. Cluster use and database identity are **UNKNOWN**. Docker was not found. No dedicated test URL is configured. No database connection occurred. Rehearsal remains **BLOCKED** pending an explicitly approved and identified test database and test-only credentials.
