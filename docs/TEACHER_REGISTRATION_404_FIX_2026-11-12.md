# Teacher registration HTTP 404 investigation - 2026-11-12

## Findings

**Confirmed source defect:** The registration dialog loaded the tenant-scoped Class and Subject lists but rendered every returned row, including rows with `is_active: false` or missing activity state. The `POST /teachers/` handler explicitly accepts only same-College active Class and Subject records. Choosing an inactive row could therefore produce the displayed HTTP 404. This is a confirmed UI/backend contract mismatch.

**Live record root cause: UNKNOWN.** The supplied request URL and response detail establish that the request reached `create_tenant_teacher` and failed the assignment reference validation. Source inspection cannot determine whether the selected Class, Subject, or both were inactive, foreign-owned, absent, or stale in the live `attendx` database. No database was accessed.

## Route and payload contract

- `backend/app/main.py` registers `tenant_teachers_router` at `/teachers` before the legacy `/teachers` router. The latter remains behind the default-deny dependency and is excluded from OpenAPI. Tenant registration is `POST /teachers/`.
- `frontend/src/services/teachers.js:createTeacher(payload, collegeId)` calls `api.post("/teachers/", payload, selectedCollegeParams(collegeId))`; it sends `college_id` as a query parameter through the validated selected-College helper.
- `frontend/src/pages/auth/admin/Teachers.jsx:submitRegistration` sends Teacher profile fields, password/confirmation, and `assignments` as an array. Each assignment carries numeric `class_id`, numeric `subject_id`, `academic_year`, and numeric `semester`. Assignments may be omitted/empty.
- `backend/app/schemas/tenant_registration.py:TenantTeacherCreate` validates that payload and defaults assignments to an empty list.
- `backend/app/api/tenant_teachers.py:create_tenant_teacher` derives the authorized College from active membership context, checks each Class and Subject belongs to that College and is active, and only then creates the User, Teacher, membership, and assignments in the same transaction. Invalid assignment references return a sanitized 404 and no Teacher account is created.
- `Class` and `Subject` each have a College ownership column; `TeacherAssignment` has composite same-College foreign keys to Teacher, Class, and Subject. There is no separate Class-Subject mapping entity in the inspected model, so no such compatibility rule was inferred.
- `GET /tenant/attendance/sessions/assignments?college_id=...` resolves the authenticated Teacher from active tenant context and returns only that Teacher's current same-College assignments. The synthetic registration test logs in as the created Teacher and verifies the created Class/Subject pair appears in this dashboard data endpoint.

## Change

Added `activeAssignableRecords` to `frontend/src/utils/tenantAssignments.js`. Both registration and profile assignment dropdowns now include only records explicitly marked active with a positive integer database ID. The backend validation and its sanitized 404 remain unchanged. No ownership check was relaxed.

Added synthetic frontend and backend regression coverage. The HTTP-level synthetic SQLite test verifies that an active same-College Class/Subject pair is persisted, a newly registered Teacher can log in, and the Teacher Dashboard assignments endpoint returns the same Class and Subject IDs. Inactive Class, inactive Subject, foreign Class, and foreign Subject references each return the existing 404 and leave no User or Teacher behind. Duplicate Teacher registration returns 409; duplicate assignment payloads return 422 without partial account creation. Existing route coverage verifies registration without assignments succeeds. These tests are not PostgreSQL compatibility evidence.

## Validation

- Backend command from `backend`: `$env:ATTENDX_SKIP_DOTENV='1'; $env:ATTENDX_TEST_SQLALCHEMY_URL='sqlite://'; $env:SECRET_KEY='synthetic-test-key-only-not-for-real-authentication'; ..\.venv\Scripts\python.exe -m unittest tests.test_tenant_teachers_api_isolated tests.test_tenant_teacher_management -q` - **15 passed, 0 failed**.
- Frontend command from `frontend`: `node --test tests/tenant-teachers.test.mjs` - **5 passed, 0 failed**. The sandbox attempt failed before loading the file with `spawn EPERM`; retry with approved process-spawn permission passed.
- Validation build from `frontend`: `npm run build -- --config .phase-teacher-404-config-20261112.mjs` with an empty temporary `envDir`, `VITE_API_BASE_URL=https://attendx-validation.invalid`, and temporary output `.phase-teacher-404-build-20261112` - **PASS**, 1,959 modules transformed. Existing `frontend/dist` was not written. Build is validation-only; non-fatal module directive and chunk-size warnings remain.
- Python AST, `git diff --check`, and scoped trailing-whitespace scan: **PASS**.
- Live PostgreSQL data, browser submission, account login against PostgreSQL, and actual College 5 Class/Subject state: **NOT TESTED**.

## Acceptance

The confirmed UI mismatch is fixed. **Do not claim the live College 5 registration flow is verified or fully fixed** until an authorized PostgreSQL-backed registration with valid records succeeds. If there are no active same-College Classes/Subjects, register without assignments and add valid assignments later; no records were created by this work.

No PostgreSQL/application database access, SQL, migration, `.env` or credential access, service operation, or frontend `dist` overwrite occurred. Regression tests used synthetic SQLite only.
