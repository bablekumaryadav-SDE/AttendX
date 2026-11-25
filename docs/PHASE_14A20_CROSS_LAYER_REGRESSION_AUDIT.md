# Phase 14A.20 — Cross-Layer Regression and Tenant-Boundary Audit

**Date:** 2026-11-10
**Status:** PASS WITH FINDINGS. Tenant service contracts match by source and mocked-client tests; one camera acquisition/unmount race remains untested and is evident in source. Browser and PostgreSQL behavior NOT TESTED.
**Production readiness:** NOT CLAIMED.

## Scope and safety

Reviewed the Phase 14A.19 frontend URL/client/camera/student/routing changes, the enabled tenant service clients, the matching FastAPI tenant handlers and response schemas, route registration and default-deny gate, relevant frontend tests, and the Phase 14A.19 report. No `.env` content or runtime secret was read. Frontend API tests use synthetic in-memory adapter responses. No backend app import or database-independent backend suite was needed for this frontend cross-layer audit; no database or PostgreSQL was accessed.

Git status showed existing modified and untracked files from prior work across frontend, docs and tests. Those changes were preserved. This phase changed only `frontend/src/routes/AppRoutes.jsx`, added `frontend/tests/phase14a20-cross-layer.test.mjs`, and created/updated the Phase 14A.20 and summary documents listed below.

## API contract inventory

Tenant handlers are registered ahead of their corresponding legacy routers in `backend/app/main.py`. The legacy router copies are mounted with `include_in_schema=False` and `block_unscoped_legacy_business_api`; the exact tenant handlers below remain visible and are the runtime match for the reviewed GET paths. A supplied `college_id` is a selector checked against the caller's active membership by `resolve_tenant_context`, not an authorization credential. The tenant list/detail handlers apply College predicates and omit NULL ownership; linked attendance queries also require same-College parent/assignment joins. Missing/ambiguous/foreign membership uses 401/403/409 as appropriate; missing ownership schema/data errors are converted to generic 503 responses, and foreign/missing detail records use sanitized 404 responses.

| Enabled operation(s) | Backend handler / request contract | Frontend use and response contract | Assessment |
|---|---|---|---|
| `GET /tenant/memberships` | `tenant_memberships.list_my_active_college_memberships`; no College selector; authentication required; returns only active grants for active Colleges as `{college_id, college_name, membership_role}`. Super Admin is denied. | `tenant.getMyCollegeMemberships()` calls the shared `api` client. AuthContext validates any persisted selection against this response and requires explicit choice for multiple grants. | MATCH. Token localStorage is used in membership service only as a single-flight deduplication key; membership authorization is server-side. |
| `GET /tenant/pilot/college-profile`, `PATCH /tenant/pilot/college-profile` | `tenant_pilot.read_college_profile` accepts optional positive `college_id`, allows membership roles college_admin/teacher/student; PATCH `update_college_profile` accepts `{display_name}` and allows only college_admin. Both return `{id,slug,official_name,display_name,status,updated_at}`. | No frontend service or page caller was found. | Backend-enabled; frontend integration NOT PRESENT. PATCH is the explicitly enabled pilot write exception. |
| `GET /subjects/`, `GET /subjects/{subject_id}` | `tenant_subjects.list_tenant_subjects` / `read_tenant_subject`; optional positive `college_id`; active tenant membership in college_admin/teacher/student; response `SubjectResponse`: id, name, code, is_active, department, created_at. | `academic.getSubjects/getSubject` and read-only `Teachers.jsx` imports pass the AuthContext College via query `college_id`; use shared Axios client. | MATCH; GET only. `academic.js` still exports legacy assignment write methods but no mounted tenant Subjects page calls them; server gate denies those legacy paths. |
| `GET /classes/`, `GET /classes/{class_id}` | `tenant_classes.list_tenant_classes` / `read_tenant_class`; optional positive `college_id`; active tenant membership in college_admin/teacher/student; response `ClassResponse` includes id/name/section/department/semester/academic_year/location fields/radius/is_active/created_at. | `academic.getClasses/getClass` and `Teachers.jsx`'s class helper pass explicit `college_id` from AuthContext; shared Axios client. | MATCH; GET only. |
| `GET /teachers/`, `GET /teachers/{teacher_id}` | `tenant_teachers.list_tenant_teachers` / `read_tenant_teacher`; optional positive `college_id`; active tenant membership in college_admin/teacher/student; response `TenantTeacherResponse`: id/name/department/is_active/created_at. | `teachers.getTeachers/getTeacher` pass selected College; page clears list/detail and ignores stale requests after College change. | MATCH; GET only. Other service exports in this module are also GET-only tenant Subject/Class helpers. |
| `GET /students/`, `GET /students/{student_id}` | `tenant_students.list_tenant_students` / `read_tenant_student`; optional `college_id`; list supports `search` and `active_only`; College Admin membership only; response is minimal `TenantStudentResponse`: id/student_code/name/email/roll_number/department/is_active/created_at. | `tenantStudents.getTenantStudents/getTenantStudent` pass explicit selected College and supported filters; the caller's College argument wins over caller filter properties. | MATCH; GET only. |
| `GET /attendance/`, `GET /attendance/{attendance_id}` | `tenant_attendance.list_tenant_attendance` / `read_tenant_attendance`; optional `college_id`; College Admin membership; response `TenantAttendanceResponse`: id/student_id/teacher_id/date/status/created_at; same-College Student/Teacher joins. | `tenantAttendance.getTenantAttendance/getTenantAttendanceDetail` pass explicit `college_id`; no current page caller was found for these legacy Attendance-table reads. | MATCH by source/client contract; page integration NOT PRESENT. |
| `GET /attendance-records/`, `GET /attendance-records/{record_id}` | `tenant_attendance.list_tenant_attendance_records` / `read_tenant_attendance_record`; optional `college_id`; College Admin membership; response id/student_id/teacher_id/subject_id/class_id/attendance_date/status/created_at; same-College entity and assignment joins. | `tenantAttendance.getTenantAttendanceRecords/getTenantAttendanceRecordDetail` pass explicit selected College. `TenantAttendance.jsx` uses these methods and the `attendance_date`/status/id fields. | MATCH; GET only. |
| `GET /tenant/dashboard/summary` | `tenant_dashboard.dashboard_summary`; optional `college_id`; College Admin membership; `{students,teachers,classes,subjects}`, each `{total,active,inactive}`; counts explicitly owned rows, excluding NULL. | `tenantDashboard.getTenantDashboardSummary` sends explicit College; `TenantAdminDashboard` consumes the same fields. | MATCH. |
| `GET /tenant/dashboard/attendance-summary` | `tenant_dashboard.attendance_summary`; optional `college_id`; College Admin membership; fields `legacy_attendance_rows`, `attendance_record_rows`, present/late/absent/unclassified counts, classified denominator, rate, trend availability/reason. | `tenantDashboard.getTenantAttendanceSummary` sends explicit College; dashboard consumes the returned count/rate/trend fields. | MATCH. |

### Enabled endpoint set

The currently reviewed set is **17 method/path operations**: membership GET; profile GET and PATCH; Subjects list/detail GET; Classes list/detail GET; Teachers list/detail GET; Students list/detail GET; Attendance list/detail GET; Attendance Records list/detail GET; dashboard summary GET; dashboard attendance summary GET. No route was enabled by this phase. College profile PATCH remains the only listed tenant business write operation and is constrained to College Admin membership.

## Default-deny and legacy routes

**PASS (source review):** `block_unscoped_legacy_business_api` authenticates, then returns 503 without executing a legacy query. In `main.py`, tenant routers are registered before the overlapping legacy routers. Legacy business routers are hidden from OpenAPI and mounted with the gate. No wildcard or prefix exemption was found. Legacy session, camera, face, QR, biometric, report, notification, global dashboard and analytics handlers remain behind the gate. The tenant routers expose only the operations listed above.

**PASS (frontend route correction):** `/admin/attendance/legacy` previously mounted `AttendancePage`, whose direct `GET /attendance-records/` omitted the AuthContext College selector and whose display expected the legacy `date` field rather than tenant `attendance_date`. Backend membership resolution still constrained the call (multiple memberships without selector return 409), so this was not an observed cross-College bypass; it was a stale/unscoped integration that contradicted Phase 14A.18's dormant-page statement. The route now renders the existing `FeatureUnavailable` state. The legacy page and its source remain preserved but unmounted. A focused test asserts this route cannot mount/dispatch the old view.

Reports and Notifications remain unavailable-state routes. No page is mounted from those route entries, so no legacy Reports/Notifications client call is made there. Dormant legacy services remain in source; direct use elsewhere would still be subject to the backend default-deny gate.

## Regression review and automated coverage

| Flow | Automated coverage | Result / limit |
|---|---|---|
| Camera request constraints, secure-context refusal, permission errors, retry and track stopping | `camera-registration.test.mjs` exercises camera helper behavior and checks the admin Students route is tenant/read-only. | PASS at helper/source level. FaceCamera component mount/unmount and a real browser media stream were NOT TESTED. **MEDIUM finding:** if `getUserMedia()` is pending during unmount, cleanup sees no stream; when the promise later resolves, `startCamera` assigns the stream after unmount and no generation/mounted check stops it. Track cleanup for an already assigned stream is present. This race predates the Phase 14A.19 diagnostic-only FaceCamera change; add a component/lifecycle regression test and guard in a future narrowly scoped camera fix. |
| Student attendance | Existing code retains loading, refresh, empty/error messaging, QR/face actions, and scanner/face track cleanup; route is behind Student ProtectedRoute. | Source reviewed; dedicated rendered-flow coverage is limited. Its session/history/face service calls remain legacy operations behind default-deny and therefore are expected to receive 503 while those APIs remain disabled. End-to-end attendance submission is NOT TESTED. |
| Student dashboard | Existing `student-dashboard.test.mjs` checks the notification state declaration and admin dashboard route, not the complete student dashboard data flow. Source retains authenticated role route and loading/partial error handling. | Partial coverage only; no rendered student dashboard/browser flow. Its legacy attendance/session/face calls remain gated. |
| Authentication and role routing | `role-access.test.mjs`, `super-admin-route.test.mjs`; ProtectedRoute uses AuthContext and role decision helper. | PASS for helper decisions; no browser login/session test. Super Admin remains separate from College Admin. |
| Membership selection and College switching | `tenant-selection.test.mjs` verifies server-confirmed membership selection, ambiguity, single-flight, stale guard and invalid IDs. | PASS at helper/client level; React UI not browser-tested. |
| Subjects, Classes, Teachers, Students, Attendance and dashboard tenant services | Focused tests mock the shared Axios adapter and verify method/path/selector, refusal without College, status messages, read-only calls, page context use and stale guards. | PASS for covered mocked contracts. Checks are client and source-level, not live FastAPI or PostgreSQL execution. |
| Reports/Notifications and dormant legacy screen | `phase14a18-readiness.test.mjs` plus new Phase 14A.20 route test. | PASS that unsupported pages render unavailable state and the legacy unscoped attendance view is unmounted. |

College-bound tenant pages read `activeCollegeId` from AuthContext; their requests pass the ID as a query parameter. The backend revalidates membership on every request. No tenant service uses localStorage for College authorization. AuthContext may persist a selection but confirms it against the server-returned membership list. Latest-request guards clear or reject stale tenant results on College change for the inspected directories, attendance and dashboard. Browser rendering was NOT TESTED.

## Changes made

- `frontend/src/routes/AppRoutes.jsx`: removed the active import/mount of the legacy Attendance page and renders an unavailable state at its former explicit legacy path.
- `frontend/tests/phase14a20-cross-layer.test.mjs`: added a regression assertion for that route, the unavailable state and the preserved-but-unmounted legacy page's unscoped request.
- No backend route, authorization dependency, tenant ownership rule, API service contract, database setting or migration was changed.

## Validation

Commands were run from `frontend` unless noted.

| Check | Result |
|---|---|
| Full frontend serial suite | **PASS: 16 files, 79 passed, 0 failed, 0 skipped.** Each test file was run one at a time in sorted order with `node`; no worker pool. One initial run caught a case-sensitive assertion mismatch in the new test (78 existing passes, 1 new test failed); the assertion was corrected to case-insensitive and the complete serial run then passed. |
| API URL and artifact focused suite | **PASS: 9 passed, 0 failed, 0 skipped** using `node tests/api-base-url.test.mjs` after final build. The scanner reported issue classifications only. |
| Safe Vite build | **PASS (validation-only, not deployable):** `node --input-type=module -e "import { build } from 'vite'; await build({ envFile: false });"` with pre-existing process `VITE_*` keys removed by name and a temporary reserved `.invalid` API base. Vite 7.3.7 transformed 1,933 modules. Initial restricted attempt failed before transform with Windows `spawn EPERM`; retry outside the restricted sandbox succeeded. Warnings: ignored `use client` directives and >500 kB JS chunk advisory. |
| `git diff --check` | PASS; see final result recorded after documentation edits. |
| Trailing-whitespace scan | PASS; see final result recorded after documentation edits. |
| Backend tests / Python AST | NOT RUN / NOT APPLICABLE. Static backend handler/schema review was sufficient for this frontend contract audit; no Python files changed and app import was avoided. |
| Browser, PostgreSQL, migration and deployed API behavior | NOT TESTED. |

Exact serial runner:

```powershell
$failed = 0; $files = 0; $passed = 0; $skipped = 0; Get-ChildItem tests -Filter '*.test.mjs' | Sort-Object Name | ForEach-Object { $files++; $output = & node $_.FullName 2>&1; $exit = $LASTEXITCODE; $passLine = $output | Select-String 'pass \d+' | Select-Object -Last 1; $skipLine = $output | Select-String 'skipped \d+' | Select-Object -Last 1; if ($passLine) { $passed += [int]($passLine.Line -replace '\D','') }; if ($skipLine) { $skipped += [int]($skipLine.Line -replace '\D','') }; if ($exit -ne 0) { $failed++; Write-Output "FAILED: $($_.Name)"; $output } }; Write-Output "FILES=$files PASSED=$passed FAILED_FILES=$failed SKIPPED=$skipped"; if ($failed -gt 0) { exit 1 }
```

Safe build setup and command (values are validation-only; no dotenv file is loaded):

```powershell
$envNames = Get-ChildItem Env: | Where-Object { $_.Name.StartsWith('VITE_') } | ForEach-Object { $_.Name }; foreach ($envName in $envNames) { [Environment]::SetEnvironmentVariable($envName, $null, 'Process') }; $env:VITE_API_BASE_URL = 'https://phase14a20-validation.example.invalid'; node --input-type=module -e "import { build } from 'vite'; await build({ envFile: false });"
```

The initial restricted build attempt returned `spawn EPERM` before transforming modules; the same sanitized command was retried outside the restricted sandbox and passed. The bundle was then checked with `node tests/api-base-url.test.mjs`. The generated `frontend/dist` is validation-only and must not be deployed.

## Remaining status and blockers

- **UNKNOWN:** actual production API endpoint/deployment configuration. No deployment URL was invented or read from an environment file.
- **NOT TESTED:** browser UI, real camera/microphone permission or capture, live API authorization, PostgreSQL compatibility, deployed schema, and production integration.
- **MEDIUM finding / follow-up:** FaceCamera can receive a `getUserMedia()` stream after unmount if permission resolution is delayed; current cleanup cannot stop a stream that did not exist at cleanup time. No component lifecycle test exercises this race. Requires a narrow guard/test fix before camera lifecycle can be considered fully covered.
- **DRAFT / NOT APPLIED:** tenant ownership migration remains a draft and was not applied.
- **BLOCKED / NOT APPROVED:** credential rotation A–E remains blocked and unapproved.
- **NOT READY:** Student attendance session/face/QR endpoints and other legacy business APIs remain default-denied; this audit did not enable them.
- **No production readiness claim.**

No `.env`, database URL, credential, token value, DPAPI file, PostgreSQL/database, service, cluster, port, ACL or firewall operation occurred. No migration, commit, push or destructive Git command occurred.
