# Phase 14A.9 — Read-only Tenant-scoped Subjects API

**Date:** 2026-11-09
**Status:** Two Subjects read routes are tenant-scoped and behavior-tested using synthetic SQLite. The Phase 14A.7 default-deny gate remains active for all Subject writes and all other legacy business routes. Phase 14A.8 ownership migration remains DRAFT / NOT APPLIED; PostgreSQL compatibility is NOT TESTED.

## Ownership relationship confirmed

`Subject` has a nullable direct `college_id` FK to `College`, a `(id, college_id)` unique key, and a College-first catalog index in the current ORM metadata. NULL means legacy ownership UNKNOWN. `Subject` has no direct Class relationship. Subjects are referenced by `TeacherAssignment`, which associates Teacher, Subject and Class. The route implemented here returns only Subject fields and performs no assignment/Class join. The Phase 14A.8 composite FK on `(subject_id, college_id)` is intended to prevent future cross-College assignments after that migration; the synthetic SQLite FK test verifies this metadata behavior, not PostgreSQL DDL.

The read routes resolve current membership through `resolve_tenant_context` with the allowed College membership roles `college_admin`, `teacher`, and `student`. Context resolution requires an active user, active membership and active College. `super_admin` does not inherit membership. Global `User.role` alone is not authorization.

## Implemented routes and gate integration

| Method/path | Membership and ownership checks | Missing schema | Status / tests |
|---|---|---|---|
| `GET /subjects/` | Requires authenticated user plus a single resolved active College membership with an allowed membership role. Query filters `Subject.college_id == context.college_id` and non-NULL ownership; order is deterministic by `Subject.id ASC`. Does not join assignments or classes. No College query parameter is defined. | Tenant context or Subject query SQLAlchemy errors rollback and return sanitized HTTP 503; there is no unscoped fallback. | PASS; list isolation, NULL exclusion, order, caller selector tampering, auth and membership cases tested |
| `GET /subjects/{subject_id}` | Same context. `resolve_college_record` filters by ID and resolved College; foreign, unknown and missing IDs return the same sanitized 404. | Missing ownership column/table is returned as sanitized HTTP 503 by the helper. | PASS; same/foreign/NULL/missing IDs and schema failure tested |
| `POST /subjects/` | Legacy global Admin handler remains behind Phase 14A.7 gate. | Not reached. | BLOCKED; authenticated request returns sanitized 503 |
| `PUT /subjects/{subject_id}` | Legacy global Admin handler remains behind gate. | Not reached. | BLOCKED; authenticated request returns sanitized 503 |
| `DELETE /subjects/{subject_id}` | Legacy global Admin handler remains behind gate. | Not reached. | BLOCKED; authenticated request returns sanitized 503 |
| Every other mounted legacy business route | Existing router-level authenticated fail-closed dependency remains unchanged. No College/business handler is enabled by this exception. | Existing gate response is sanitized HTTP 503. | BLOCKED; Phase 14A.7 representative-router tests still pass |
| `/auth/*`, `/tenant/pilot/*`, `/`, `/health` | Existing account, independently tenant-scoped pilot, and public status behavior. | Existing behavior unchanged. | Outside the legacy business exception; pilot tests continue to run |

The dedicated read-only router is mounted at `/subjects` before the legacy `/subjects` router. Only its GET list/detail routes can match first. POST/PUT/DELETE fall through to the legacy router and are blocked. No change was made to `block_unscoped_legacy_business_api`; unclassified routes remain default-deny.

An extra query parameter such as `college_id=82` is not an API parameter and is ignored; it cannot choose context or affect filtering. A user with multiple active College memberships still receives 409 because the endpoint does not pass a caller-selected College into context resolution. The frontend has no membership selector.

## Frontend compatibility

Existing frontend services call `GET /subjects/` from academic management and teacher flows. Those reads now return only the current membership's Subjects. A legacy Admin account without an explicit active College membership gets 403; a user with ambiguous multiple active memberships gets 409. Existing frontend subject create/update/delete calls continue receiving 503. No frontend code or College selector was added. The academic management screen needs a later explicit membership-selection/error-handling change before it can support multi-College users or write workflows; this backend phase does not silently choose a College.

## Test coverage and limitations

The dedicated tests use the in-process FastAPI test app and synthetic in-memory SQLite with FK enforcement. They verify unauthenticated denial; no membership; inactive membership; suspended College; valid College A list/detail; College B and NULL rows hidden; same 404 for foreign/NULL/missing IDs; ignored caller `college_id`; ambiguous membership remains 409 even with a query parameter; missing membership table, Subject table, or ownership column returns sanitized 503; Subject writes return 503; and Super Admin/global Admin do not gain implicit access. The ownership metadata test verifies a TeacherAssignment cannot combine a Subject from one College with another College's assignment/class.

These tests do not establish PostgreSQL query execution, the Phase 14A.8 migration's actual deployment, PostgreSQL composite FK behavior, lock behavior, performance, or compatibility with any real schema. The v2/v3 drafts remain unapplied. No legacy Subject is assigned to a College and no default College or membership is created.

## Validation and remaining blockers

Exact commands and final counts are recorded in `docs/TEST_RESULTS.md`. The focused tenant suite includes the existing API gate/pilot, membership and migration tests plus the new Subject API tests. Python AST checks and `git diff --check` passed. Frontend tests were not run because no frontend files changed.

Before any additional route is enabled: obtain separate approval for a verified disposable PostgreSQL rehearsal; apply/review the ownership draft only after its prerequisites and backup are verified; manually reconcile ownership with evidence; test PostgreSQL constraints/catalogs; and migrate each route's joins/aggregates/writes to context-scoped queries. Subject writes remain blocked until a separate tenant-aware write lifecycle is designed. Credential rotation A–E remains **BLOCKED / NOT APPROVED**.

No database, PostgreSQL process/service/cluster/port, credential, DPAPI file, application connection setting or ACL was accessed or operated in this phase.
