# Phase 14A.14 — Students Read-only Tenant API

**Date:** 2026-11-10
**Status:** Implemented and tested on synthetic SQLite/FastAPI and mocked frontend HTTP. Deployed PostgreSQL ownership schema and PostgreSQL behavior are NOT TESTED. The ownership migration remains DRAFT / NOT APPLIED.

## Ownership decision

`Student` is a College-owned business profile when `students.college_id` is set and matches the requester's verified College context. The SQLAlchemy model declares a nullable integer FK to `colleges.id`, a `(id, college_id)` unique constraint, and a College-first index. The ownership migration draft adds nullable `college_id` without assigning existing rows, a same-College composite FK for `student_class_assignments`, and same-College student references for attendance, attendance records, events, and notifications. The draft is not applied and the deployed schema was not inspected. Runtime queries fail closed with sanitized 503 if the Student ownership table/column is unavailable. NULL ownership remains UNKNOWN and is hidden.

`User` is a separate global login identity. `Student` has no `user_id` FK. Legacy registration code may create a User with a matching email, but matching email is not a relationship or ownership proof and is never used by these routes. The tenant endpoints never join or query User. Global Student uniqueness constraints on email, roll number, and student code are legacy schema properties, not authorization and not evidence that a Student belongs to a College.

StudentClassAssignment and attendance models declare College-aware links, but those records are not fetched or included in Student responses. FaceEmbedding and StudentGuardian are dependent records with sensitive biometric and guardian data; neither is loaded or returned. The tenant list/detail query touches only Student and the context resolver's authenticated User, active CollegeMembership, and active College checks.

## Authorization and response

Only a current active `college_admin` membership can access the Admin Student directory. A global User role (including `admin`) does not grant access. The established tenant resolver also keeps Super Admin on its separate platform authorization path. Each request resolves active membership; an optional `college_id` selects only among the caller's verified memberships. A foreign College selector is denied and multiple memberships without a selection preserve 409.

The strict response fields are `id`, `student_code`, `name`, `email`, `roll_number`, `department`, `is_active`, and `created_at`. Email and roll number are Student-record profile fields used by the existing Admin directory and are returned only to the College Admin membership role; no User account data is joined. No password/hash, global role, account status, token, biometric state/embedding, guardian contact, class/enrollment, or assignment data is returned.

List filtering always includes `Student.college_id == resolved_college_id` and non-NULL ownership. Optional `search` covers the existing directory fields; optional `active_only` applies to that already scoped query. Detail lookup uses the shared ownership resolver. Foreign, UNKNOWN, and missing detail IDs receive the same sanitized 404. A missing ownership schema receives sanitized 503. Request data cannot replace the server-resolved College filter.

## Routes and gate

| Method/path | Status | Authorization / behavior |
|---|---|---|
| `GET /students/` | Enabled | Active `college_admin` membership; selected tenant filter; NULL ownership excluded |
| `GET /students/{student_id}` | Enabled | Same membership; same sanitized 404 for foreign, NULL/UNKNOWN, and missing IDs |
| `POST /students/` | BLOCKED | Legacy Student router remains under Phase 14A.7 default-deny gate |
| `PUT /students/{student_id}` and `DELETE /students/{student_id}` | BLOCKED | Legacy router gate, sanitized 503 |
| Student activate/deactivate routes | BLOCKED | Legacy router gate, sanitized 503 |
| Student class-assignment reads/writes | BLOCKED | Legacy nested route gate; no enrollment data returned |
| Student face registration/removal | BLOCKED | Legacy Student/face API gate; no biometric operations or status exposed |
| Student guardian routes | BLOCKED | Existing Student router gate; guardian information not fetched or returned |

The dedicated two-route router is mounted before the existing Student router. All other methods and nested routes continue through the existing fail-closed dependency. No broad exemption was added. All unreviewed business APIs remain gated.

## Frontend and preservation choice

The `/admin/students` route now renders `TenantStudents.jsx`, which uses AuthContext `activeCollegeId`, the GET-only `tenantStudents.js` client, explicit `college_id` parameters, and current request guards. It preserves the existing directory's search, summary counts, table presentation, refresh, empty/loading/error states, and read-only detail flow using the existing `Students.css` plus a small profile style sheet. It does not show face registration, guardian, assignment/enrollment, or write controls. Search and directory display keep only Student-record fields; localStorage is not an authorization source. Admin Dashboard Student metrics now use the same selected College read client.

To preserve the user's large modified `Students.jsx` and legacy `students.js` files, they were not wholesale rewritten. `AppRoutes.jsx` no longer imports/mounts the legacy component; the active route points to the new tenant directory. The old component and write helpers remain dormant source/test artifacts, not active route callers; their server routes remain blocked by the default-deny gate. A whole-project cleanup of dormant legacy code is outside this phase. The existing Dashboard navigation and route URL are unchanged.

## Validation evidence and limitations

- Backend tenant suite: **98 passed, 0 failed, 0 skipped**, using in-process FastAPI and synthetic SQLite. Tests cover membership required/active, suspended College, role separation, cross-College list/detail, NULL/missing/foreign concealment, multi-membership 409, selectors, search/active filter, strict response fields, missing ownership schema, authentication, and blocked writes/nested routes. Starlette emitted a non-fatal httpx deprecation warning.
- Frontend serial Node suite: **56 passed, 0 failed, 0 skipped** across 11 files. Tenant Student service tests use a mocked Axios adapter and verify selected College propagation, selector precedence, GET-only behavior, no dispatch without selection, and status messages. UI integration checks route mapping, clearing/request guards, directory features, and absence of linked-record/write calls through source assertions; this is not browser rendering.
- Vite production build: **PASS**, 1,935 modules transformed. Initial restricted attempt failed before transformation with environmental Windows `spawn EPERM`; retry in elevated execution context succeeded. Non-fatal package `use client` directive and >500 kB chunk warnings remain.
- Python AST syntax: **PASS**, 7 changed backend Python files parsed without generating bytecode. `git diff --check` and scoped whitespace scan: PASS.
- Browser rendering: NOT TESTED. PostgreSQL schema/migration/query/FK behavior: NOT TESTED. SQLite is not PostgreSQL compatibility evidence.

## Legacy data and remaining blockers

No default College, Student ownership assignment, backfill, role promotion, membership creation, or data migration occurred. Existing Students whose `college_id` is NULL remain UNKNOWN and invisible. The ownership draft must be separately reviewed and approved before deployment; if the real schema lacks the column, the routes return 503. Student email/roll/code are globally unique in the current model; this is a data-model limitation, not tenant authorization. No production readiness is claimed. Credential rotation A–E remains BLOCKED / NOT APPROVED.

No database, PostgreSQL, credential, DPAPI, service, cluster, ACL, or port operation occurred. Phase 14A.15 was not started.
