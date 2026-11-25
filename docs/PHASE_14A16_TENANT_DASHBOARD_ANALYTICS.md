# Phase 14A.16 — Tenant Admin Dashboard and Analytics Read-only

**Date:** 2026-11-10
**Status:** Tenant dashboard aggregate implementation PASS in application code and synthetic SQLite tests. PostgreSQL/deployed ownership schema NOT TESTED; migration DRAFT / NOT APPLIED. Browser rendering NOT TESTED.

## Endpoint inventory

| Existing or new endpoint | Source / behavior | Phase 14A.16 status |
|---|---|---|
| `GET /tenant/dashboard/summary` | New College Admin aggregate endpoint; counts Student, Teacher, Class, Subject | Enabled; per-request active College membership and explicit tenant filters |
| `GET /tenant/dashboard/attendance-summary` | New aggregate endpoint; separately counts legacy Attendance and qualified AttendanceRecord rows and their statuses | Enabled; Phase 14A.15 relationship rules reused |
| `GET /admin-dashboard` and `/admin-dashboard/` | Existing global AdminDashboard; counts Users, all business rows and face registrations | BLOCKED by default-deny gate; not called from the active Admin dashboard |
| `GET /analytics/overview`, `/analytics/records`, `/analytics/low-attendance` | Existing global/role-based SQL queries over sessions/events and student-level data | BLOCKED by default-deny gate; no tenant exemption added |
| `GET /dashboard/student/attendance` | Legacy email-matched Student dashboard query | BLOCKED by default-deny gate |
| `GET /tenant/analytics/attendance` | Proposed trend endpoint | NOT ADDED: current association models lack effective dates to establish historical assignment/enrollment validity |

All other old dashboard/analytics routes remain attached to `legacy_business_dependencies`. Only the two exact new GET routes were added. The existing College profile GET/PATCH pilot remains unchanged; no write route was added for dashboard/analytics.

## Data-source and metric inventory

| Metric | Source table/model | College and relationship filters | NULL/UNKNOWN | Accuracy and limits |
|---|---|---|---|---|
| Students total/active/inactive | `students` / `Student` | `Student.college_id == resolved college_id`; active is `is_active = true`; inactive is its complement | Excluded by equality predicate | Direct owned-profile row counts; no join or User/email matching |
| Teachers total/active/inactive | `teachers` / `Teacher` | `Teacher.college_id == resolved college_id`; active is `is_active = true` | Excluded | Direct owned-profile counts; no User/email join |
| Classes total/active/inactive | `classes` / `Class` | `Class.college_id == resolved college_id`; active is `is_active = true` | Excluded | Direct owned-catalog counts |
| Subjects total/active/inactive | `subjects` / `Subject` | `Subject.college_id == resolved college_id`; active is `is_active = true` | Excluded | Direct owned-catalog counts |
| Legacy attendance row count | `attendance` / `Attendance` | Row College equals resolved College; inner joins require same-College Student and Teacher | NULL and mismatched/missing parents excluded | Reported separately from AttendanceRecord; these tables are not summed together |
| Qualified attendance record count/statuses | `attendance_records` / `AttendanceRecord` | Same-College Student, Teacher, Subject and Class; same-College exact TeacherAssignment (Teacher/Subject/Class) and StudentClassAssignment (Student/Class) required; IDs counted distinct after joins | NULL and mismatched/missing/unassociated rows excluded | Count means records with explicit ownership and current association evidence; inactive historical associations are not discarded |
| Recorded presence rate | Qualified AttendanceRecord rows with status present/late/absent | Numerator = present + late; denominator = present + late + absent; unclassified statuses counted separately and excluded from denominator | NULL/invalid ownership rows excluded; unknown statuses excluded from denominator | `null` when denominator is zero. This is not a scheduled-class or per-student attendance/compliance rate. |
| Attendance trends / date-specific class-teacher-enrollment analytics | Assignment/enrollment history and attendance dates | Would require effective/valid date relationships that are absent in current models | UNKNOWN historical attribution is not backfilled or inferred | NOT AVAILABLE; no chart or fabricated values are returned |

`Attendance` has only Student and Teacher parents and no Class, Subject, or Session ID. `AttendanceRecord` has direct Class/Subject fields and is checked against ownership-matched association rows. Neither dashboard metric reads `AttendanceSession` or `AttendanceEvent`; those session/event routers and data remain outside this feature. No global User, FaceEmbedding, guardian, QR, location, verification, or student/teacher profile data is returned.

The ORM ownership columns and composite constraints correspond to `DRAFT_20261109_add_tenant_ownership_v1.sql`, which remains **DRAFT / NOT APPLIED**. Missing required tables/columns return sanitized 503. SQLite fixture success does not establish PostgreSQL or deployed schema availability.

## Authorization and response

Both endpoints resolve the caller's active `college_admin` membership in an active College on every request. Optional `college_id` is only a selector among the caller's active memberships; a foreign or suspended College is denied and ambiguous membership remains 409. Global `User.role` does not authorize the request; Super Admin remains separate. Query failures are returned as sanitized 503. Strict response models contain aggregate numbers and a fixed trend-unavailable explanation only; no College ID, user identifiers, names, emails, student/teacher rows, remarks, password fields, biometric fields, QR secrets or location fields are exposed.

Counts are computed separately per entity to prevent multiplication from joins. AttendanceRecord rows are deduplicated by record ID before aggregation. For zero classified rows, the recorded presence percentage is `null`, not zero. No aggregate substitutes a global total.

## Frontend and legacy callers

The `/admin` index now renders `TenantAdminDashboard.jsx`, which uses AuthContext `activeCollegeId` and a GET-only `tenantDashboard.js` service. It clears summary/attendance/error state on selection change, uses a latest-request guard, and presents loading, empty, partial, error, and unavailable states. Dashboard cards distinguish active and total counts. The attendance panel clearly defines the recorded-presence numerator and denominator and shows why trends are unavailable. It displays no fabricated chart data and contains no write controls or localStorage authorization reads.

The prior modified `AdminDashboard.jsx` is preserved but no longer mounted at the Admin home route. It previously called global dashboard/analytics and attendance-session services, showed global face counts and student-level low-attendance rows, and displayed session metrics. The new active dashboard does not invoke those clients. Legacy Reports components/services still reference the gated global analytics endpoints; their APIs remain unavailable and were not modified or enabled by this phase.

## Validation

- Tenant-focused backend suite from `backend`: `..\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_tenant_*' -v` — **114 passed, 0 failed, 0 skipped**, using synthetic in-memory SQLite and an in-process FastAPI test app. Eight new dashboard tests cover membership/suspension, cross-College selectors, NULL/inconsistent ownership, duplicate joins, empty denominator, response privacy, missing schema, and legacy gates. Starlette emitted a non-fatal TestClient deprecation warning; no dependency was installed.
- Focused backend command: `..\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_tenant_dashboard_isolated.py' -v` — **8 passed, 0 failed, 0 skipped**.
- Frontend serial command from `frontend`: `$failed = 0; $files = 0; $passed = 0; $skipped = 0; Get-ChildItem tests -Filter '*.test.mjs' | Sort-Object Name | ForEach-Object { $files++; $output = & node $_.FullName 2>&1; $exit = $LASTEXITCODE; $passLine = $output | Select-String 'pass \d+' | Select-Object -Last 1; $skipLine = $output | Select-String 'skipped \d+' | Select-Object -Last 1; if ($passLine) { $passed += [int]($passLine.Line -replace '\D','') }; if ($skipLine) { $skipped += [int]($skipLine.Line -replace '\D','') }; if ($exit -ne 0) { $failed++; Write-Output "FAILED: $($_.Name)"; $output } }; Write-Output "FILES=$files PASSED=$passed FAILED_FILES=$failed SKIPPED=$skipped"; if ($failed -gt 0) { exit 1 }` — **13 files, 65 passed, 0 failed, 0 skipped**. Axios service calls are mocked; view changes are source checks, not browser interaction tests.
- Vite production build: `npm run build` — PASS on retry; Vite 7.3.7 transformed **1,936 modules**. Restricted attempt failed before transform with Windows `spawn EPERM`; retry outside the restricted sandbox passed. Non-fatal ignored `use client` directives and >500 kB chunk warning remain.
- Python syntax: `ast.parse` passed for 4 changed Python files without bytecode output (exact command recorded in `docs/TEST_RESULTS.md`).
- `git diff --check`: PASS. Scoped trailing-whitespace scan: PASS for Phase 14A.16 changed source/test/docs files.
- Browser rendering: NOT TESTED. PostgreSQL/deployed schema/migration behavior: NOT TESTED.

## Remaining limitations and safety

The migration remains **DRAFT / NOT APPLIED**, so a deployment without tenant columns/association schema returns 503. The recorded presence rate denominator is only classified owned AttendanceRecord rows; it cannot estimate scheduled attendance or student compliance. Assignment and enrollment effective dates are not modeled, so date-specific historical relationships and trend analytics remain unavailable. No College, membership, ownership, user, database or migration was created or changed. Credential rotation A–E remains **BLOCKED / NOT APPROVED**. No PostgreSQL, real database, credential, DPAPI, service, cluster, ACL or port operation occurred. Phase 14A.17 was not started; production readiness is not claimed.
