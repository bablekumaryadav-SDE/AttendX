# Phase 14A.12 — Read-only Tenant-scoped Classes API

**Date:** 2026-11-10
**Status:** Implemented and validated on synthetic SQLite/FastAPI. PostgreSQL compatibility and deployed ownership schema are NOT TESTED. Credential rotation A–E remains BLOCKED / NOT APPROVED.

## Ownership and schema assessment

`Class` has a direct nullable `college_id` reference to `College`, a `(id, college_id)` unique key, and a `(college_id, id)` index in SQLAlchemy metadata. NULL means legacy ownership UNKNOWN. A Class row has no parent business entity to resolve; College is its ownership parent. The two new GET operations query only Class and apply the resolved `college_id` predicate. They do not join Teachers, Subjects, Students, Assignments, Attendance, or Session data.

Related child models declare composite same-College links to Classes, including `TeacherAssignment`, `StudentClassAssignment`, Attendance, AttendanceRecord, and AttendanceSession. The Phase 14A.8 ownership draft includes corresponding composite foreign keys; the draft has not been applied. A synthetic SQLite test confirms the declared student-to-Class composite link rejects a College A assignment that points to a College B student. This tests model metadata and SQLite FK enforcement only; it does not verify PostgreSQL or any deployed constraint.

The migration remains DRAFT / NOT APPLIED. No real database schema was inspected. If the deployed `classes` table lacks the `college_id` column or required tenant tables are missing, the endpoint returns sanitized 503 and does not fall back to the legacy global query. Rows with NULL ownership are always excluded or concealed. No ownership is inferred or assigned.

## Routes and authorization

The selected College uses the existing `college_id` query parameter, matching the Subjects API and `/tenant/pilot/college-profile`. It is only a selector. Every request calls `resolve_tenant_context`, which verifies the active authenticated account, current active membership, active College, and a permitted membership role. No ID in frontend state or query data grants access.

| Method/path | Behavior | Result |
|---|---|---|
| `GET /classes/` | Requires one allowed active membership; query filters `Class.college_id == context.college_id` and non-NULL ownership; order is Class ID ascending | Enabled, read-only |
| `GET /classes/{class_id}` | Same context; record lookup is constrained by both Class ID and resolved College; foreign, NULL/unknown and absent IDs return the same sanitized 404 | Enabled, read-only |
| `POST /classes/` | Falls through to existing legacy Class router and its fail-closed dependency | BLOCKED, sanitized 503 |
| `PUT /classes/{class_id}` | Legacy Class router dependency | BLOCKED, sanitized 503 |
| `DELETE /classes/{class_id}` | Legacy Class router dependency | BLOCKED, sanitized 503 |

The dedicated Class GET router is mounted before the existing Classes router. Only the two GET patterns are exempt. No broad dependency exemption was added. Every other legacy business API remains behind the Phase 14A.7 default-deny gate; Subject writes remain blocked too. Existing `/tenant/memberships`, the two Subjects GET routes, and `/tenant/pilot/college-profile` GET/PATCH retain their prior status.

## Frontend behavior

The Classes page is now a read-only catalog with a detail view. It uses the selected `activeCollegeId` from AuthContext and sends it explicitly as `college_id` for both list and detail calls. It does not treat the saved localStorage value as authority, create or edit Classes, or silently choose a College. The academic and teacher Class list clients also require an explicit selection and pass it through.

The page clears list and detail data before reload, keys request guards to the current load/detail generation, and invalidates those guards on unmount. The parent workspace is already keyed by confirmed College ID, so switching College remounts the page and clears its prior state. 401, 403, 404, 409 and 503 have distinct safe fallback messages.

## Test evidence and limitations

- Backend Class API tests exercise unauthenticated access; missing/inactive memberships; suspended Colleges; global Admin-only and Super Admin-only denial; College A/B scope; invalid selector; multi-membership 409 and explicit selection; NULL filtering; same sanitized 404 for foreign/unknown/missing Classes; absent table/ownership-column sanitized 503; Class writes and another legacy route still gated; and same-College child relationship integrity in SQLite.
- Frontend Class tests exercise actual Axios service functions with a mocked adapter, confirming list/detail GET methods and paths, explicit selected College parameters, and no dispatch if selection is absent. Additional tests cover error mapping, data-clearing/request-guard integration, and absence of Class write methods.
- All test commands, full suite counts, build warnings, AST syntax, and whitespace check findings are recorded in `docs/TEST_RESULTS.md`.
- Tests use synthetic SQLite, FastAPI TestClient, static checks and mocked Axios. They do not establish PostgreSQL syntax/constraint behavior, the deployed schema, migration execution, transaction/locking behavior, production data ownership, or production readiness.

## Remaining blockers

Phase 14A.8 tenant ownership migration is DRAFT / NOT APPLIED; actual deployed Class ownership schema is therefore NOT TESTED. The endpoint fails closed when ownership metadata is absent. Legacy Class rows with NULL `college_id` remain UNKNOWN and hidden. Class writes and every other legacy business endpoint remain blocked pending their own tenant-scoped designs and separate review. Credential rotation A–E remains BLOCKED / NOT APPROVED.

No database, PostgreSQL, credential, DPAPI, service, cluster, ACL or port operation occurred.
