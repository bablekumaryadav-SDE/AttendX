# Phase 14A.7 — Legacy Business API Tenant Isolation

**Date:** 2026-11-09
**Status:** Legacy business routes are **BLOCKED** at runtime until tenant ownership schema and per-route query enforcement are implemented. The tenant profile pilot remains enabled. No migration or PostgreSQL operation occurred.

## Decision and protections implemented

Current legacy business models and SQLAlchemy queries do not consistently contain a `college_id`. Legacy records' College ownership remains UNKNOWN. A membership check added without changing those query paths would still leave cross-College reads and writes possible. Therefore this phase does not claim those routes have been tenant-scoped: it puts an authenticated, router-level fail-closed gate on every legacy business router. The gate returns a sanitized HTTP 503 before the legacy endpoint handler or its business queries run. It does not fall back to a global query, derive a College from `User.role`, or grant access to Super Admin.

The gate covers students and guardian contacts, teachers, classes, subjects, assignments, attendance and sessions, student attendance, face registration, attendance records, dashboards, analytics, and notifications. `/auth/*`, `/tenant/pilot/*`, `/`, and `/health` are deliberately outside this legacy business gate. Authentication endpoints are account-level; the pilot is separately tenant-aware; root/health are non-business status endpoints.

The existing `/tenant/pilot/college-profile` GET/PATCH remains the only tenant-scoped business API. It resolves the active user and active membership through the existing tenant context service, requires an active College, treats `college_id` only as a selector among that user's active memberships, scopes the College read/write by resolved `context.college_id`, and allows PATCH only to membership role `college_admin`. Its behavioral cross-College tests remain in the focused suite. Super Admin remains separate from College membership and legacy Admin.

### Route-by-route inventory

For all BLOCKED rows, runtime role requirement is: authenticated user first, then generic 503; the original route's legacy role/record checks are retained in source but are not reached. No tenant context or College read/write filter is active for these disabled handlers. Existing route tests are not evidence of tenant isolation. The gate behavior is tested against representative endpoints per router and the protected write verbs; tests do not execute the blocked handler.

| Method(s) | Path | Existing handler role/access policy (source) | Tenant context / read filter / write filter | Runtime status / test coverage |
|---|---|---|---|---|
| POST | `/auth/login` | Public credential login | None / account-only / none | PASS (not College-owned data; existing auth tests) |
| GET | `/auth/me` | Authenticated account | None / account-only / none | PASS (not College-owned data; existing auth tests) |
| GET, POST | `/students/` | Legacy global Admin | None / none executed / none executed; gate stops handler | BLOCKED by gate; GET/POST behavior tested |
| GET, PUT, DELETE | `/students/{student_id}` | Legacy global Admin | None / none executed / none executed; gate stops handler | BLOCKED; router gate covered, handler isolation NOT TESTED |
| POST | `/students/{student_id}/activate` | Legacy global Admin | None / none executed / none executed; gate stops handler | BLOCKED; handler NOT TESTED |
| GET, PUT, DELETE | `/students/{student_id}/class-assignment` | Legacy global Admin | None / none executed / none executed; gate stops handler | BLOCKED; handler NOT TESTED |
| POST, DELETE | `/students/{student_id}/face` | Legacy global Admin | None / none executed / none executed; gate stops handler | BLOCKED; face router also separately blocked |
| GET, PUT | `/students/{student_id}/guardian` | Legacy global Admin | None / none executed / none executed; gate stops handler | BLOCKED; GET representative tested, PUT handler NOT TESTED |
| GET, POST | `/teachers/` | Legacy global Admin | None / none executed / none executed; gate stops handler | BLOCKED; GET/POST behavior tested |
| GET, PUT, DELETE | `/teachers/{teacher_id}` | Legacy global Admin | None / none executed / none executed; gate stops handler | BLOCKED; handler NOT TESTED |
| POST | `/teachers/{teacher_id}/activate` | Legacy global Admin | None / none executed / none executed; gate stops handler | BLOCKED; handler NOT TESTED |
| GET | `/teachers/{teacher_id}/assignments` | Legacy global Admin | None / none executed / none executed; gate stops handler | BLOCKED; handler NOT TESTED |
| GET, POST | `/attendance/sessions` | Authenticated user; handler branches by legacy role | None / none executed / none executed; gate stops handler | BLOCKED; GET tested |
| POST | `/attendance/sessions/{session_id}/close` | Authenticated user; handler role/ownership checks | None / none executed / none executed; gate stops handler | BLOCKED; handler NOT TESTED |
| POST | `/attendance/sessions/{session_id}/qr/refresh` | Authenticated user; handler role/ownership checks | None / none executed / none executed; gate stops handler | BLOCKED; handler NOT TESTED |
| GET | `/attendance/sessions/{session_id}/qr` | Authenticated user; handler role/ownership checks | None / none executed / none executed; gate stops handler | BLOCKED; handler NOT TESTED |
| POST | `/attendance/sessions/{session_id}/qr/verify` | Authenticated user | None / none executed / none executed; gate stops handler | BLOCKED; handler NOT TESTED |
| POST | `/attendance/sessions/{session_id}/manual` | Authenticated user; handler role/ownership checks | None / none executed / none executed; gate stops handler | BLOCKED; handler NOT TESTED |
| GET | `/attendance/sessions/{session_id}/live` | Authenticated user; handler role/ownership checks | None / none executed / none executed; gate stops handler | BLOCKED; handler NOT TESTED |
| GET | `/attendance/student/me` | Authenticated account/student lookup | None / account-only / none; not College-scoped | BLOCKED; handler NOT TESTED |
| GET, POST | `/attendance/` | Authenticated user / legacy teacher | None / none executed / none executed; gate stops handler | BLOCKED; GET tested |
| GET, PUT, DELETE | `/attendance/{attendance_id}` | Authenticated user / legacy teacher | None / none executed / none executed; gate stops handler | BLOCKED; handler NOT TESTED |
| GET | `/attendance/student/active-sessions` | Authenticated account/student | None / none executed / none executed; gate stops handler | BLOCKED; GET tested |
| POST | `/attendance/student/sessions/{session_id}/qr` | Authenticated account/student | None / none executed / none executed; gate stops handler | BLOCKED; handler NOT TESTED |
| POST | `/attendance/student/sessions/{session_id}/face` | Authenticated account/student | None / none executed / none executed; gate stops handler | BLOCKED; handler NOT TESTED |
| GET | `/face/me/status` | Authenticated account | None / account-only / none; not College-scoped | BLOCKED; GET tested |
| POST | `/face/me/register` | Authenticated account | None / account-only / none; not College-scoped | BLOCKED; handler NOT TESTED |
| GET, POST | `/subjects/` | GET: authenticated user; writes: legacy global Admin | None / none executed / none executed; gate stops handler | BLOCKED; GET/POST behavior tested |
| GET, PUT, DELETE | `/subjects/{subject_id}` | GET: authenticated user; writes: legacy global Admin | None / none executed / none executed; gate stops handler | BLOCKED; handler NOT TESTED |
| GET, POST | `/classes/` | GET: authenticated user; writes: legacy global Admin | None / none executed / none executed; gate stops handler | BLOCKED; GET/POST behavior tested |
| GET, PUT, DELETE | `/classes/{class_id}` | GET: authenticated user; writes: legacy global Admin | None / none executed / none executed; gate stops handler | BLOCKED; PUT behavior tested |
| GET, POST | `/assignments/` | Legacy global Admin | None / none executed / none executed; gate stops handler | BLOCKED; GET/POST behavior tested |
| GET, PUT, DELETE | `/assignments/{assignment_id}` | Legacy global Admin | None / none executed / none executed; gate stops handler | BLOCKED; DELETE behavior tested |
| GET, POST | `/attendance-records/` | GET: authenticated user; writes: legacy teacher | None / none executed / none executed; gate stops handler | BLOCKED; GET/POST behavior tested |
| GET | `/attendance-records/student/{student_id}` | Authenticated user | None / none executed / none executed; gate stops handler | BLOCKED; handler NOT TESTED |
| GET, PUT, DELETE | `/attendance-records/{attendance_id}` | GET: authenticated user; writes: legacy teacher | None / none executed / none executed; gate stops handler | BLOCKED; handler NOT TESTED |
| GET | `/dashboard/student/attendance` | Authenticated student account | None / none executed / none executed; gate stops handler | BLOCKED; GET tested |
| GET | `/admin-dashboard`, `/admin-dashboard/` | Legacy global Admin | None / none executed / none executed; gate stops handler | BLOCKED; GET tested; Super Admin is not Admin |
| GET | `/teacher-dashboard/teacher/dashboard` | Legacy teacher/Admin dependency | None / none executed / none executed; gate stops handler | BLOCKED; GET tested |
| GET | `/analytics/overview` | Authenticated user; legacy role-based result logic | None / none executed / none executed; gate stops handler | BLOCKED; GET tested |
| GET | `/analytics/records` | Authenticated user; legacy role-based result logic | None / none executed / none executed; gate stops handler | BLOCKED; GET tested |
| GET | `/analytics/low-attendance` | Authenticated user; legacy role-based result logic | None / none executed / none executed; gate stops handler | BLOCKED; handler NOT TESTED |
| GET | `/notifications/mine`, `/notifications/history` | Authenticated account | None / user-only / user-only; no College-membership/ownership check | BLOCKED; `/mine` tested |
| POST | `/notifications/{notification_id}/read` | Authenticated account | None / user-only / user-only; no College-membership/ownership check | BLOCKED; POST behavior tested |
| GET, PATCH | `/tenant/pilot/college-profile` | Active College membership; PATCH requires `college_admin` membership role | Active membership context / resolved College / resolved College | PASS (behavior tests cover cross-College denial, role denial and tenant selection) |
| GET | `/`, `/health` | Public | None / not applicable / not applicable | PASS (status endpoints) |

**Inventory basis:** mounted router list in `backend/app/main.py` plus the application's generated OpenAPI route/method inventory. Existing handler access-policy descriptions summarize the source dependency and handler-level role checks; they do not imply any tenant safety. Routes in a router newly mounted in `main.py` must receive the same fail-closed dependency unless separately reviewed and explicitly exempted as non-business/tenant-aware.

## Legacy data and schema blockers

- No business model among Student, Teacher, Class, Subject, TeacherAssignment, StudentClassAssignment, Attendance, AttendanceRecord, or NotificationEvent has a reviewed College ownership mapping suitable for automatic assignment.
- Legacy ownership remains UNKNOWN. NULL/unassigned records cannot safely be distinguished by College, and are never made visible through the disabled legacy endpoints.
- No default College, automatic membership creation, ownership backfill, role promotion, or modification of existing business records was performed.
- The Phase 14A.6 tenant foundation migration is still DRAFT / NOT APPLIED. Even if the College and membership tables were present, the business tables and route queries would still need a separately reviewed ownership migration and explicit filters/parent-child checks.
- Full tenant-aware implementation remains blocked pending an evidence-based manual reconciliation process for existing users and records, a reviewed business ownership/schema design, and focused query/API tests. It must not infer that all legacy Admin-owned data belongs to one College.

## Frontend compatibility

Existing frontend service modules call these legacy endpoints for student/teacher administration, academic setup, attendance and face flows, dashboards, reports/analytics, and notifications. Those requests now receive a generic 503 after authentication. No frontend College selector was added and no default College is selected. The backend contract currently requires clients to handle 503 as “College-scoped business APIs unavailable”; once a tenant-aware endpoint is approved, its request must carry an explicit College selector only when the authenticated user's verified active memberships are ambiguous. Frontend flows cannot be considered operational for these business functions until backend isolation work and a later frontend integration are complete. No frontend files changed in this phase.

## Tests and validation

Focused tests use synthetic in-memory SQLite and HTTP requests to the local FastAPI test app only; they do not connect to a PostgreSQL service. The legacy gate tests prove unauthenticated requests remain 401, authenticated reads return sanitized 503 across representative routers, write verbs return 503 before handlers, and existing legacy Admin/Super Admin do not get business access. Pilot tests continue to verify actual active-membership/context and cross-College profile behavior. They do not establish tenant filtering for the disabled business handlers.

Final focused command from `backend`: `..\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_tenant_*" -v` — **40 passed, 0 failed, 0 skipped** (pilot/API gate 15, foundation 12, static migration contracts 7, fixture 6). AST syntax checks passed for three changed Python files; `git diff --check` and the six-file trailing-whitespace scan passed. During test development, two intermediate focused invocations failed only because the test used incorrect sample paths and assumed eager FastAPI route expansion (first run: 14 tests, 4 assertion failures; next run: 13 tests, 1 assertion failure). Those test assumptions were corrected; the final full focused suite passed. The tests run against synthetic SQLite/local FastAPI only. PostgreSQL compatibility, migrations, and database operations were not tested or performed.

## Remaining blockers

1. Design a College ownership model for each business entity and relationship without inferring ownership for legacy rows.
2. Prepare a separately approved, disposable PostgreSQL baseline after the separate credential/access gates are resolved; do not use production.
3. Review and approve tenant-column/FK/index migration design and manual reconciliation workflow.
4. Implement and test each route's `resolve_tenant_context` use, College-scoped reads/writes, parent/child ownership validation, and aggregates before removing its gate.
5. Update frontend handling and explicit membership selection only after the backend request/response contract is stable; verify with frontend tests at that later stage.
6. Credential rotation A–E remains **BLOCKED / NOT APPROVED**; this phase did not access credentials or DPAPI.

No PostgreSQL, database, credentials, DPAPI, cluster, service or database port was accessed or operated.
