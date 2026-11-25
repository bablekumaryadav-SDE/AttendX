# Phase 14A.17 — Tenant API Coverage Audit and Integration Readiness

**Date:** 2026-11-10
**Status:** Implementation audit PASS WITH INTEGRATION BLOCKERS; production readiness NOT ESTABLISHED
**Scope:** Read-only source, test, route-table and frontend audit. No PostgreSQL or credential operations.

## Executive result

The audited application has **17 tenant-enabled operations**: 16 GET operations and the explicitly reviewed College profile PATCH. The legacy business router gate remains installed on all legacy business routers; its dependency authenticates the request and then returns sanitized 503 without entering the handler. `/auth` and the tenant routers are deliberately mounted outside that gate. No wildcard path exemption was found.

The frontend has tenant-backed Admin Home, Students, Teachers, Classes, Subjects and Attendance pages. Their requests take the selected College from AuthContext and send it as a selector that the backend checks against current active membership. However, Admin Reports and Notifications remain linked or reachable in the UI while their APIs are default-denied; teacher/student dashboards and attendance pages are also still mounted legacy clients whose APIs are denied. This does not bypass backend authorization, but is a visible integration gap.

Two material release blockers remain: the tenant ownership migration is **DRAFT / NOT APPLIED**, and no PostgreSQL validation has been performed. SQLite tests establish only the exercised application behavior against synthetic data. Generated OpenAPI has duplicate path+method collisions for the tenant/legacy overlays and can report the legacy handler's operation metadata for those same URLs; clients must not treat OpenAPI alone as proof of tenant runtime behavior until this is resolved or explicitly tested in generated docs.

## Inventory method and evidence

Inspected `backend/app/main.py`, `tenant_api_gate.py`, tenant context/ownership helpers, all eight tenant routers, registered `app.openapi()` paths (which materializes FastAPI's included routers), route tests, SQLAlchemy ownership metadata, `DRAFT_20261109_add_tenant_ownership_v1.sql`, frontend route tree, role guard, AuthContext, shell navigation, tenant pages and services, plus legacy page/service callers. The app uses deferred included-router entries in `app.routes`; OpenAPI materialization exposed the full method/path inventory. Duplicate path+method operations are keyed once in OpenAPI and the later legacy registration can overwrite the documented operation metadata. Behavioral tests were used as additional evidence for tenant route dispatch.

## Enabled tenant routes

All routes below require a valid bearer-authenticated active User (`get_current_user`). `college_id` is an optional positive query selector where shown; it never grants access by itself. Context resolution reloads the active User and active membership joined to an active College, rejects global `super_admin`, returns 409 when selection is ambiguous, and enforces endpoint-specific membership roles. Database/schema failures are sanitized as 503. The ownership draft is not applied, so required ownership tables/columns may be absent in a deployed installation.

| Method and path | Router / handler | Membership | Ownership / NULL behavior | Response and cross-College/error behavior |
|---|---|---|---|---|
| `GET /tenant/memberships` | `tenant_memberships.list_my_active_college_memberships` | Authenticated active account; no membership role required; platform Super Admin gets 403 | Joins only current user's active memberships to active Colleges; no business ownership assignment | Safe selection fields only; empty list when no eligible memberships; sanitized 503 on SQL failure. This route discovers choices, it does not select or authorize a College. |
| `GET /tenant/pilot/college-profile` | `tenant_pilot.read_college_profile` | `college_admin`, `teacher`, `student` | Loads active College selected through the caller's matching active membership; no nullable business ownership | `TenantCollegeProfileResponse`; foreign/suspended/missing membership denied (403), ambiguous selector 409, missing College 404, missing schema 503. |
| `PATCH /tenant/pilot/college-profile` | `tenant_pilot.update_college_profile` | `college_admin` membership only | Same resolved College; body schema accepts display name, not College ID/status | `TenantCollegeProfileResponse`; attempts to supply extra tenant/status fields are rejected 422; foreign selection 403; no other tenant write route is enabled. |
| `GET /subjects/` | `tenant_subjects.list_tenant_subjects` | `college_admin`, `teacher`, `student` | `Subject.college_id == resolved college_id` and `IS NOT NULL` | `list[SubjectResponse]`; per-request membership verification; invalid/foreign selection denied; SQL or absent ownership schema sanitized 503. |
| `GET /subjects/{subject_id}` | `tenant_subjects.read_tenant_subject` | `college_admin`, `teacher`, `student` | `resolve_college_record` filters by ID and context College; NULL/foreign/missing indistinguishable | `SubjectResponse`; unknown, foreign or NULL ownership 404; schema/query failure 503. |
| `GET /classes/` | `tenant_classes.list_tenant_classes` | `college_admin`, `teacher`, `student` | `Class.college_id == context.college_id` and `IS NOT NULL` | `list[ClassResponse]`; invalid selection denied; schema/query failure sanitized 503. |
| `GET /classes/{class_id}` | `tenant_classes.read_tenant_class` | `college_admin`, `teacher`, `student` | ID lookup additionally filters through `resolve_college_record`; NULL/foreign/missing indistinguishable | `ClassResponse`; unknown, foreign or NULL ownership 404; schema/query failure 503. Class has no separately resolved business parent in this handler. |
| `GET /teachers/` | `tenant_teachers.list_tenant_teachers` | `college_admin`, `teacher`, `student` | `Teacher.college_id == context.college_id` and `IS NOT NULL` | Minimal `TenantTeacherResponse` list; foreign selector denied; schema/query failure 503. |
| `GET /teachers/{teacher_id}` | `tenant_teachers.read_tenant_teacher` | `college_admin`, `teacher`, `student` | ID lookup constrained by resolved College; NULL/foreign/missing indistinguishable | Minimal `TenantTeacherResponse`; unknown, foreign or NULL ownership 404; schema/query failure 503. |
| `GET /students/` | `tenant_students.list_tenant_students` | `college_admin` membership only | Direct `Student.college_id == context.college_id` and `IS NOT NULL`; optional search and active filter apply after scope | Minimal `TenantStudentResponse` list; invalid/foreign selection denied; schema/query failure 503. |
| `GET /students/{student_id}` | `tenant_students.read_tenant_student` | `college_admin` membership only | ID lookup constrained by resolved College; NULL/foreign/missing indistinguishable | Minimal `TenantStudentResponse`; 404 for unknown/foreign/NULL; schema/query failure 503. |
| `GET /attendance/` | `tenant_attendance.list_tenant_attendance` | `college_admin` membership only | Attendance College equals context; inner joins require Student and Teacher with matching College; NULL/mismatched parents excluded | `list[TenantAttendanceResponse]`; 404 behavior for detail; schema/query failure sanitized 503. Legacy `Attendance` data is separate from `AttendanceRecord`. |
| `GET /attendance/{attendance_id}` | `tenant_attendance.read_tenant_attendance` | `college_admin` membership only | Same College predicate and same-College Student/Teacher parent joins | Minimal `TenantAttendanceResponse`; missing, foreign, NULL or inconsistent record uses sanitized 404; schema/query failure 503. |
| `GET /attendance-records/` | `tenant_attendance.list_tenant_attendance_records` | `college_admin` membership only | Record and Student, Teacher, Subject, Class must share College; exact same-College TeacherAssignment and StudentClassAssignment must exist; distinct record rows prevent join inflation. NULL/missing/mismatched/unassociated rows excluded. | `list[TenantAttendanceRecordResponse]`; schema/query failure sanitized 503. Matching current association rows do not prove historical validity at record date. |
| `GET /attendance-records/{record_id}` | `tenant_attendance.read_tenant_attendance_record` | `college_admin` membership only | Same ownership and assignment/enrollment evidence as list; direct foreign/unknown/NULL record indistinguishable | Minimal `TenantAttendanceRecordResponse`; sanitized 404 or 503 as above. |
| `GET /tenant/dashboard/summary` | `tenant_dashboard.dashboard_summary` | `college_admin` membership only | Separate Student, Teacher, Class, Subject counts filtered by context College and non-NULL ownership | Aggregate-only `TenantDashboardSummary`; cross-College selection denied; sanitized 503 for schema/query failure. |
| `GET /tenant/dashboard/attendance-summary` | `tenant_dashboard.attendance_summary` | `college_admin` membership only | Counts legacy Attendance separately; AttendanceRecord aggregation requires same-College Student/Teacher/Subject/Class and matching TeacherAssignment/StudentClassAssignment; NULL/inconsistent rows excluded and IDs deduplicated | Aggregate-only `TenantAttendanceSummary`; unknown statuses reported separately and excluded from classified denominator; no trend data. Cross-College denied; schema/query failure 503. |

Membership/context status behavior common to scoped routes: unauthenticated 401; inactive account 401; no active membership or disallowed membership role 403; Super Admin cannot inherit College access; foreign/suspended College selection 403; omitted selection with multiple active memberships 409; required tenant schema/query unavailable 503. Detail APIs intentionally hide whether a row exists outside the caller's College.

## Default-deny and complete route inventory

`main.py` applies `Depends(block_unscoped_legacy_business_api)` to each legacy business router. The gate depends on `get_current_user`, then raises HTTP 503 with a fixed message. Thus anonymous legacy requests normally receive 401 before the gate; an authenticated request is denied before the endpoint handler/query. Tenant overlays are registered before legacy routers at the same URL and define only the listed methods. Exact method/path overlays are not wildcard/prefix exemptions.

### AUTH_ONLY / PUBLIC / PLATFORM_ONLY

| Class | Registered route(s) | Notes |
|---|---|---|
| PUBLIC | `GET /`, `GET /health`; FastAPI `GET,HEAD /openapi.json`, `/docs`, `/docs/oauth2-redirect`, `/redoc` | No business data authorization; docs routes are generated by FastAPI. |
| AUTH_ONLY | `POST /auth/login`, `GET /auth/me` | Login is public authentication exchange; `/auth/me` requires authenticated caller. There is no tenant authorization implied by successful login. |
| PLATFORM_ONLY | Frontend `GET` navigation at `/platform` (React route) | UI guarded by global `super_admin`; there is no registered platform API router/operation in the current backend. Not a backend API authorization boundary. |

### BLOCKED_BY_DEFAULT_DENY business operations

The following operations are registered by legacy routers and covered by the default-deny dependency. Where a tenant GET overlay exists, only that exact tenant GET is enabled; the listed legacy route is not available to callers.

| Legacy path family | Registered methods | Status / notes |
|---|---|---|
| `/students/` | POST | BLOCKED; tenant GET list is the separate enabled overlay. |
| `/students/{student_id}` | PUT, DELETE | BLOCKED; tenant GET detail is the separate enabled overlay. |
| `/students/{student_id}/activate` | POST | BLOCKED. |
| `/students/{student_id}/class-assignment` | GET, PUT, DELETE | All legacy operations BLOCKED. |
| `/students/{student_id}/face` | POST, DELETE | BLOCKED; face/biometric operation. |
| `/students/{student_id}/guardian` | GET, PUT | BLOCKED; guardian contact data remains out of tenant API. |
| `/teachers/` | POST | BLOCKED; tenant GET list overlay only. |
| `/teachers/{teacher_id}` | PUT, DELETE | BLOCKED; tenant GET detail overlay only. |
| `/teachers/{teacher_id}/activate` | POST | BLOCKED. |
| `/teachers/{teacher_id}/assignments` | GET | BLOCKED. |
| `/attendance/sessions` | GET, POST | BLOCKED; session lifecycle/read remains gated. |
| `/attendance/sessions/{session_id}/close` | POST | BLOCKED. |
| `/attendance/sessions/{session_id}/qr/refresh` | POST | BLOCKED. |
| `/attendance/sessions/{session_id}/qr` | GET | BLOCKED. |
| `/attendance/sessions/{session_id}/qr/verify` | POST | BLOCKED. |
| `/attendance/sessions/{session_id}/manual` | POST | BLOCKED. |
| `/attendance/sessions/{session_id}/live` | GET | BLOCKED. |
| `/attendance/` | POST | BLOCKED; tenant GET list overlay only. |
| `/attendance/{attendance_id}` | PUT, DELETE | BLOCKED; tenant GET detail overlay only. |
| `/attendance/student/me` | GET | BLOCKED. |
| `/attendance/student/active-sessions` | GET | BLOCKED. |
| `/attendance/student/sessions/{session_id}/qr` | POST | BLOCKED. |
| `/attendance/student/sessions/{session_id}/face` | POST | BLOCKED. |
| `/face/me/status` | GET | BLOCKED. |
| `/face/me/register` | POST | BLOCKED. |
| `/attendance-records/` | POST | BLOCKED; tenant GET list overlay only. |
| `/attendance-records/student/{student_id}` | GET | BLOCKED. |
| `/attendance-records/{attendance_id}` | GET, PUT, DELETE | Legacy handler blocked; only `GET /attendance-records/{record_id}` tenant overlay is enabled. OpenAPI path parameter spelling differs but runtime URL shape overlaps. |
| `/subjects/` | POST | BLOCKED; tenant GET list overlay only. |
| `/subjects/{subject_id}` | PUT, DELETE | BLOCKED; tenant GET detail overlay only. |
| `/classes/` | POST | BLOCKED; tenant GET list overlay only. |
| `/classes/{class_id}` | PUT, DELETE | BLOCKED; tenant GET detail overlay only. |
| `/assignments/` | GET, POST | BLOCKED. |
| `/assignments/{assignment_id}` | GET, PUT, DELETE | BLOCKED. |
| `/dashboard/student/attendance` | GET | BLOCKED. |
| `/admin-dashboard`, `/admin-dashboard/` | GET | Both legacy global dashboard spellings BLOCKED. |
| `/teacher-dashboard/teacher/dashboard` | GET | BLOCKED. |
| `/analytics/overview`, `/analytics/records`, `/analytics/low-attendance` | GET | BLOCKED. |
| `/notifications/mine`, `/notifications/history` | GET | BLOCKED. |
| `/notifications/{notification_id}/read` | POST | BLOCKED. |

The source modules for QR, AI and geofence are not mounted in `main.py`; no backend operation from those routers is registered. Face and session/student attendance routers are mounted but explicitly gated. No unknown mounted business router outside the inspected `main.py` router list was found. Unclassified future routes are not automatically tenant-enabled: maintainers must mount them behind the gate or add a separately reviewed tenant router.

### Gate test evidence and limits

`test_tenant_api_pilot_isolated.py` exercises authenticated denial for representative legacy reads, sanitized 503, unauthenticated 401, and representative legacy writes before handler execution. Per-feature tenant suites test endpoint-specific unauthorized membership/foreign selection/NULL/missing-schema and blocked writes. Coverage is strong for the exact tenant route families, but not a generated exhaustive HTTP method × every legacy route matrix; adding any router or route requires a focused gate regression test. In particular, test inventory is behavioral SQLite/FastAPI coverage, not PostgreSQL evidence.

## Frontend route, service and integration audit

| Frontend route/page | Data client / authorization inputs | Audit result |
|---|---|---|
| `/admin` | `TenantAdminDashboard` → `tenantDashboard.js`; AuthContext `activeCollegeId` | Tenant GET summary/attendance-summary only; clears per College key, latest-request guard, no global totals or writes. |
| `/admin/students` | `TenantStudents` → `tenantStudents.js` | College ID from AuthContext; GET only; list/detail; switch remount and request guards. Legacy `Students.jsx` is not mounted. |
| `/admin/teachers` | `Teachers` → `teachers.js` | College ID from AuthContext; GET only; list/detail, switch clearing and stale-request guards. |
| `/admin/classes` | `Classes` → `academic.js` class methods | College ID from AuthContext; GET only for mounted page; switch clearing and request guards. |
| `/admin/subjects` | `AcademicManagement` → `academic.js` | College ID from AuthContext; GET only for mounted page; list, clear on reload/switch, latest-request guard. `academic.js` still exports legacy assignment CRUD, but no mounted tenant page calls it. |
| `/admin/attendance` | `TenantAttendance` → `tenantAttendance.js` | AuthContext College selector, GET-only, list/detail, switch remount and stale-request guards. |
| `/admin/attendance/legacy` | `AttendancePage` and legacy attendance services | Mounted direct route but not in Admin sidebar; API operations are default-denied. Legacy page should be considered unavailable. |
| `/admin/reports`, `/teacher/reports` | `ReportsPage` → direct `/analytics/records` and legacy report callers | Reachable and linked from Admin/Teacher navigation but backend routes are default-denied; page issues unscoped requests and reports failure. UX/readiness gap, not an auth bypass. |
| `/admin/notifications`, `/teacher/notifications`, `/student/notifications` | `Notifications` → legacy notification service, including mark-read POST | Reachable by the header bell; API GET/POST operations are default-denied. The visible control implies availability although the backend rejects it. |
| `/teacher`, `/teacher/attendance`, `/student`, `/student/attendance` | Legacy dashboards/attendance services | Still mounted and make legacy global/session/student requests; these are all behind backend deny gate. They are not tenant API integrations and will not operate as intended. |
| `/platform` | `SuperAdminHome`, frontend `ProtectedRoute` global role | UI-only platform surface; no API router registered here. Global Super Admin is not granted College tenant API access. |

`ProtectedRoute` checks the global User role for client navigation only. Tenant APIs independently require the active CollegeMembership role; e.g. the Admin route's global `admin` role does not itself authorize a tenant API. AuthContext loads memberships from `/tenant/memberships`, validates/restores persisted selection against returned memberships, and sends selected College IDs from component state. `tenant.js` reads the token from localStorage only to key single-flight membership requests; the Axios interceptor reads it for bearer authentication. Tenant services do not read College selection from localStorage as their authorization source.

`DashboardLayout` remounts its `<Outlet>` on the `tenantViewKey(activeCollegeId)` change; tenant pages also clear state and use request generation guards. No mounted tenant read-only page exposes create/update/delete controls. Legacy Students, AdminDashboard, and attendance monitor code remains present but unmounted. The old `AdminDashboard.jsx` is not the Admin index component. The active Admin sidebar still links Reports, and header bell navigates to Notifications; both are blocked APIs. Recommend hiding or clearly marking these links unavailable before user acceptance. This audit did not remove or change navigation.

The frontend build passed, which checks bundled imports/resolution. No broken import was reported. Legacy service exports remain in place; their existence does not enable API access because backend legacy routers remain gated. An app source search found no tenant page calling the legacy assignment mutation methods. Legacy files remain callable if mounted later and must remain treated as unsafe until tenant-reviewed.

## Ownership and integrity assumptions

`DRAFT_20261109_add_tenant_ownership_v1.sql` is explicitly **DRAFT / NOT APPLIED**. It adds nullable `college_id INTEGER` (FK to `colleges.id`, `ON DELETE RESTRICT`) to these 12 existing tables: `students`, `teachers`, `subjects`, `classes`, `teacher_assignments`, `student_class_assignments`, `attendance`, `attendance_records`, `attendance_sessions`, `attendance_events`, `notification_events`, `attendance_audit_logs`. It adds composite `(id, college_id)` unique constraints for those tables, single-column College FKs, same-College composite FKs for assignment, attendance, session/event and notification-student relationships, plus tenant lookup indexes. The draft's preflight requires the documented legacy tables and integer key columns. College and CollegeMembership are provided by the earlier draft tenant foundation; membership `college_id` is non-null in the ORM. `User` has no College ownership column. `StudentGuardian` and StudentIdCounter are not in this ownership draft and remain inaccessible through gated APIs.

ORM metadata additionally declares the above nullable business ownership columns and matching composite constraints. This is code metadata only and does not prove that the draft applies cleanly to any actual database. Legacy rows left `college_id IS NULL` have UNKNOWN ownership; no default College, assignment, role promotion, or backfill exists. Tenant list filters exclude NULL and detail lookups hide NULL rows as 404.

Cross-College structural integrity is represented by composite foreign keys for TeacherAssignment → Teacher/Subject/Class; StudentClassAssignment → Student/Class; Attendance → Student/Teacher; AttendanceRecord → Student/Teacher/Subject/Class; AttendanceSession → Teacher/Subject/Class; AttendanceEvent → AttendanceSession/Student; NotificationEvent → Student. `AttendanceAuditLog` has College ownership but no same-College business-parent FK in the draft. Unique `(id, college_id)` constraints support composite references; nullable columns and PostgreSQL MATCH SIMPLE retain old NULL rows while checking tenant-owned references. PostgreSQL constraint semantics, transaction/lock effects and actual legacy compatibility are not verified here.

The API's current row evidence is ownership-based, not proof of historical truth. AttendanceRecord filtering checks matching TeacherAssignment and StudentClassAssignment rows, but models lack effective-from/effective-to history; a current or retained association does not establish it was valid on `attendance_date`. Legacy `Attendance` has only Student and Teacher links; it cannot establish class, subject, session or roster attendance. Dashboard trends are deliberately unavailable. AttendanceEvent/session routes are not enabled.

## Tests and validation

| Check | Result | Evidence / limitations |
|---|---|---|
| Backend tenant suite | PASS: **114 passed, 0 failed, 0 skipped** | `..\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_tenant_*' -v` from `backend`; synthetic SQLite and in-process FastAPI. Non-fatal Starlette/httpx TestClient deprecation warning. |
| Tenant endpoint test-method inventory | PASS: 97 test methods across 10 isolated tenant API/foundation suites | Includes membership/context, pilot, subject/class/teacher/student/attendance/dashboard, ownership and foundation behavior. Additional static fixture/migration tests contribute to suite total. Not every legacy route/method is individually tested. |
| Frontend serial suite | PASS: **13 files, 65 passed, 0 failed, 0 skipped** | Per-file Node invocation sorted serially from `frontend`; mocks/static contracts. No parallel workers used. |
| Vite production build | PASS on retry | `npm run build` from `frontend`; first restricted invocation failed before transformation with Windows `spawn EPERM`; retry outside restricted sandbox transformed **1,936 modules**. Non-fatal ignored `use client` directives and >500 kB bundle warning. |
| Python AST | PASS: 74 Python files | `..\.venv\Scripts\python.exe -B -c "import ast,pathlib; root=pathlib.Path('app'); files=sorted(root.rglob('*.py'))+sorted(pathlib.Path('tests').glob('test_tenant_*.py')); [ast.parse(p.read_text(encoding='utf-8-sig'), filename=str(p)) for p in files]; print('AST syntax PASS:',len(files),'Python files (UTF-8 BOM-aware)')"` from `backend`. Initial UTF-8-only check rejected a pre-existing BOM in `app/api/auth.py`; BOM-aware AST parse passed. |
| `git diff --check` | PASS | No whitespace errors in diff. Git may report line-ending normalization warnings for pre-existing modified files. |
| Scoped trailing-whitespace scan | PASS | Applied to Phase 14A.17 report and appended sections in the two reports. |
| Browser UI | NOT TESTED | No browser rendering/interaction harness was run. |
| PostgreSQL/deployed schema | NOT TESTED / BLOCKED | No PostgreSQL/database access or migration execution; SQLite is not PostgreSQL compatibility evidence. |

## Readiness findings and remaining blockers

1. **BLOCKED — PostgreSQL/schema readiness:** tenant ownership migration is DRAFT / NOT APPLIED; actual schema, constraints, query plans, error behavior and compatibility are unknown.
2. **BLOCKED — Frontend availability messaging:** Admin Reports and bell-linked Notifications, plus teacher/student legacy dashboard/attendance pages, remain mounted or linked while the backend returns the default 503. No tenant replacements were implemented in this audit.
3. **REVIEW REQUIRED — Generated OpenAPI collisions:** tenant and legacy overlay routes share method/path keys. `app.openapi()` reported legacy operation IDs on overlapping tenant URLs (e.g. `/students/`, `/teachers/`, `/subjects/`, `/classes/`, `/attendance/`), although isolated behavioral tests exercise the tenant implementations. Generated schema should be made unambiguous and tested before client generation or API-contract publication.
4. **BLOCKED — Historical data integrity:** NULL ownership remains unknown; associations have no effective-date history; no safe ownership reconciliation/backfill has been approved.
5. **BLOCKED — Security recovery:** credential rotation A–E remains **BLOCKED / NOT APPROVED**. This phase did not access credential or DPAPI storage.
6. **NOT TESTED — Browser and PostgreSQL:** no visual/interactive UI or PostgreSQL tests were performed.

**Implementation status:** the exact tenant endpoints above are enabled and covered by isolated code/tests; no further business endpoints were enabled. **Production readiness:** NOT CLAIMED. Phase 14A.18 was not started.

No PostgreSQL or application database connection, query, or migration occurred. Backend app import invoked the existing `app.database` module, which calls `load_dotenv` on `backend/.env`, reads `DATABASE_URL`, and constructs a SQLAlchemy engine; the URL value was not printed or independently inspected, but it was loaded into process memory by the existing module. Tenant tests override `get_db` with synthetic in-memory SQLite. No `.env` or database configuration file was modified. No DPAPI file was accessed. No service, cluster, ACL, or port operation occurred; no Git destructive operation, commit or push occurred.

### Exact frontend serial command

Run from `frontend`:

```powershell
$failed = 0; $files = 0; $passed = 0; $skipped = 0; Get-ChildItem tests -Filter '*.test.mjs' | Sort-Object Name | ForEach-Object { $files++; $output = & node $_.FullName 2>&1; $exit = $LASTEXITCODE; $passLine = $output | Select-String 'pass \d+' | Select-Object -Last 1; $skipLine = $output | Select-String 'skipped \d+' | Select-Object -Last 1; if ($passLine) { $passed += [int]($passLine.Line -replace '\D','') }; if ($skipLine) { $skipped += [int]($skipLine.Line -replace '\D','') }; if ($exit -ne 0) { $failed++; Write-Output "FAILED: $($_.Name)"; $output } }; Write-Output "FILES=$files PASSED=$passed FAILED_FILES=$failed SKIPPED=$skipped"; if ($failed -gt 0) { exit 1 }
```

Result: `FILES=13 PASSED=65 FAILED_FILES=0 SKIPPED=0`.
