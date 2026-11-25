# Phase 15 Coursework Follow-up — 2026-11-15

## Status

**PARTIALLY COMPLETE — coursework is not live and is not deployment-ready.** This follow-up records safe source corrections and validation. The Coursework and account-link routers remain unmounted; no schema change or migration was applied.

## Source changes in this follow-up

- `backend/app/api/tenant_coursework.py`: grade detail responses now return all immutable grade versions scoped by submission and College. The Student submission-history endpoint now also returns the current grade and its history, matching the fields already consumed by the Student page. The grade action requires an active linked Student account, active User, and active Student College membership before creating a grade or notification.
- `backend/app/schemas/coursework.py`: added `grade_history` to Teacher/Admin submission detail and Student submission-history responses; added the Student history response's `current_grade`.
- `frontend/src/pages/teacher/TeacherAssignments.jsx` and `frontend/src/pages/student/StudentAssignments.jsx`: show grade versions, feedback, revision association, and grading time from the server response.
- `backend/tests/test_tenant_coursework_isolated.py`: verifies repeated grading versions and that Teacher detail and Student history return both versions and the latest grade.
- `backend/tests/test_coursework_orm_contract_static.py`: includes grade-table ORM columns/constraints and static assertions for the draft's triggers and unapplied status.
- `database/migrations/DRAFT_20261115_08_coursework_submission_grades.sql`: now explicitly identifies itself as DRAFT / NOT APPLIED, names its prerequisites, and warns it is non-idempotent. This is a draft annotation only; SQL was not executed or PostgreSQL-parsed.
- `backend/tests/test_tenant_phase14a18_readiness.py`: exact OpenAPI expectation now includes the four already-registered tenant notification operations.
- `frontend/tests/coursework-service-contract.test.mjs` and `frontend/tests/coursework-migration-required.test.mjs`: stale assertions were aligned with the current safe error text and feature-setup state; runtime behavior was not weakened.

Timestamped copies of changed pre-existing files were created outside the repository before edits. Paths:

- `%LOCALAPPDATA%\Temp\attendx_grade_history_20261115_110711_772`
- `%LOCALAPPDATA%\Temp\attendx_coursework_followup_20261115_110910_413`
- `%LOCALAPPDATA%\Temp\attendx_coursework_admin_test_20261115_111208_871`
- `%LOCALAPPDATA%\Temp\attendx_openapi_expectation_20261115_111438_239`
- `%LOCALAPPDATA%\Temp\attendx_coursework_reports_20261115_111749_283`

## Route and database readiness

- `backend/app/main.py` does not include `tenant_coursework` or `tenant_account_links`; those routes are not available in the running FastAPI application and must stay unmounted until schema and PostgreSQL integration are verified.
- `tenant_notifications_router` is registered. The four OpenAPI operations are `GET /tenant/notifications`, `POST /tenant/notifications/read-all`, `GET /tenant/notifications/unread-count`, and `PATCH /tenant/notifications/{notification_id}/read`. OpenAPI/source tests passed; no live HTTP call was made.
- The latest database inspection was a read-only PostgreSQL transaction against the configured local target, guarded to database `attendx`, role `postgres`, loopback port `5432`, schema `public`, search path `"$user", public`; server reported PostgreSQL 18.6. No database writes, DDL, migration, or backup occurred.
- The seven missing public relations are `student_account_links`, `teacher_account_links`, `coursework_assignments`, `coursework_submissions`, `coursework_submission_revisions`, `coursework_submission_grades`, and `coursework_assignment_audit_events`. They are required by the prepared account-link/Coursework implementation.
- `notification_events` exists and has nullable `college_id`; the inspected catalog had composite College foreign keys marked `NOT VALID` and lacked `ck_notification_events_coursework_requires_college`. Notification schema reconciliation remains outstanding.
- The catalog had no application migration ledger. Twenty-nine public foreign keys were reported `NOT VALID`. Nullable ownership remains unknown: students 23, teachers 10, classes 3, subjects 4, teacher assignments 5, student-class assignments 5. No ownership was inferred or assigned.
- No migration is approved or applied. The isolated PostgreSQL 18 rehearsal cluster is not available for this run; its previous authentication/cluster discrepancy remains unresolved. A real migration rehearsal, backup/restore rehearsal, and any migration against `attendx` remain blocked pending separately reviewed approval.

## Validation

### PASS

- Focused backend suite, synthetic SQLite/static only: **46 passed, 0 failed**.
  ```powershell
  $env:ATTENDX_SKIP_DOTENV='1'
  $env:ATTENDX_TEST_SQLALCHEMY_URL='sqlite://'
  .\.venv\Scripts\python.exe -m unittest tests.test_tenant_coursework_isolated tests.test_tenant_account_links_isolated tests.test_coursework_orm_contract_static tests.test_notification_events_college_scope_migration_static
  ```
- Focused OpenAPI/readiness suite: **7 tests, 6 passed, 1 skipped**. The skip is the default-deny HTTP test because installed Starlette requires unavailable `httpx2` for `TestClient`.
- Coursework frontend source-contract tests run directly and serially: **13 passed, 0 failed** across `coursework-workspaces.test.mjs` (7), `coursework-service-contract.test.mjs` (4), and `coursework-migration-required.test.mjs` (2).
- Python AST syntax: **5 changed Python files passed**.
- `git diff --check`: **PASS** (Git emitted pre-existing LF-to-CRLF notices for unrelated files).
- Scoped trailing-whitespace check: **PASS**, all 11 then-current changed code/test/SQL files.

### FAIL / BLOCKED / NOT TESTED

- Full backend discovery: **242 tests; 0 assertion failures, 30 import errors, 2 skipped**. The 30 errors are TestClient-dependent modules failing during import because `starlette.testclient` requires missing `httpx2`. Dependencies were not installed. SQLite is not PostgreSQL compatibility evidence.
- Full frontend suite, each file launched serially with `node <file>`: **203 tests; 178 passed, 25 failed**. Twenty-four component/public-page failures (face camera 5, landing 4, public pages 9, Super Admin Colleges 2, Super Admin review 4) were `spawn EPERM` from Vite/esbuild. One failure was the pre-existing `frontend/dist` artifact audit finding a production loopback fallback; `frontend/dist` was not changed.
- Vite validation build: **FAIL / BLOCKED** before module transform (`0 modules`), `spawn EPERM` from Vite's `optimizeSafeRealPathSync`. It used a fresh empty environment directory, `https://attendx-validation.invalid`, and a unique temporary output directory outside the repository. No `.env` was inspected and `frontend/dist` was untouched.
- Browser UI: **NOT TESTED**.
- PostgreSQL Coursework persistence, migrations, triggers, concurrency, and real HTTP APIs: **NOT TESTED**.

## Remaining blockers

1. The Coursework tables and identity-link tables do not exist in the inspected database; do not mount the prepared Coursework/account-link routers or represent the feature as operational.
2. Review and approve all draft SQL, including DRAFT 08, against an authorized disposable PostgreSQL 18 target, then rehearse failure/rollback and backup/restore. The isolated target is not currently available.
3. Resolve the live notification constraint/FK validation mismatch before claiming College-scoped notification schema compliance.
4. Resolve the missing `httpx2` test environment dependency through a separately approved dependency decision; resolve Windows `spawn EPERM` through an authorized test/build environment, not by weakening system security.
5. After those gates, run PostgreSQL integration tests and browser end-to-end Teacher → Student → College Admin workflows before enabling Coursework routes.

**No PostgreSQL write, migration, backup, credential action, service operation, dependency installation, or Git publication occurred.**


## Superseding Phase 16 status notice - 2026-11-15

The source, route, and migration statements in this Phase 15 follow-up are historical and are superseded by the later Phase 16 reports. Phase 16 documents local schema migration and router integration; this stabilization pass did not freshly query PostgreSQL. Current generated OpenAPI includes the tenant Coursework, account-link, and notification operations, with legacy global `/assignments/` absent. End-to-end acceptance remains BLOCKED/NOT TESTED pending operator-verified account links and authenticated PostgreSQL workflows.
