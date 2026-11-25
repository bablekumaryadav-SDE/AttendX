# Coursework Assignments and Notifications — Implementation Status

**Status: BLOCKED — NOT OPERATIONAL**
**Review date:** 2026-11-14
**Scope:** Existing source and migration documentation review; frontend safety work; no database access or migration execution in this phase.

## Implementation continuation — 2026-11-14

The earlier source-review findings below describe the baseline before the continuation implementation. Current source now includes:

- Coursework SQLAlchemy models in `backend/app/models.py`, Pydantic schemas in `backend/app/schemas/coursework.py`, and prepared routes in `backend/app/api/tenant_coursework.py` for active Teacher mappings, Teacher draft/list/edit/publish/archive/deadline extension, Student published work/text submissions/history, and read-only College Admin monitoring/submission review.
- An unmounted recipient-scoped in-app notification router in `backend/app/api/tenant_notifications.py`. Coursework publish/submission creates idempotent `queued` in-app events in the same transaction; these rows do not claim email/SMS delivery. No provider or deadline scheduler was added.
- A frontend client in `frontend/src/services/coursework.js` that uses the shared API client and requires the AuthContext-selected College ID. Coursework pages remain migration-required and do not dispatch these requests while the router is unmounted.
- Synthetic SQLite authorization/workflow tests and focused frontend service-contract tests. These do not establish PostgreSQL trigger, locking, persistence, or production behavior.

**Current state:** Source implementation prepared; Coursework and notification routers remain deliberately unmounted, UI remains unavailable, and all seven related migration drafts remain **DRAFT / NOT APPLIED**. The isolated PostgreSQL 18 rehearsal target is still not established. Do not claim these modules are operational.

## Outcome

The Teacher and Student assignment pages and College Admin monitoring page are wired into their role-protected workspaces, but remain explicitly disabled and make no API requests. This prevents the UI from presenting fabricated records or claiming a save succeeded. No Coursework backend API, ORM model, request/response schema, or service is present, so there is no real end-to-end Coursework workflow to enable safely.

The five Coursework SQL drafts remain **DRAFT / NOT APPLIED** according to the existing reconciliation record. They are not proof of current database state. Their documented next step is a separately approved disposable PostgreSQL rehearsal and migration review. No PostgreSQL connection, database operation, or migration was performed for this status update.

## Role workflow status

| Role/workflow | Current implementation | Status |
|---|---|---|
| Teacher: create draft, publish, set deadline/instructions, view submissions | `frontend/src/pages/teacher/TeacherAssignments.jsx` is an inert preview. Controls are disabled. No coursework service/API exists. | **BLOCKED** |
| Student: list published work, statuses, text submission, history/confirmation | `frontend/src/pages/student/StudentAssignments.jsx` is an inert preview. No coursework service/API exists. Student account link and active enrollment checks are prerequisites. | **BLOCKED** |
| College Admin: monitor/filter assignment and submission progress | `frontend/src/pages/CourseworkMigrationRequired.jsx` is read-only and has no live data. No College coursework API exists. | **BLOCKED** |
| Assignment notification on publish | No Coursework publish API/event producer exists. | **NOT IMPLEMENTED** |
| Notification to Teacher on submission | No Coursework submission API/event producer exists. | **NOT IMPLEMENTED** |
| Deadline reminders | No scheduler/background worker or delivery implementation was established in the inspected source. | **NOT IMPLEMENTED** |
| User inbox, unread count, mark-as-read | The legacy notification endpoints exist but are default-denied; the mounted tenant event listing is College Admin read-only and does not provide a user inbox or mark-read action. | **BLOCKED** |
| Email/SMS provider delivery | No provider-confirmed Coursework delivery flow was found. Existing attendance event code describes queued in-app events and does not prove external delivery. | **NOT IMPLEMENTED** |

No notification is described as delivered without provider confirmation. A stored event, queued event, in-app visibility, read status, and provider-confirmed delivery must remain separate facts.

## API and security findings

1. `backend/app/api/assignments.py` is the legacy Teacher-Class-Subject mapping router. It is not Coursework. `backend/app/main.py` mounts it with `legacy_business_dependencies` and `include_in_schema=False`; this gate must remain in place.
2. No `CourseworkAssignment`, `CourseworkSubmission`, or submission revision ORM model/API was found in `backend/app` source. Consequently there are no tenant-scoped Coursework endpoints to list, publish, submit, or monitor.
3. `backend/app/api/tenant_workspace.py` exposes `GET /tenant/notification-events` for College Admin read-only monitoring, filtered by the resolved College. It exposes stored event records, not proof of delivery and not a student/teacher inbox.
4. `backend/app/api/notifications.py` has `/notifications/history`, `/notifications/mine`, and `POST /notifications/{notification_id}/read`, but `backend/app/main.py` mounts that router behind the default-deny dependency and excludes it from OpenAPI. Do not reactivate it as a shortcut: it lacks the Coursework role/College contract required here.
5. Existing absence event creation in `backend/app/api/attendance_sessions.py` is a separate attendance workflow. It creates queued events only under its existing prerequisites; it does not supply Coursework notifications or provider delivery.
6. Tenant rules for future Coursework APIs must continue to require selected active College membership for College Admin/Teacher requests. Student access must require an explicitly verified account link, active membership/account, and active enrollment; do not infer links from names, email, phone, roll numbers, or other personal fields.

## Notification schema mismatch

Static comparison found that `backend/app/models.py::NotificationEvent` defines nullable `college_id`, a College foreign key, `(id, college_id)` uniqueness, a composite Student/College foreign key, and College/user indexes. The inspected existing file `database/migrations/20261103_add_notification_events_postgresql.sql` does not define `college_id` or those College-scoped keys/indexes. Therefore that migration text alone does not establish compatibility with the ORM or tenant notification query. Its delivery status constraint (`queued`, `sent`, `failed`) also cannot by itself prove actual provider delivery; source must only mark an external delivery state after provider confirmation.

This is a **source mismatch**, not a live catalog finding in this phase. Do not repair it by executing or applying SQL. Reconcile the applied table definition and the reviewed notification migration separately before enabling any notification API that depends on the missing shape.

## Coursework schema prerequisites

The five prepared drafts and dependency order are documented in `docs/COURSEWORK_MIGRATION_RECONCILIATION.md` and `docs/COURSEWORK_SQL_DRAFT_REMEDIATION.md`:

1. `database/migrations/DRAFT_20261114_01_student_account_links.sql`
2. `database/migrations/DRAFT_20261114_02_coursework_assignments.sql`
3. `database/migrations/DRAFT_20261114_03_coursework_submissions.sql`
4. `database/migrations/DRAFT_20261114_04_coursework_submission_revisions.sql`
5. `database/migrations/DRAFT_20261114_05_coursework_assignment_audit_events.sql`

The documented graph is `01 → 02 → 03 → 04`, plus `02 → 05`. Existing reconciliation documentation records account-link verification/revocation, same-College composite keys, assignment and submission integrity, append-only revisions, audit events, and concurrency/locking rules. Those SQL drafts remain unparsed by PostgreSQL and unrehearsed; the documented lock behavior is **NOT TESTED**. The documentation also records data-integrity exceptions and says not to infer or backfill NULL ownership. Those facts must be reviewed against an authorized current disposable rehearsal before migration approval.

## Required next gates

1. Independently review and approve the five SQL drafts, their dependency/ledger adoption strategy, identity verification and Student account-link revocation policy.
2. Apply the drafts only to an authorized disposable PostgreSQL rehearsal after backup/restore and role-privilege plans are approved; verify constraints, triggers, concurrency, failure recovery, and the notification migration/model mismatch there.
3. Separately authorize target backup, migration, and post-migration catalog verification. These actions were not performed here.
4. Implement Coursework ORM/schemas/services/routes against the approved schema. Keep every new route disabled or absent until authorization, transaction and PostgreSQL tests pass.
5. Implement role-scoped in-app notification creation, retrieval, unread/read transitions, and idempotency; keep external delivery separate and report provider-confirmed results only.
6. Add isolated positive and negative tests for College boundaries, teacher mapping, explicit Student links, enrollment, draft/publish transitions, submissions/revisions, idempotency, archive/deadline races, and notification delivery/read states.

## Validation evidence and limitations

- PASS — `node tests/coursework-migration-required.test.mjs`: 1 test passed, 0 failed.
- PASS — `node tests/coursework-workspaces.test.mjs`: 5 tests passed, 0 failed.
- The normal `node --test` launcher previously failed to spawn child processes with Windows `spawn EPERM` before assertions; direct per-file Node execution was used and passed. This bypassed no system security settings.
- PASS — `git diff --check` reported no whitespace errors. Git emitted line-ending conversion warnings for unrelated existing modified files.
- A scoped trailing-whitespace scan of the phase files is recorded in the final validation below.
- These static source assertions do not establish rendered UI, API behavior, PostgreSQL persistence, or authorization at runtime.
- Frontend production build: **NOT RUN** in this phase.
- Browser rendering: **NOT TESTED**.
- Coursework API/database integration: **NOT TESTED / BLOCKED**.
- PostgreSQL migration compatibility and concurrency: **NOT TESTED** in this phase.
- No Coursework test fixtures or fake records were introduced.
- No `.env`, credentials, tokens, or `backend/create_admin.py` were accessed.
- No PostgreSQL/database connection, SQL execution, DDL/DML, migration, or database write occurred.

## Final status

Coursework Assignments and role-scoped Coursework Notifications are **NOT OPERATIONAL**. The existing inert role pages and College Admin read-only status page remain in place; legacy assignment and notification routes remain default-denied. Production readiness is not claimed.


## Superseding implementation status - 2026-11-15

The implementation and route-unmounted statements above are historical and are superseded by the later Phase 16 reports and `ATTENDX_FINAL_STABILIZATION_2026-11-15.md`. Current source registers tenant Coursework and account-link routers; the synthetic OpenAPI check reports 18 Coursework operations, 4 account-link operations, and 4 tenant notification operations. Legacy `/assignments/` remains absent from OpenAPI. This does not establish authenticated PostgreSQL workflow acceptance: the required existing Teacher and Student account links are not operator-verified, live persistence was not tested in this pass, and production readiness is NOT CLAIMED.


## 2026-11-15 coursework result-release correction

A source review found that the Teacher grade-save handler queued a student notification containing the marks and the Student list/history exposed grade rows immediately. Grade entry and result publication are now separate: grade versions remain append-only and private until the Teacher invokes the explicit result-publication operation. Student list/history query only published grade versions. The Teacher UI labels saved grades as private until publication and refreshes the submission detail after publishing.

A previously failing coursework publish path also referenced `mapping` without assigning the value returned by `_teacher_owns_assignment`. This caused a NameError on assignment publish. The handler now retains that verified mapping for its student notification function.

A new append-only publication marker is defined by `database/migrations/DRAFT_20261115_10_coursework_grade_publications.sql` and matching ORM/schema code. The migration is DRAFT / NOT APPLIED. No database connection, migration, or persistent database write was made. Existing grade rows receive no publication records and remain unpublished.

PASS: Backend synthetic SQLite suites: `tests.test_tenant_coursework_isolated` 29/29; `tests.test_coursework_orm_contract_static` 12/12; `tests.test_tenant_phase14a18_readiness` 6 passed, 1 skipped. Total: 47 passed, 1 skipped, 0 failed. The skipped item is the environment-dependent TestClient check.

PASS: Frontend Coursework Node suites executed directly and serially: migration-required 2/2; service-contract 5/5; workspaces 8/8. Total 15/15. The `node --test` multi-file harness itself failed with Windows `spawn EPERM`; direct per-file execution passed.

PASS: Babel JSX parse for `TeacherAssignments.jsx`; OpenAPI route readiness is covered by the passing readiness suite. PASS: `git diff --check` for source changes.

BLOCKED: Fresh Vite production validation build failed before transforms with Windows `spawn EPERM` in Vite `optimizeSafeRealPathSync` (Node v24.11.1, Vite v7.3.7). Output was directed to a new temporary directory outside the repository; `frontend/dist` was not touched.

NOT TESTED: PostgreSQL migration execution, actual PostgreSQL grade publication, authenticated browser workflow, and current live Teacher/Student account-link state. The publication API requires migration 10 before persisted grade release works. An authorized College Admin must verify the correct existing Teacher profile/User pair from institutional records; no profile link was inferred or created.

Other role-workflow gaps remain: assignment file uploads, assignment types and submission policy fields are not in the current schema; no file storage backend is configured; deadline reminders have no verified recurring scheduler; Admin export and delete/unarchive operations remain unavailable or constrained by append-only/terminal-state rules. These are not claimed complete. Production readiness is NOT CLAIMED.


Additional boundary: the College Admin submission-detail endpoint now returns only published grade versions; a Teacher's unpublished grade draft is private to the Teacher. Student status reports Evaluated only when a published grade exists, while late submission remains counted independently.

## Final completion follow-up — 2026-11-15

**PASS (source and isolated tests):** Added an explicit College Admin Teacher account-link status workflow. The Admin must manually provide an existing User ID and affirm identity verification from authoritative institutional records; no candidate matching or membership activation is performed. Status responses distinguish link, profile, user, and membership activity. Account-link API remains protected by active College Admin context and same-College backend checks.

**BLOCKED (live Teacher 403 root cause):** The code path requires an active verified link matching the authenticated user, College, and active Teacher profile. No live database or authenticated browser inspection was performed, so the particular cause for the reported account is UNKNOWN. No link was created. An authorized College Admin must verify the correct existing profile/User pair and use the Admin workflow; if the user or membership is inactive, resolve that through its separately authorized lifecycle flow.

**PASS:** Focused backend coursework/ORM/account-link/readiness suites: 54 passed, 1 skipped, 0 failed (55 tests; synthetic SQLite/static only). The skip is environment-dependent TestClient coverage. Focused frontend Coursework/account-link suites: 19/19 passed. Babel parsed the touched Coursework/Admin JSX files. Python AST parsed 9 changed Python files. `git diff --check` returned exit 0.

**BLOCKED:** Latest serial full frontend run executed 38 files: 206 tests, 181 passed, 25 failed, 0 skipped. Of 25 failures, 24 are `spawn EPERM` in component/browser-like test harnesses (`face-camera-component`, `landing-page`, `public-pages`, `super-admin-colleges`, `super-admin-review`); one is the artifact audit finding a loopback URL in the pre-existing `frontend/dist`. No `dist` file was modified. Earlier fresh-temporary-build artifact results do not supersede this failed normal serial run.

**BLOCKED:** Vite validation build remains blocked by Windows `spawn EPERM` during `optimizeSafeRealPathSync`; no security setting was bypassed and `frontend/dist` was not overwritten. Full backend unittest discovery reported 258 tests, 26 import errors, 2 skipped, and 0 assertion failures; import errors are environment dependency failures for missing `httpx2` (one module also lacks `httpx`). No dependencies were installed.

**NOT TESTED:** PostgreSQL cluster access/migration, actual assignment persistence, authenticated Teacher-to-Student workflow, browser dashboards, email/provider delivery, and live account-link status. Grade publication migration `DRAFT_20261115_10_coursework_grade_publications.sql` remains **DRAFT / NOT APPLIED**. No PostgreSQL operation or database write occurred. Production readiness is **NOT CLAIMED**.

This follow-up supersedes earlier full-suite totals in this document set for the 2026-11-15 run; the more recent serial result above is authoritative.
## Coursework monitoring metric follow-up - 2026-11-15

PASS: Added the missing College Admin evaluated-submission metric and per-assignment evaluated count. Counts include distinct submissions only when a grade publication record exists; private/unpublished grade drafts do not appear in Admin monitoring. Existing College filters are applied to the subqueries. The Admin assignments React route is present and matches the mounted `/tenant/coursework/admin/assignments` API path; the UI reports a 404 as a real service/route failure and does not invent counts.

PASS: Backend isolated Coursework suite: 30/30. Combined Coursework, account-link, ORM-contract and readiness suites: 56 total, 55 passed, 1 skipped. Focused frontend Coursework and tenant-workspace suites: 19/19. Python AST (3 files), JSX parser, and `git diff --check` passed.

BLOCKED: Safe temporary Vite build with `envFile: false` again failed before transforms with Windows `spawn EPERM` in `commonjs--resolver` / `optimizeSafeRealPathSync` (Node v24.11.1). The output target was under `%TEMP%`; `frontend/dist` was not modified.

NOT TESTED: PostgreSQL migration or persistence, live route response, authenticated browser flow, and identity verification for any real Teacher account. All tenant foundation/coursework drafts and grade publication migration 10 remain DRAFT / NOT APPLIED. Production readiness is NOT CLAIMED.
## Latest full-suite validation - 2026-11-15

BLOCKED: Full backend discovery, run with dotenv disabled and synthetic in-memory SQLite, executed 259 tests and reported 26 import errors, 2 skipped, and 0 assertion failures. The import-time errors are due to the unavailable `httpx2` package required by Starlette TestClient; no dependencies were installed. This does not indicate PostgreSQL integration.

BLOCKED: All 38 frontend `*.test.mjs` files ran serially: 206 tests, 181 passed, 25 failed, 0 skipped. Twenty-four failures are `spawn EPERM` in `face-camera-component`, `landing-page`, `public-pages`, `super-admin-colleges`, and `super-admin-review`; the other failure is the existing `frontend/dist` artifact audit reporting `production-loopback-fallback`. `frontend/dist` was not modified.

PASS: Focused Coursework, account-link, ORM, and readiness suites: 56 tests, 55 passed, 1 skipped. Focused frontend Coursework/tenant workspace suites: 19/19 passed. Temporary Vite build remains BLOCKED by `spawn EPERM`. PostgreSQL persistence, migration execution, authenticated browser workflow, and actual account-link state remain NOT TESTED. Migration status is DRAFT / NOT APPLIED; production readiness is NOT CLAIMED.

These full-suite totals are the latest run and supersede earlier full-suite totals in this report set.
## 2026-11-16 application-level removal

Assignments/Coursework routes and APIs have been removed from the active application as documented in `ASSIGNMENTS_REMOVAL_AND_FINAL_VERIFICATION.md`. The database and migration drafts remain untouched. Existing academic Teacher-Class-Subject mappings, Student enrollment mappings, and recipient-scoped notification APIs are separate features and remain.
