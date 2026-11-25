# Phase 12 — Tenant Migration Draft Validation

**Date:** 2026-11-09  
**Overall:** DRAFT / BLOCKED for database execution. Static review completed within the available environment. No migration SQL or database mutation was performed.

## Scope and documents

Requested filenames `PHASE_3_TENANT_OWNERSHIP_DESIGN.md` and `PHASE_5_TENANT_FOUNDATION.md` do not exist. The relevant actual documents reviewed were `PHASE_3_TENANT_FOUNDATION.md`, `TENANT_MODEL_DESIGN.md`, `TENANT_ENTITY_OWNERSHIP_MATRIX.md`, `TENANT_MEMBERSHIP_AND_AUTHORIZATION.md`, `TENANT_AUTHORIZATION_DESIGN.md`, and `PHASE_5_TENANT_IMPLEMENTATION.md`. `PHASE_7_POSTGRESQL_REHEARSAL.md`, `PHASE_9_POSTGRESQL_CLUSTER_DISCOVERY.md`, `PHASE_10_POSTGRESQL_TEST_CLUSTER_SETUP.md`, `PHASE_11_POSTGRESQL_BACKUP_RESTORE.md`, `TENANT_MIGRATION_SQL_REVIEW.md`, `TENANT_MIGRATION_READINESS_CHECKLIST.md`, `TENANT_MIGRATION_PLAN.md`, and `POSTGRESQL_MIGRATION_PLAN.md` were also reviewed.

All eight SQL files in `database/migrations/` were inspected, including the two tenant drafts (v1 and v2), PostgreSQL migrations, and the SQLite notification counterpart. Current SQLAlchemy models, database configuration, and relevant tenant tests were inspected. No Alembic configuration, Alembic dependency, revision environment, or central migration ledger was found in the searched project paths; SQL migration scripts are maintained as standalone files.

## Draft audit

| Area | Status | Finding |
|---|---|---|
| Tenant draft table/dependency order | PASS (static) | `colleges` precedes `college_memberships`; the latter references `colleges` and pre-existing `users(id)`. FK delete actions match ORM metadata. |
| Types, primary keys, required fields, defaults | PASS (static) | Integer `SERIAL` IDs, timezone timestamps, lengths, nullability, and `pending` defaults align with current model metadata. |
| Unique/check constraints | PASS WITH DRIFT | Membership pair uniqueness and role/status checks align. v1 models slug uniqueness as a table constraint plus redundant non-unique slug index; v2 uses the ORM-named unique index. Both drafts' direct-SQL slug/name checks exceed declared table metadata and should remain explicitly reviewed. |
| Secondary indexes | DRAFT | v2 mirrors ORM indexes, including `ix_colleges_id` and `ix_college_memberships_id`, which duplicate the primary-key indexes' lookup capability and add storage/write cost. Decide whether to remove model `index=True` and the redundant indexes before finalizing. v1 does not mirror them. |
| Upgrade/downgrade | DRAFT | Tenant scripts use one transaction and document reverse drop order (membership before college); rollback is manual and destructive if tenant rows exist. No downgrade was executed. |
| Idempotency | PASS (documented assumption) | Tenant drafts deliberately use plain `CREATE TABLE`/`CREATE INDEX`; repeat execution fails. They require a verified target where these objects are absent. A prior partial/manual apply must be catalog-reconciled, not blindly rerun. |
| Legacy schema compatibility | BLOCKED | Both isolated databases were documented as empty of user relations, so neither has the required `users(id)` parent. The real legacy PostgreSQL schema and migration state are not represented by this empty restore. Unqualified `users` FKs also depend on schema/search-path resolution. |
| Data changes/ownership | PASS (static) | Drafts create only two empty tables and indexes. No College, membership, role promotion, ownership backfill, or legacy row update is present. Existing ownership remains UNKNOWN; unknown rows must stay unassigned pending evidence. |
| Super Admin / legacy Admin separation | PASS (static design) | Membership roles allow only `college_admin`, `teacher`, and `student`. The global `users.role` is untouched. Super Admin is not made a College Admin or granted legacy Admin API access by these migrations. |
| Cross-college data isolation | NOT IMPLEMENTED | These tables do not add College keys to existing business tables, row-level security, or same-tenant composite FKs. The draft is an identity/membership foundation, not cross-college isolation. Legacy routes remain outside this schema change. |
| Existing migration risks | DRAFT / REVIEW REQUIRED | Legacy PostgreSQL scripts have dependencies on existing users/students/classes/teachers/subjects; `IF NOT EXISTS` does not repair mismatched objects. The GIS migration can fail on existing invalid coordinate pairs/ranges or radius values; inspect before use. The session method migration depends on the attendance events table and replaces candidate check constraints. Attendance and guardian FK/unique/cascade semantics need baseline catalog/data checks. Do not apply legacy scripts to the empty source/restore databases. |
| DDL locking/transaction behavior | NOT TESTED | Tenant DDL is transaction-wrapped and only creates new objects, but PostgreSQL lock behavior and target version execution were not rehearsed. Parent-table FK creation may acquire locks on `users`; assess blockers and duration on the actual disposable baseline. |

`CollegeMembership` uniqueness on `(user_id, college_id)` also means a revoked membership for a user/College pair must be reactivated/updated rather than replaced by another row. Confirm that lifecycle rule before final approval. ORM `onupdate=func.now()` is client-side; raw SQL updates do not advance `updated_at` automatically.

## Static validation and tests

| Check | Status | Result |
|---|---|---|
| PostgreSQL SQL parser | NOT TESTED | `pglast`, `sqlglot`, and `sqlparse` are not installed. No dependencies were installed. PostgreSQL SQL syntax was not validated by a PostgreSQL parser/server. |
| SQLAlchemy PostgreSQL dialect compilation | PASS | Compiled `College` and `CollegeMembership` tables and indexes offline using the installed SQLAlchemy PostgreSQL dialect. Compilation opened no connection. Result supports the previously documented v1/v2 differences; it is not proof the SQL files parse or execute on PostgreSQL. |
| Alembic revision graph | NOT TESTED / NOT CONFIGURED | No Alembic package/configuration/revision files were found in the inspected project paths. |
| Tenant foundation behavior tests | PASS | `tests.test_tenant_foundation_isolated`: 12/12 passed on synthetic in-memory SQLite. These assert database constraints, service lifecycle, tenant selection/denial, and Super Admin/legacy Admin role boundaries. They do not validate PostgreSQL DDL. |
| Tenant API behavior tests | BLOCKED (environmental) | Import failed before test execution because installed Starlette's `TestClient` requires missing `httpx2`. 0 API assertions ran; no dependency installation was attempted. Existing test source exercises real GET/PATCH authorization and cross-college denial rather than source-text patterns, but that behavior was not re-executed in Phase 12. |
| Source/pattern-only authorization test | NOT USED | Foundation tests exercise actual SQLite operations and authorization functions; API tests, when runnable, use FastAPI `TestClient` requests. Neither proves full legacy-router isolation. |
| SQL migration execution / rollback | NOT TESTED (prohibited in Phase 12) | No SQL was sent to a database. |

Exact test commands and outcomes are recorded in `TEST_RESULTS.md`.

## Read-only PostgreSQL assessment

| Check | Status | Result |
|---|---|---|
| PostgreSQL binary/cluster marker | PASS | Installed binary reports PostgreSQL 18.6; target `D:\AttendX\PostgreSQL-Test\cluster` has `PG_VERSION=18` and system identifier `7704647215459077108`, matching Phase 10/11 records. |
| Current isolated-cluster runtime | BLOCKED / AMBIGUOUS | `pg_ctl -D D:\AttendX\PostgreSQL-Test\cluster status` reported no server running. `pg_controldata` reports cluster state `in production`, and PostgreSQL processes exist for the separate Windows service. Because runtime identity could not be positively reconciled read-only, no connection/start was attempted. |
| Source/restore names and owners | NOT REVERIFIED (live) | Phase 11 recorded source `attendx_integration_test` and restore `attendx_restore_verify_20261109_133428`, both owned by `attendx_test_role`. Current catalog query was not run because cluster runtime status was ambiguous. |
| Schemas/object counts | NOT REVERIFIED (live) | Phase 11 recorded each DB with one user schema (`public`), zero user relations/routines/custom types. These remain historical findings, not a fresh Phase 12 query. |
| Port/service | PASS (no change) | Existing service `postgresql-x64-18` remains Running/Automatic with original C: data directory and command. No DB connection was made to port 5432 or 55432; no start/stop/config operation occurred. The target cluster was not started. |

## Proposed separately approved execution plan (NOT AUTHORIZED OR EXECUTED)

**Exact proposed target:** new disposable database `attendx_tenant_migration_verify_20261109` on the Phase 10 isolated cluster at `127.0.0.1:55432`, owned by `attendx_test_role`. Do not use or alter `attendx_integration_test` or `attendx_restore_verify_20261109_133428`. Do not use port 5432 or the Windows service cluster.

Before creation, an operator must resolve the cluster runtime ambiguity and positively verify server address, port, PostgreSQL version, cluster system identifier, and role/database ownership via fresh read-only identity queries. If any identity differs or remains uncertain, stop. The two Phase 11 databases are empty and are not a legacy schema baseline. A future rehearsal must prepare the new disposable target from a separately supplied, sanitized test schema snapshot with compatible `users(id)` (or an explicitly labeled synthetic fixture that only validates FK mechanics; that would not establish application compatibility). No production connection is authorized to obtain this snapshot.

Proposed operations after separate explicit approval:

1. Confirm the exact target name is absent; create only `attendx_tenant_migration_verify_20261109` owned by `attendx_test_role` on the verified loopback test cluster.
2. Load only the approved test baseline/schema into that target; verify required `users(id)` type/key and schema/search path. Record pre-change object inventory and counts. Do not import production data or infer ownership.
3. Create a protected custom-format backup of this new disposable baseline and verify archive listing/checksum; restore to a second uniquely named disposable verification DB before any DDL if required by the separately approved rehearsal scope.
4. Review/finalize v2 (especially redundant ID indexes and DB-only checks), then apply only the tenant foundation SQL to the disposable target. Do not run legacy migrations, backfill, or seed rows as part of this proposed foundation rehearsal.
5. Verify both tables, columns/types/defaults/nullability, PK/unique/check/FK definitions and index definitions from PostgreSQL catalogs; compare to compiled ORM metadata. Expected data change: zero rows; no College or membership records.
6. Rollback plan: prefer restoring the verified pre-migration backup into a fresh disposable database for recovery comparison. The draft's manual reverse DDL (`DROP college_memberships`, then `DROP colleges`) is allowed only on the named disposable target after checking those tables contain no required data; it is destructive and must be separately approved.

Expected result is only a tested additive tenant identity/membership schema on a disposable PostgreSQL baseline. It will not establish ownership, cross-college business-data isolation, authorization across legacy APIs, or production readiness. Those remain separate blockers.

## Phase 12 stop decision

**STOPPED after static validation and the proposed plan.** No database was created/deleted, no backup/restore was performed, no SQL migration was run, and no source/restore catalog was modified. Migration execution requires a separate explicit approval for the exact target and operations above, after the cluster runtime and baseline schema blockers are resolved.
