# Tenant Migration Plan

**Status: BLOCKED / DESIGN ONLY pending explicit legacy ownership mapping and isolated PostgreSQL test environment. ORM foundation is implemented; the PostgreSQL schema is DRAFT / NOT APPLIED.**

## Current schema observations

Current core ORM tables are `users`, `students`, `teachers`, `classes`, `subjects`, `teacher_assignments`, `student_class_assignments`, `attendance`, `attendance_records`, `face_embeddings`, and `notification_events`. Session attendance, audit and related records are partly created by SQL migration scripts. These existing records have no `college_id` column. Email/code uniqueness is global in several tables. The app currently behaves as a single-college installation.

## Required ownership decision

Before a backfill is authored, the owner must identify which exact institution owns every existing record, including orphaned profile, class, subject, assignment, attendance, notification, biometric, and session rows. Do not infer institution from department, email domain, academic year, local `.env`, or database name. Do not create an arbitrary “default” tenant and silently assign all rows.

Create a reviewed mapping/export with stable source primary keys and intended college IDs. Resolve duplicate global identifiers and ambiguous/orphaned references before adding non-null constraints. If any record has unresolved ownership, the migration must stop and preserve it for manual resolution.

## Proposed migration stages (not yet executable)

1. Establish a separate PostgreSQL test instance and a versioned migration ledger; record source DB identity without exposing credentials.
2. Take a protected backup and verify restore into a separate database. Production backup/restore is a prerequisite, not an assumption.
3. Create tenant and onboarding tables additively, initially allowing nullable ownership for legacy rows.
4. Add nullable tenant references and tenant-aware unique/index structures using validated foreign keys. Preserve legacy global keys until conflicts are resolved.
5. Apply only the reviewed source-ID-to-tenant mapping in a transaction or resumable, checkpointed batches; produce counts by table and unresolved rows.
6. Validate row counts, foreign-key integrity, cross-tenant relationship absence, existing attendance history and face data preservation.
7. Run application dual-read/tenant-scope tests against the isolated PostgreSQL database and verify cross-tenant requests return denial/not-found.
8. Only after acceptance, prepare a separately approved production window, backup/restore checkpoint and rollback procedure. No production application is authorized by this plan.
9. Enforce non-null tenant ownership only after every in-scope row has an approved mapping. Keep rollback additive; never drop legacy data as rollback.

## Validation and stop conditions

- Compare before/after row counts and primary-key sets for every migrated table.
- Check all parent-child joins, enrollment/assignment ownership and attendance/session tenant ownership.
- Verify each user/profile relation and every notification recipient relationship.
- Verify tenant-scoped uniqueness and indexes on PostgreSQL, including case-insensitive email semantics if adopted.
- Stop on any orphan, duplicate, ambiguous ownership, count mismatch, migration drift, failed restore, or cross-tenant test failure.
- Do not reset, drop, truncate, or overwrite any existing database.

## Current blockers

- No college ownership mapping is supplied.
- No PostgreSQL test server/utilities were found in the previous environment audit; current availability must be checked before rehearsal.
- No migration ledger or automated migration runner was identified.
- Production schema/migration state is unknown and must not be probed or changed without explicit approval.

Therefore adding tenant columns or backfilling now would violate data-integrity requirements. Tenant columns/backfill remain **NOT IMPLEMENTED / BLOCKED**.

## Phase 5 additive tenant foundation

The ORM now defines `colleges` and `college_memberships`; the internal tenant context and membership lifecycle services are implemented without wiring them into existing business routers. A PostgreSQL-only additive draft is at `database/migrations/DRAFT_20261105_add_tenant_foundation_postgresql.sql`. It creates only these new tables and indexes, contains no inserts, and is **DRAFT / NOT APPLIED**. It has not been executed or verified against PostgreSQL. No legacy table has a college key, no ownership is assigned, and no College row is created automatically.

Before applying even this foundation draft, first verify the exact isolated PostgreSQL target, review PostgreSQL-specific constraints/indexes and the database's current user table, and rehearse forward/rollback on a restored disposable copy. This does not authorize a production database operation.

### Phase 7 static review status

The original draft was preserved. Static PostgreSQL-dialect compilation identified a unique-index/constraint representation difference and omitted redundant ORM-emitted primary-key indexes. A separate `DRAFT_20261105_add_tenant_foundation_postgresql_v2.sql` addresses those differences and remains **DRAFT / NOT APPLIED**. The running PostgreSQL service's database identity is unknown, client/backup tools are unavailable, and no test database is verified. Backup, restore, migration rehearsal and PostgreSQL application tests are **BLOCKED / NOT TESTED**. See `TENANT_MIGRATION_SQL_REVIEW.md` and `PHASE_7_POSTGRESQL_REHEARSAL.md`.

## Phase 3 design references

- `TENANT_ENTITY_OWNERSHIP_MATRIX.md` describes current parent relationships, proposed direct/inherited ownership, FK/unique/index impacts and row-preservation requirements.
- `TENANT_AUTHORIZATION_DESIGN.md` specifies membership-derived context, role separation, endpoint scoping, IDOR controls and negative-test cases.
- `LEGACY_DATA_RECONCILIATION_PLAN.md` defines evidence collection, conflict review, reproducible dry runs, isolated rehearsal and recovery gates.
- `LEGACY_COLLEGE_OWNERSHIP_TEMPLATE.md` is blank. No institution/record mapping is approved.

### Approval gates before any DDL

1. Owner supplies and approves institution identity and evidence-based record mapping.
2. Independent reviewer signs off, all conflicts are resolved or explicitly deferred outside the migration set, and source snapshot hashes are recorded.
3. Separate PostgreSQL test target exists and a protected backup restore is proven.
4. Tenant authorization code and negative cross-tenant tests exist and pass against that isolated PostgreSQL target.
5. A migration is separately reviewed, labeled DRAFT / NOT APPLIED until execution, and includes row-count/key-set checks plus restore-based rollback.
6. Production use requires distinct explicit approval and a maintenance/backup/rollback plan. This document grants no production access.

## Phase 14A.25 clarification (2026-11-10)

The ownership draft remains **DRAFT / NOT APPLIED**. Phase 14A.24/14A.25 source review found unresolved notification composite-FK deletion semantics, no production caller for the context-binding helper, a global-by-year StudentIdCounter whose College/session scope is undecided, and no canonical versioned migration baseline for empty or partially initialized schemas. Preserve NULL ownership as UNKNOWN; do not backfill, create a default College, or create memberships automatically. See `PHASE_14A25_TENANT_SCHEMA_RISK_RESOLUTION.md` for options, installation paths, the V6 24-area alignment matrix and test outcomes.

The only tenant write remains the narrowly allowlisted College profile PATCH. All legacy business writes remain gated. Tenant business-write enablement and schema freeze are blocked pending explicit design decisions, route-level context/parent validation and PostgreSQL rehearsal. Credential rotation A–E remains **BLOCKED / NOT APPROVED**. This clarification changes no migration decision or execution status.
