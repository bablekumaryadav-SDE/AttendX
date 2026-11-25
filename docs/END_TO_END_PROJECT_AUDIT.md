# AttendX End-to-End Project Audit (2026-11-11)

## Scope and safety

This is a source-and-local-test audit, not an end-to-end production acceptance. Repository inspection excluded `.env` contents, credentials, and `backend/create_admin.py`. No PostgreSQL connection, SQL execution, schema write, migration, backup, restore, service operation, or real account/workflow test was performed. The supplied catalog facts are treated as user-provided evidence, not independently verified in this audit.

The working tree was already highly modified: `git status` reported 13,729 entries (13,679 untracked) and permission-denied temporary directories. Existing changes were preserved. Audit edits were confined to the College Registration service and its focused test, plus this document.

## Feature acceptance checklist

| Feature | Status | Evidence in this audit | Remaining blocker |
|---|---|---|---|
| FastAPI startup/import | PARTIAL | App imported with dotenv opt-out and synthetic SQLite URL; OpenAPI generated | Full suite has import errors; no live server check |
| Authentication/JWT/password hashing | PARTIAL | Source and isolated test modules exist; frontend auth tests are in the passing suite | Full backend API tests blocked by TestClient dependency; no live auth test |
| Super Admin / College Admin separation | PARTIAL | Role dependencies and frontend route tests present | Live API authorization tests not run in this environment |
| College registration | BLOCKED | Payload/schema/service contract inspected; success is gated on API response | Supplied catalog says application table and prerequisites are absent |
| Registration status lookup | PARTIAL | Issued reference and raw token are returned once; status endpoint accepts same names, hashes token and compares digest; synthetic API test exists but could not import | Persistence/status round-trip not run against PostgreSQL |
| Super Admin review and College directory | PARTIAL | Source supports all four application states; list/detail/history/review and directory routes present | Required tables reported missing; API tests blocked |
| Tenant membership and isolation | PARTIAL | Active membership + active College query; explicit tenant dependencies and gate present | Migration not applied; PostgreSQL isolation untested |
| Students / teachers / classes / subjects | PARTIAL | Tenant pages/services present; College Admin-scoped create/update and soft-deactivate operations now exist for Subjects and Classes with synthetic SQLite behavioral coverage | Required tenant schema is not applied; student/teacher academic write integration and PostgreSQL/browser verification remain incomplete |
| Timetable / lecture lifecycle | BLOCKED | Legacy endpoints remain in source but behind the default-deny gate | Requires reviewed tenant-safe implementation and schema |
| Attendance / QR / GPS / face | PARTIAL | Source modules and frontend/test coverage exist | No real API/database integration; no liveness claim |
| Reports / analytics / notifications | BLOCKED | Legacy routers are behind default-deny gate and excluded from OpenAPI | Not tenant-enabled |
| Production build | PASS (validation-only) | Vite build succeeded with empty env directory, `.invalid` API URL and temporary output | Artifact is not deployable; browser/deployment checks absent |
| PostgreSQL schema / migration | BLOCKED | Draft SQL inspected; static migration tests pass | Catalog not queried here; drafts remain DRAFT / NOT APPLIED |
| Production readiness | BLOCKED | Not established | Real PostgreSQL rehearsal, complete API tests, browser verification, deployment configuration and operational review required |

## Current OpenAPI operation inventory

Generated from `app.openapi()` after importing the app with `ATTENDX_SKIP_DOTENV=1` and an explicit synthetic `sqlite://` URL. This is source metadata only; it does not prove route responses or database availability. Frontend callers are listed by service/page family. `Auth` means a database-backed bearer principal; `Super Admin` means the backend `get_current_super_admin` dependency; tenant operations resolve the selected College through active membership.

| Method and path | Handler / purpose | Auth boundary | Request → response | Frontend caller / test evidence |
|---|---|---|---|---|
| GET `/` | `app.main.read_root`, service identity | Public | none → root status | none; import only |
| GET `/health` | `app.main.health_check` | Public | none → health status | none; import only |
| POST `/auth/login` | `app.api.auth.login` | Public credentials | login schema → token/user | auth service/Login; frontend auth tests |
| GET `/auth/me` | `app.api.auth.get_me` | Auth | none → current principal | auth service/AuthContext; frontend auth tests |
| POST `/college-registration/applications` | `submit_college_application` | Public, sanitized validation | `CollegeRegistrationCreate` → one-time reference/status/token | `collegeRegistration.js`, `CollegeRegistrationPage`; UI contract tests; API module blocked |
| POST `/college-registration/status` | `read_application_status` | Public, reference + token digest | `CollegeRegistrationStatusRequest` → non-private status | same service/page; UI tests; API module blocked |
| GET `/platform/college-applications` | `list_college_applications` | Super Admin | `status`, `q` → list item array | `collegeRegistration.js`, Super Admin review page; frontend tests |
| GET `/platform/college-applications/{application_id}` | `read_college_application` | Super Admin | path id → detail schema | same; frontend tests |
| GET `/platform/college-applications/{application_id}/history` | `read_college_application_history` | Super Admin | path id → review events | same; frontend tests |
| POST `/platform/college-applications/{application_id}/start-review` | `start_college_application_review` | Super Admin | optional reason → review result | same; frontend tests |
| POST `/platform/college-applications/{application_id}/approve` | `approve_college_application` | Super Admin | optional reason → review result | same; frontend tests |
| POST `/platform/college-applications/{application_id}/reject` | `reject_college_application` | Super Admin | reason → review result | same; frontend tests |
| GET `/platform/colleges` | `list_platform_colleges` | Super Admin | `q`, `status` → College list | `collegeRegistration.js`, Super Admin Colleges; frontend tests |
| GET `/platform/colleges/{college_id}` | `read_platform_college` | Super Admin | path id → College detail/admin summary | same; frontend tests |
| PATCH `/platform/colleges/{college_id}` | `update_platform_college_profile` | Super Admin | allowlisted profile fields → detail | same; frontend tests |
| GET `/platform/colleges/{college_id}/history` | `read_platform_college_history` | Super Admin | path id → status history | same; frontend tests |
| POST `/platform/colleges/{college_id}/status` | `set_platform_college_status` | Super Admin | status + reason → detail | same; frontend tests |
| GET `/tenant/memberships` | `list_my_active_college_memberships` | Auth; Super Admin explicitly denied | none → active grants in active Colleges | AuthContext/tenant service; tenant frontend tests |
| GET `/tenant/pilot/college-profile` | `read_college_profile` | Auth + tenant context | selected College → profile | tenant service/admin dashboard; tenant tests |
| PATCH `/tenant/pilot/college-profile` | `update_college_profile` | Auth + tenant role/context | profile patch → profile | tenant service/admin dashboard; tenant tests |
| GET `/tenant/dashboard/summary` | `dashboard_summary` | Auth + tenant context | selected College → scoped counts | tenant dashboard service/page; frontend tests |
| GET `/tenant/dashboard/attendance-summary` | `attendance_summary` | Auth + tenant context | selected College/period → scoped summary | same; frontend tests |
| GET `/subjects/`, `/subjects/{subject_id}` | tenant Subjects list/detail | Auth + active College membership | selected College/query or id → read schema | `academic.js`, AcademicManagement; frontend tests |
| POST `/subjects/` | `create_tenant_subject` | Auth + College Admin membership/context | name/code/department → created Subject; College ID bound from verified context | `academic.js`, AcademicManagement; synthetic SQLite tests |
| PATCH `/subjects/{subject_id}` | `update_tenant_subject` | Auth + College Admin membership/context | allowlisted Subject fields → updated Subject; foreign IDs hidden | same; synthetic SQLite tests |
| DELETE `/subjects/{subject_id}` | `deactivate_tenant_subject` | Auth + College Admin membership/context | selected College/id → inactive Subject, retained for history | same; synthetic SQLite tests |
| GET `/classes/`, `/classes/{class_id}` | tenant Classes list/detail | Auth + active College membership | selected College/query or id → read schema | `academic.js`, Classes; frontend tests |
| POST `/classes/` | `create_tenant_class` | Auth + College Admin membership/context | class fields → created Class; ownership bound from context | `academic.js`, Classes; synthetic SQLite tests |
| PATCH `/classes/{class_id}` | `update_tenant_class` | Auth + College Admin membership/context | allowlisted fields → updated Class; foreign IDs hidden | same; synthetic SQLite tests |
| DELETE `/classes/{class_id}` | `deactivate_tenant_class` | Auth + College Admin membership/context | selected College/id → inactive Class, retained for history | same; synthetic SQLite tests |
| GET `/teachers/`, `/teachers/{teacher_id}` | tenant Teachers list/detail | Auth + active College membership | selected College/query or id → read schema | `teachers.js`, Teachers; frontend tests |
| POST `/teachers/` | `create_tenant_teacher` | Auth + College Admin membership/context | teacher + validated same-College assignments → pending account/invitation result | tenant teacher service/page; API tests blocked |
| GET `/teachers/{teacher_id}/invitation` | teacher invitation status | Auth + College Admin membership/context | selected College/id → safe delivery state | teacher service; API tests blocked |
| POST `/teachers/{teacher_id}/invitation/resend` | resend teacher invitation | Auth + College Admin membership/context | selected College/id → safe delivery state | teacher service; API tests blocked |
| GET `/students/`, `/students/{student_id}` | tenant Students list/detail | Auth + College Admin membership/context | selected College/query or id → read schema | tenant Students service/page; frontend tests |
| POST `/students/` | `create_tenant_student` | Auth + College Admin membership/context | student + validated same-College class → pending account result | tenant Students service/page; API tests blocked |
| GET `/students/{student_id}/academic-history` | student academic history | Auth + College Admin membership/context | selected College/id → history | tenant Students service; API tests blocked |
| GET `/students/{student_id}/invitation` | student invitation status | Auth + College Admin membership/context | selected College/id → safe delivery state | tenant Students service; API tests blocked |
| POST `/students/{student_id}/invitation/resend` | resend student invitation | Auth + College Admin membership/context | selected College/id → safe delivery state | tenant Students service; API tests blocked |
| POST `/students/{student_id}/promotions` | promote tenant student | Auth + College Admin membership/context | selected College/id + academic transition → history result | tenant Students service; API tests blocked |
| GET `/attendance/`, `/attendance/{attendance_id}` | tenant Attendance list/detail | Auth + active College membership | selected College/query or id → scoped records | tenant attendance service/page; frontend tests |
| GET `/attendance-records/`, `/attendance-records/{record_id}` | tenant Attendance Records list/detail | Auth + active College membership | selected College/query or id → scoped records | tenant attendance service/page; frontend tests |
| POST `/account-activation/complete` | complete account activation | Public single-use token | token + new password → activation result | account activation service/page; frontend tests |

Legacy student/teacher/class/subject/attendance/session/assignment/dashboard/report/analytics/notification/face/QR business routers remain mounted behind `block_unscoped_legacy_business_api` and are excluded from OpenAPI. Their presence in source is not evidence they are usable. Tenant write routes above are explicitly scoped and authorized; they are distinct from legacy unscoped writes.

## Registration and Super Admin source findings

- The registration form submits the backend field names. Status lookup posts `application_reference` and `tracking_token`, matching the backend request schema; the backend stores only a digest and returns status fields after constant-time digest comparison.
- The UI renders a success/reference/token only after the registration API resolves successfully. The tracking token is not persisted in local storage.
- Confirmed issue fixed in this audit: public registration/status service calls previously used the shared Axios client without `skipAuth`, allowing an existing browser bearer token to be attached to public calls. Both calls now pass `{ skipAuth: true }`; an executable service test verifies both call configurations.
- A previous source fix is present: registration administrator email is limited to the legacy `users.email VARCHAR(150)` capacity in Pydantic and HTML, preventing a too-long address from being accepted then failing during later account provisioning.
- The Super Admin listing accepts exactly `pending`, `under_review`, `approved`, and `rejected`; the UI presents all four. Search supports reference, College name, official email and proposed admin email. The Super Admin API depends on the database-backed Super Admin role.
- The supplied 503 stage `duplicate_application_lookup` corresponds to a query against `CollegeRegistrationApplication`, whose table name is `college_registration_applications`. Given the supplied missing-public-table fact, this is the likely failing relation. No catalog or live error diagnostic was queried during this audit, so schema shadowing/resolution is not independently verified.
- After the audit snapshot, Subject and Class College Admin writes were implemented through explicit tenant routes. Create binds ownership from authenticated tenant context; update and deactivation resolve records by selected College; deletion is soft. The API gate remains applied to all legacy routers. These code paths have synthetic SQLite/direct-handler tests only and remain unavailable against the reported database until the draft tenant ownership schema is separately reviewed and applied.
- A 409 is intentionally used for duplicate user/application conflicts; the exact cause of a reported request cannot be determined without its response body. A 422 is used for request validation (including missing/invalid status credentials); the exact cause cannot be determined without the validation body. Neither live response was reproduced.
- Structured failure logging captures exception class, SQLSTATE and safe bounded identifiers where the driver provides them, plus a static stage label; public errors remain sanitized. It does not infer a missing relation from arbitrary message text.

## Migration status and blockers

Only foundation v2 is proposed; foundation v1 and v2 are alternatives. The intended order remains:

1. `database/migrations/DRAFT_20261105_add_tenant_foundation_postgresql_v2.sql` — checks `public.users.id` is `INTEGER NOT NULL PRIMARY KEY`, then creates Colleges and memberships; it does not seed Colleges or assign legacy ownership.
2. `database/migrations/DRAFT_20261110_add_college_status_history.sql` — requires foundation tables, adds nullable profile columns after compatibility checks, creates status history.
3. `database/migrations/DRAFT_20261110_add_college_registration_workflow.sql` — requires `users`, `colleges`, and `college_memberships`, creates applications and review history.

All remain **DRAFT / NOT APPLIED**. Source static tests pass, but no PostgreSQL parser or PostgreSQL execution was run. The known missing relations block registration and tenant membership/College operations. Before any separately approved isolated rehearsal, verify target identity and role, effective search path, exact relation resolution in all schemas, `users.id` type/PK, `users.email` type/length/unique constraint, partial/conflicting objects and sequences, migration prerequisites, and a recoverable backup/restore path. Do not backfill ownership or create a default College. Rollback drops the newly created tables and can destroy application/review/history data; restoration is required if those rows matter.

## Validation results

- Backend focused command (dotenv opt-out and explicit synthetic SQLite URL):
  `python -m unittest tests.test_college_registration_diagnostics tests.test_tenant_migration_static -v` — **14 passed**.
- Latest backend tenant write/contract batch (dotenv opt-out and explicit synthetic SQLite URL):
  `python -m unittest tests.test_tenant_subject_openapi_static tests.test_tenant_subject_management tests.test_tenant_class_management tests.test_college_identifier_scope tests.test_tenant_ownership_migration_static tests.test_tenant_migration_static -v` — **26 passed**. Synthetic SQLite is not PostgreSQL validation.
- Full backend discovery under the same synthetic configuration: `python -m unittest discover -s tests -q` — **115 discovered; 28 test modules errored at import** because installed Starlette `TestClient` requires absent `httpx2`. No dependency was installed. The summary reported errors, not assertion failures; API TestClient behavior remains unverified.
- In-memory Python compilation (using `tokenize.open` for source BOM handling) across 106 `backend/app` and `backend/tests` Python files — **PASS**; the prohibited `backend/create_admin.py`, temporary test folders, and caches were excluded. Focused AST parse for six relevant Python files — **PASS**.
- Frontend focused command: `node --test --test-concurrency=1 tests/college-registration-service.test.mjs tests/public-pages.test.mjs` — **10 passed**.
- Full serial frontend command: `node --test --test-concurrency=1 tests/*.test.mjs` — **112 passed, 0 failed, 0 skipped**. The initial sandbox run encountered Windows `spawn EPERM`; retry completed successfully.
- Re-run after Subject management integration: **112 passed, 0 failed, 0 skipped**. The changed suite replaced/updated prior assertions, so total test count remained 112.
- Vite validation-only build — **PASS**, with Vite/esbuild warnings about ignored `use client` directives and a >500 kB JS chunk. It used a temporary empty env directory, a reserved `https://api.example.invalid` API URL and a temporary output directory outside the repository; the build is not deployable. Initial sandbox config bundling hit `spawn EPERM`; retry completed successfully.
- Latest full backend discovery: **128 tests ran; 28 import errors** because installed Starlette TestClient requires the missing `httpx2` package. No assertion failure was reported among tests that ran. Dependencies were not installed.
- `git diff --check` and scoped trailing-whitespace scan — **PASS**. Git emitted existing LF/CRLF conversion warnings.
- Browser UI, live server, PostgreSQL, migrations, registration persistence, actual email delivery and deployment — **NOT TESTED**.

## Remaining acceptance blockers

1. Required PostgreSQL tenant/registration relations are reported absent; registration cannot persist until the migration sequence is separately reviewed, rehearsed, approved and applied.
2. The full backend suite cannot import 28 TestClient modules until the environment’s missing `httpx2` dependency is resolved under separate dependency approval.
3. PostgreSQL schema compatibility, tenant isolation on PostgreSQL and real registration/status/Super Admin workflows have not been verified.
4. No browser E2E, production API host verification, SMTP delivery, deployment, or production readiness evidence exists.

AttendX is **not 100% complete** and is **not claimed production-ready**.
