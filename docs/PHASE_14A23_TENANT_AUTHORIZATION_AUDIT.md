# Phase 14A.23 — Tenant Authorization Negative-Path Audit

**Date:** 2026-11-10
**Status:** PASS (source audit and synthetic SQLite regression suite); production readiness NOT ESTABLISHED
**Scope:** Tenant authorization source, route registrations, existing route tests and an added cross-endpoint negative-path test. No database server was contacted.

## Result

No concrete authorization defect was found in the reviewed implementation. The tenant context resolves a current active account from the database, rejects global `super_admin`, and authorizes only an active membership joined to an active College with an endpoint-approved membership role. A caller-supplied College ID is only a selector; it must match that membership. The route handlers filter owned data by the resolved College and exclude NULL ownership. Legacy business routers retain the authentication-then-503 default-deny dependency. The only write among the 17 enabled operations is the reviewed College profile `display_name` update for a `college_admin` membership.

The new regression file exercises the negative authorization outcomes across all 16 College-context operations (profile GET/PATCH, catalog/record list/detail for six business resources, and two dashboard reads), plus unauthenticated access to the membership-discovery operation. Existing isolated suites provide record-level foreign/NULL ownership, same-College relationship, protected-payload and default-deny assertions. The tenant migration is still **DRAFT / NOT APPLIED**, therefore runtime PostgreSQL schema compatibility is **NOT TESTED**.

## Endpoint-by-endpoint authorization inventory

All context-bearing routes require `get_current_user`, which resolves an active User from the database and takes the role from that User rather than trusting the JWT role claim. `college_id` is an optional positive selector. No selector with multiple active memberships yields 409; no active membership, suspended College, mismatched selection, Super Admin, or insufficient membership role yields 403. Invalid non-positive selectors are rejected by request validation (422). SQL/schema errors use route-specific sanitized 503 responses.

| Operation | Handler and membership policy | Ownership / disclosure behavior | Result from review |
|---|---|---|---|
| `GET /tenant/memberships` | `tenant_memberships.list_my_active_college_memberships`; active authenticated account; no College role required; Super Admin denied | Returns only that user's active memberships joined to active Colleges; no inferred membership; no business records | PASS; 401 unauthenticated, 200 empty for no eligible memberships, 403 Super Admin, sanitized 503 on SQL failure |
| `GET /tenant/pilot/college-profile` | `tenant_pilot.read_college_profile`; active `college_admin`, `teacher`, or `student` membership | Resolves the active College from the verified membership; does not accept body-supplied identity | PASS; foreign selector 403; ambiguous selector 409; missing College 404; unavailable tenant schema 503 |
| `PATCH /tenant/pilot/college-profile` | `tenant_pilot.update_college_profile`; active `college_admin` membership only | Same verified context; schema allows `display_name` only and forbids extra fields, including College ID/status | PASS; other membership roles 403; foreign selector 403; protected/unrelated body fields 422 |
| `GET /subjects/` | `tenant_subjects.list_tenant_subjects`; `college_admin`, `teacher`, or `student` membership | Filters `Subject.college_id` to context and `IS NOT NULL` | PASS; no NULL/foreign rows in list; SQL/schema failure sanitized 503 |
| `GET /subjects/{subject_id}` | `tenant_subjects.read_tenant_subject`; same read roles | ID and College filtered together; NULL, foreign, and missing records share 404 | PASS |
| `GET /classes/` | `tenant_classes.list_tenant_classes`; same read roles | Filters Class ownership to context and `IS NOT NULL` | PASS |
| `GET /classes/{class_id}` | `tenant_classes.read_tenant_class`; same read roles | ID and College filtered together; NULL, foreign, and missing share 404 | PASS |
| `GET /teachers/` | `tenant_teachers.list_tenant_teachers`; same read roles | Filters Teacher ownership to context and `IS NOT NULL` | PASS |
| `GET /teachers/{teacher_id}` | `tenant_teachers.read_tenant_teacher`; same read roles | ID and College filtered together; NULL, foreign, and missing share 404 | PASS |
| `GET /students/` | `tenant_students.list_tenant_students`; `college_admin` membership only | Filters Student ownership to context and `IS NOT NULL`; response schema is limited | PASS; Teacher/Student memberships denied |
| `GET /students/{student_id}` | `tenant_students.read_tenant_student`; `college_admin` membership only | ID and College filtered together; NULL, foreign, and missing share 404 | PASS |
| `GET /attendance/` | `tenant_attendance.list_tenant_attendance`; `college_admin` membership only | Filters Attendance by context and non-NULL ownership; inner joins require Student and Teacher ownership to equal the attendance College | PASS; missing, foreign, NULL, and inconsistent rows excluded |
| `GET /attendance/{attendance_id}` | `tenant_attendance.read_tenant_attendance`; `college_admin` membership only | Same parent predicates and College-scoped ID; inconsistent, NULL, foreign, and missing share sanitized 404 | PASS |
| `GET /attendance-records/` | `tenant_attendance.list_tenant_attendance_records`; `college_admin` membership only | Record, Student, Teacher, Subject, Class, TeacherAssignment and StudentClassAssignment must carry the same College; non-NULL owner required | PASS; response schema omits sensitive evidence fields |
| `GET /attendance-records/{record_id}` | `tenant_attendance.read_tenant_attendance_record`; `college_admin` membership only | Same relationship predicates and College-scoped ID; inconsistent/foreign/NULL/missing share sanitized 404 | PASS |
| `GET /tenant/dashboard/summary` | `tenant_dashboard.dashboard_summary`; `college_admin` membership only | Each entity aggregate filters the context College and excludes NULL ownership | PASS; aggregate schema contains counts only |
| `GET /tenant/dashboard/attendance-summary` | `tenant_dashboard.attendance_summary`; `college_admin` membership only | Uses the same College equality chain for attendance parents and assignment/enrollment links; NULL owner excluded | PASS; aggregate fields only; no sensitive row detail |

## Negative-path coverage

The added `backend/tests/test_tenant_authorization_negative_paths.py` uses `Base.metadata.create_all()` against an in-memory SQLite engine and synthetic Users/Colleges/memberships. It does not insert business records or connect to an external database.

| Case | Coverage and observed response |
|---|---|
| Unauthenticated | New test exercises all 17 enabled operations; each returns 401 with no College sentinel in the response |
| No active membership | New test exercises all 16 College-context operations; 403 and no College sentinel. Membership discovery correctly returns `200 []` because it is a self-service selector, not College data access |
| Inactive membership | All 16 context operations return 403; membership discovery returns an empty list |
| Suspended College | All 16 context operations return 403; membership discovery excludes it |
| Foreign selected College | New table-driven coverage returns 403 across all 16 context operations, with no foreign College sentinel |
| Foreign, NULL/UNKNOWN and missing record IDs | Existing Subjects, Classes, Teachers, Students, Attendance and Attendance Records tests verify same sanitized 404 for applicable detail APIs. List tests verify NULL ownership is excluded |
| Ambiguous active memberships | New coverage verifies 409 across all 16 context operations without explicit selection; existing selector tests verify explicit matching membership works |
| Global Admin / legacy Admin | Existing tests verify no College access without membership and no automatic membership/role promotion |
| Super Admin | Existing and new tests verify no implicit College membership/access; contexts deny it regardless of JWT role claim |
| Membership role mismatch | New matrix tests verify teacher is denied on College profile PATCH, Students, Attendance, Attendance Records, and both dashboard operations. Existing suites verify allowed catalog read roles and admin-only restrictions |
| Legacy reads and writes | Existing API tests verify representative session, face, guardian, assignments, dashboard, analytics, notification and business write requests hit the sanitized 503 gate before handler logic |
| College profile payload | Existing tests verify College ID/status and unrelated fields are rejected, and other College display data is unchanged |
| Same-College parents | Existing synthetic tests verify attendance joins exclude inconsistent parents and composite relationship constraints reject cross-College assignment data |

For denied cases, assertions check status and exclude synthetic College-name sentinels. Detail-ID tests additionally compare the exact sanitized 404 bodies. The existing gate tests compare the exact sanitized 503 response.

## Gate and ownership review

- `backend/app/main.py` registers the tenant overlays before legacy routes with duplicate URLs. The legacy business routers carry `block_unscoped_legacy_business_api` and are omitted from OpenAPI; no broad wildcard/prefix exemption was found.
- The enabled list remains exactly the 17 operations above. No extra business route or write was added. Auth, root, and health are outside the business tenant gate for their separate purposes.
- `tenant_api_gate.block_unscoped_legacy_business_api` first requires authentication and then returns 503 without calling the legacy handler.
- `resolve_tenant_context` reads current user status/role from the database, excludes inactive memberships and inactive Colleges, requires explicit choice when multiple active memberships exist, and treats `college_id` solely as a selector.
- `resolve_college_record` and list predicates exclude NULL ownership; foreign, unknown, and missing details are deliberately indistinguishable. Attendance reads also validate parent ownership with join predicates. The ownership migration defines composite same-College relationships, but remains unapplied.
- No default College, ownership assignment/backfill, automatic membership creation, role promotion, or draft migration change was introduced in Phase 14A.23.

## Findings and remaining risks

- **PASS:** Source and existing test review found no concrete authorization defect requiring a policy or runtime code change.
- **PASS:** Added cross-endpoint denial tests reduce the chance of route-specific omissions; existing record and gate suites cover the detailed data and legacy behaviors.
- **UNKNOWN / NOT TESTED:** PostgreSQL enforcement of the draft constraints and actual deployed schema. All executed API tests use synthetic SQLite; they do not prove PostgreSQL behavior.
- **NOT TESTED:** Production API endpoint, browser UI, production configuration, or live data behavior.
- **DRAFT / NOT APPLIED:** Ownership migration; NULL historical records remain UNKNOWN and excluded. Manual ownership reconciliation remains necessary before those records can become tenant-visible.
- **BLOCKED / NOT APPROVED:** Credential rotation A–E remains blocked. No credential or DPAPI file was accessed.
- **UNRELATED WORKTREE STATE:** Git status already showed numerous modified and untracked user files. Phase 14A.23 changed only the new test and the three Phase 14A.23 documentation files; pre-existing changes were preserved. No frontend files changed, so frontend tests and build were not run.

## Validation

From `backend`, using the existing parent project virtual environment:

```powershell
$env:ATTENDX_SKIP_DOTENV='1'
$env:ATTENDX_TEST_SQLALCHEMY_URL='sqlite://'
..\.venv\Scripts\python.exe -m unittest tests.test_tenant_authorization_negative_paths -v
..\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_tenant*.py'
..\.venv\Scripts\python.exe -c "import ast, pathlib; ast.parse(pathlib.Path('tests/test_tenant_authorization_negative_paths.py').read_text(encoding='utf-8')); print('AST PASS')"
```

- Focused negative-path tests: **5 passed, 0 failed**.
- Complete tenant suite: **125 passed, 0 failed**.
- Python AST parse of the changed test: **PASS**; does not import application configuration.
- `git diff --check`: **PASS** (existing line-ending advisories only).
- Scoped trailing-whitespace scan: **PASS**.
- Frontend suite/build: **NOT RUN** (no frontend files changed).
- Browser/PostgreSQL tests: **NOT TESTED**.

The backend-local virtual environment could not import `fastapi.testclient` because its Starlette installation requires missing `httpx2`. No install was attempted. Tests passed using the already-installed parent project environment, which has the compatible `httpx` TestClient path; it emitted a Starlette deprecation warning recommending `httpx2`, plus SQLite datetime deprecation warnings. Initial attempts with the global Python and backend-local venv failed during import (missing FastAPI/SQLAlchemy and missing `httpx2`, respectively); these are environment limitations, not assertion failures. The successful focused and full runs used the exact safe dotenv opt-out and synthetic SQLite URL above.

No PostgreSQL/database connection or operation, migration, secret/credential/DPAPI access, environment-file inspection, service/cluster/port/ACL/firewall operation, commit, push, or destructive Git operation occurred. Production readiness is not claimed.
