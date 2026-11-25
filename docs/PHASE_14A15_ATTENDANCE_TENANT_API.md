# Phase 14A.15 — Attendance Read-only Tenant API

**Date:** 2026-11-10
**Status:** Implemented in application code; behavioral API tests PASS on synthetic SQLite. PostgreSQL/deployed schema NOT TESTED. Tenant ownership migration remains DRAFT / NOT APPLIED.

## Ownership review and decision

`Attendance` has nullable `college_id`, `student_id`, and `teacher_id`. Its direct parents are Student and Teacher; the model has no `class_id`, `subject_id`, or session key. The tenant read joins both parent rows on both ID and identical, non-NULL College ownership. It does not infer ownership from profile names, email, global roles, or IDs alone.

`AttendanceRecord` has nullable `college_id` and direct Student, Teacher, Subject, and Class IDs. The tenant query requires each parent to match the attendance record's College, plus a same-College TeacherAssignment for the exact Teacher/Subject/Class tuple and a same-College StudentClassAssignment for the Student/Class pair. Missing association evidence excludes the row. Inactive assignment/enrollment rows are accepted as historical association evidence; no effective-date semantics exist in these models, so the query does not claim to prove historical timing.

Neither `Attendance` nor `AttendanceRecord` carries an AttendanceSession ID. `AttendanceSession` is a separate College-owned table with sensitive `qr_secret` and location/session metadata. `AttendanceEvent` references Session and Student with same-College keys and includes sensitive verification method, confidence, coordinates, device hash, and reason fields. Session/Event records are not included in these endpoints and their existing routes remain gated. No inference is made that a legacy Attendance row corresponds to a Session/Event.

SQLAlchemy metadata and `database/migrations/DRAFT_20261109_add_tenant_ownership_v1.sql` describe nullable ownership columns, parent keys, and same-College composite constraints. The migration is only a draft and is NOT APPLIED. Runtime list/detail queries independently enforce direct parent and association equality; absent tables/columns produce sanitized 503. This code and synthetic data do not establish that a real deployed schema contains the required columns or constraints.

## Authorization and response

Each request calls the existing tenant context resolver. Only an active `college_admin` membership in an active College may read these attendance records. A supplied `college_id` is only a selector among that user's active memberships. Ambiguous memberships without selection remain 409; foreign or inactive selections are denied. Super Admin/global Admin does not receive implicit College access.

Response schemas are strict and expose only IDs, date/time, status, and creation time. They omit College IDs, remarks/free text, profile names/contact fields, User/account data, password/hash fields, guardian data, biometric data, QR/session secrets, GPS/location, confidence, device hashes, and verification details. Foreign, NULL/UNKNOWN, missing, or inconsistent detail IDs share `404 {"detail":"Record not found."}`. Missing ownership/query schema returns a sanitized 503.

## Route and gate inventory

| Method/path | Status | Policy |
|---|---|---|
| `GET /attendance/` | Enabled in app code | Active College Admin membership; College filter; matching owned Student and Teacher required; NULL/inconsistent rows excluded |
| `GET /attendance/{attendance_id}` | Enabled in app code | Same checks and tenant filter; foreign/unknown/missing/inconsistent IDs share sanitized 404 |
| `GET /attendance-records/` | Enabled in app code | Active College Admin membership; matching same-College Student, Teacher, Subject, Class, TeacherAssignment, and StudentClassAssignment required |
| `GET /attendance-records/{record_id}` | Enabled in app code | Same checks and tenant filter; foreign/unknown/missing/inconsistent IDs share sanitized 404 |
| Attendance create/update/delete and record writes | BLOCKED | Legacy routers remain under the Phase 14A.7 default-deny gate |
| Attendance session lifecycle, session reads, QR, live, manual marking, student attendance, face, nested, and unreviewed routes | BLOCKED | Existing legacy routers remain behind the gate; no router-wide exemption added |
| All other unreviewed legacy business APIs | BLOCKED | Phase 14A.7 default-deny gate remains in place |

The two tenant routers are registered before the corresponding legacy routers and define only the four exact GET paths above. The more specific legacy `/attendance/sessions` router stays before the integer attendance detail route and remains gated. Tests confirm attempted writes and session routes still receive the sanitized 503 gate result.

## Frontend and Phase 14A.14 regression safeguards

`/admin/attendance` now renders a new read-only `TenantAttendance` page. It uses AuthContext's `activeCollegeId` for list/detail requests, clears prior list/detail state when the selection changes, and invalidates stale asynchronous work. The GET-only tenant service rejects missing selection before dispatch. The page provides status/date/search filters, refresh, loading/empty/error states, and an ID-only detail view. It contains no attendance write, session, QR, face, or localStorage authorization call. The legacy monitor source and its service methods are preserved but are no longer mounted at this route; backend session routes remain blocked. The separate `/admin/attendance/legacy` page remains unscoped and its API requests remain blocked.

`camera-registration.test.mjs` was compared with `HEAD`: a prior registration lifecycle test had been replaced by a tenant route assertion during Phase 14A.14. This phase restores a lifecycle source-contract test while retaining both tenant route/privacy checks; the test file now has 12 tests. `guardian-flow.test.mjs` is untracked in the current Git base, so an exact `HEAD` comparison is unavailable. It currently tests the tenant Students route and no guardian data in that active read-only client; this phase adds coverage that the preserved dormant legacy Student form/service still contain guardian load/save calls and remain unmounted. Those source checks do not make guardian routes available; those routes remain gated.

## Validation

- Tenant-focused backend command from `backend`: `..\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_tenant_*' -v` — **106 passed, 0 failed, 0 skipped**. Uses the repository-root Python environment, in-process FastAPI, and synthetic SQLite. The run includes eight new attendance behavior tests. Starlette emitted a non-fatal deprecation warning that `httpx` TestClient support is deprecated in favor of `httpx2`; no dependency was installed.
- Focused attendance API command: `..\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_tenant_attendance_api_isolated.py' -v` — **8 passed, 0 failed, 0 skipped**. Gate regression command: `..\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_tenant_api_pilot_isolated.py' -v` — **15 passed, 0 failed, 0 skipped**.
- Frontend serial command from `frontend`: `$failed = 0; $total = 0; Get-ChildItem tests -Filter '*.test.mjs' | Sort-Object Name | ForEach-Object { $total++; & node $_.FullName; if ($LASTEXITCODE -ne 0) { $failed++ } }; if ($failed -gt 0) { exit 1 }` — **12 files, 61 passed, 0 failed, 0 skipped**. New tenant attendance service tests use a mocked Axios adapter; page and route assertions are source checks, not rendered-browser tests.
- Frontend production build: `npm run build` — PASS on retry; Vite 7.3.7 transformed 1,937 modules. The initial restricted run failed before transformation with Windows `spawn EPERM`; the requested retry outside the restricted sandbox succeeded. Non-fatal ignored `use client` and >500 kB bundle warnings remain.
- Python syntax: PASS; `ast.parse` checks all changed Python files without bytecode output (command recorded in TEST_RESULTS.md).
- `git diff --check`: PASS. Scoped trailing-whitespace scan: PASS for Phase 14A.15 changed files; historical whitespace in the large pre-existing `Students.jsx` remains untouched.
- Browser rendering: NOT TESTED. PostgreSQL/deployed schema/migration/FK behavior: NOT TESTED. SQLite is not PostgreSQL compatibility evidence.

**Test iteration note:** The first complete tenant run had four assertion failures: two prior gate probes still expected `GET /attendance/` and `GET /attendance-records/` to be blocked, while these are now the exact approved read routes; the new test suite also initially used a nonexistent nested attendance path and expected 403 for a nonexistent login. The probes now target still-blocked routes, the session path is real, and membership cases distinguish nonexistent users (401) from inactive/no membership (403). Final suite: **106/106 passed**. An initial attempt with the system Python and backend-local virtual environments could not import the test client (system interpreter lacked FastAPI; both local venvs' Starlette requires absent `httpx2`); the repository-root `.venv` ran the suite successfully with a non-fatal compatibility deprecation warning. No dependency was installed.

## Legacy data and blockers

No default College, ownership assignment/backfill, role promotion, database, migration, or test data outside synthetic in-memory SQLite was created. Legacy rows with NULL College ownership remain UNKNOWN and hidden. Because tenant ownership is DRAFT / NOT APPLIED, a real deployment may return sanitized 503 until the schema exists. AttendanceRecord rows without matching association evidence are hidden, and historical association timing cannot be verified from current models. No PostgreSQL readiness or production readiness is claimed. Credential rotation A–E remains BLOCKED / NOT APPROVED.

No PostgreSQL, database, credential, DPAPI, service, cluster, ACL, or port operation occurred. Phase 14A.16 was not started.
