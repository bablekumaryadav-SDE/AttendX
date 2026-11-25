# Phase 3 — Multi-Tenant Foundation Design and Safe Preparation

**Date:** 2026-11-05  
**Status:** Documentation/design completed; application tenant isolation **NOT IMPLEMENTED**. No tenant migration is authored or applied.

## Scope and repository state

Re-read the Phase 1/2 audit, target architecture, tenant migration plan, security threat model, legacy ownership template, Phase 2 verification, test results and acceptance report. Inspected current ORM models, auth/dependency/config/database code, route authorization patterns, session/attendance SQL and relevant PostgreSQL migrations. Branch remains `main`; working tree has numerous existing user modifications and untracked artifacts from earlier work. These were preserved. No commit/reset/cleanup was run.

The current schema is still a single-college schema. ORM models include `users`, `students`, `teachers`, `student_id_counters`, `classes`, `subjects`, `teacher_assignments`, `student_class_assignments`, `attendance`, `attendance_records`, `face_embeddings` and `notification_events`. Existing migrations additionally define `attendance_sessions`, `attendance_events`, `attendance_audit_logs`, GIS fields on `classes`, and a one-contact-per-student `student_guardians` table. The current ORM and these migrations have no tenant key. Migration application state is unknown.

Current relationships and integrity gaps relevant to tenants:

- `User.role` is one global string and `User.email` is globally unique; student/teacher profile linking uses email in some flows.
- Student/teacher/subject identifiers have global uniqueness today; counter key is year only.
- Teacher assignments contain class/subject/teacher IDs without declared model FKs; student-class membership has basic FKs and a global one-active-student index from migration.
- Legacy attendance tables mostly store IDs without tenant FKs.
- Attendance session/event tables have parent FKs and session/student uniqueness but no same-college key.
- GIS coordinates live on `classes`, so they inherit class ownership.
- Face rows link to a student and contain sensitive image/embedding data.
- Guardian rows currently use student ID as the one-to-one primary key; this is not a multiple-guardian relationship model.
- Notification events have user/student references and a globally unique idempotency key; attendance audit rows have no college scope.

## Role and permission decision

`super_admin`, existing legacy `admin`, `teacher` and `student` remain distinct. No `admin` value was renamed or reinterpreted. The future `college_admin` membership permission is a proposed target, not a current role value. Phase 2 tests confirm the current `get_current_admin` dependency accepts only exact `admin`; Super Admin receives 403 from `/admin-dashboard`. No platform operations or platform API permissions are implemented. Full permission map and backend context design are in `TENANT_AUTHORIZATION_DESIGN.md`.

## Tenant ownership design

`TENANT_ENTITY_OWNERSHIP_MATRIX.md` documents for each current/future entity whether ownership should be direct or inherited, composite FK requirements, tenant-specific uniqueness/index candidates, and data preservation/rollback concerns. Key decisions:

- Keep `users` as a global login identity and resolve college scope through a future verified membership, not a client-supplied ID or one global role value.
- Give student, teacher, academic roots, attendance sessions/records, notification events and tenant audit events direct ownership keys where query/report/security boundaries require it.
- Keep face data inherited through the student relation, with same-tenant composite integrity and stricter sensitive-data access; never grant raw biometric access to platform admins by default.
- Keep class GIS on its class. Attendance event/session tenant equality must be constrained with composite keys and checked by backend code.
- Preserve global login-email uniqueness; analyze college-local roll numbers, employee IDs, subject codes and counters before tenant-scoping existing global constraints.

## Authorization and isolation design

`TENANT_AUTHORIZATION_DESIGN.md` defines server-side membership resolution, immutable request context, explicit tenant predicates on reads/writes/deletes/exports/jobs, parent-child same-tenant checks, separate platform permissions, and IDOR/cross-tenant protections. A client selector may choose only among memberships verified for that user; it does not prove access. Super Admin does not acquire tenant context or legacy Admin access implicitly.

The design includes negative tests for stale/revoked memberships, another user's membership selector, cross-tenant CRUD, mismatched assignment/session parents, QR replay/session crossing, GIS, face, guardian notifications, reports, background jobs and Super Admin legacy API denial. These are **NOT RUN** because no tenant context or tenant-scoped persistence exists; fabricating a frontend-only tenant filter/test would be misleading.

## Legacy reconciliation and migration status

`LEGACY_DATA_RECONCILIATION_PLAN.md` defines protected snapshot/restore, full table/PK inventory, relationship closure, duplicate/orphan/conflict review, evidence provenance, independent approval, immutable mapping hashes, no-write dry-run report, isolated PostgreSQL rehearsal and recovery gates. `LEGACY_COLLEGE_OWNERSHIP_TEMPLATE.md` remains blank. No institution or row ownership was inferred.

No tenant migration SQL or model change was created. No PostgreSQL connection, schema inspection, data write, migration, Super Admin account creation or role change occurred. The migration is **BLOCKED / NOT APPLIED** until the owner supplies evidence-backed mapping and an isolated PostgreSQL target is approved and available.

## Status matrix

| Requirement | Status | Evidence |
|---|---|---|
| Inspect current source/schema/migrations | PASS — source only | ORM and migration source inspected; live DB schema is not known. |
| Keep roles distinct; no Super Admin legacy Admin access | PASS — design + prior isolated backend test | `get_current_admin` is exact-role; phase 2 test returns 403 for Super Admin. |
| Tenant entity ownership design | PASS — design only | Matrix created; no persistence implementation. |
| Tenant context resolution and IDOR controls | PASS — design only | Server-side membership model and negative test plan documented. |
| Cross-tenant runtime denial/query enforcement | NOT TESTED / BLOCKED | No tenant context/data model exists. |
| Legacy institution ownership | UNKNOWN / BLOCKED | No owner evidence or populated mapping supplied. |
| Migration/rollback rehearsal | NOT TESTED / BLOCKED | No isolated PostgreSQL target; no DDL drafted or applied. |
| Existing attendance/auth regression | PASS | Phase 3 rerun: backend 55/55 and frontend 28/28. These suites do not validate tenant isolation. |
| Production readiness | FAIL | Tenant isolation and deployment/integration validation do not exist. |

## Regression commands and outcomes

Backend command (run from `backend`; explicit SQLite environment, suite fixtures are isolated):

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
$env:DATABASE_URL='sqlite://'
$env:SECRET_KEY=('phase3-isolated-test-' + ('q' * 40))
$env:ALGORITHM='HS256'
$env:CORS_ALLOWED_ORIGINS='http://localhost:5173,http://127.0.0.1:5173'
..\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_*.py' -v
```

Outcome: **55 tests passed, 0 failed** in 9.189 seconds. Deprecation warnings came from Starlette's `httpx` fallback and Python SQLite date/datetime adapters; OpenCV emitted backend warnings during the blank-image rejection test.

Frontend command (run from `frontend`, serial worker count 1):

```powershell
node --test --test-concurrency=1 tests/*.test.mjs
```

Outcome: **28 passed, 0 failed**. Existing role/attendance UI and route guard tests passed. No tenant behavior was exercised.

`git diff --check` completed without whitespace errors; Git printed a README CRLF normalization warning. Final read-only disk check: C: 5,918,441,472 bytes free; D: 264,111,865,856 bytes free. No build was run, no dependency was installed and no cache was cleared.

## Files created or updated

- Created `TENANT_ENTITY_OWNERSHIP_MATRIX.md`.
- Created `TENANT_AUTHORIZATION_DESIGN.md`.
- Created `LEGACY_DATA_RECONCILIATION_PLAN.md`.
- Created this report and updated `TENANT_MIGRATION_PLAN.md` and `TARGET_ARCHITECTURE.md`.
- Updated `TEST_RESULTS.md`, `FINAL_ACCEPTANCE_REPORT.md`, `MASTER_REQUIREMENT_AUDIT.md` and the migration status after test rerun.
- No application source, database, migration SQL, existing data, credentials or user backups were changed.

## Next safe phase

Obtain owner-approved institution identity and evidence for the legacy records, complete the mapping worksheet and conflict review, then establish and restore a separate PostgreSQL test database. Only after those prerequisites should the team implement tenant context and scoped repository/API code with executable cross-tenant negative tests. Do not add tenant columns or backfill before then.
