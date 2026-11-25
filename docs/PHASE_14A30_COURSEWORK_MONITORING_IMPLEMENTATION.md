# Phase 14A.30 — Coursework Monitoring Implementation

**Date:** 2026-11-14

**Status:** PARTIALLY COMPLETE — SOURCE IMPLEMENTED, LIVE API BLOCKED

**Database:** NOT VERIFIED IN THIS PHASE

**Migrations:** DRAFT / NOT APPROVED / NOT APPLIED

## Summary

The College Admin monitoring source now reports the Coursework route's unavailable state explicitly, validates filter IDs against the authenticated College, computes list-row statistics with set-based aggregate joins instead of per-row queries, and aligns pending counts with Student assignment states. Synthetic tests cover tenant denial, metrics, filtering, and query-count behavior.

The dashboard is not operational against a database. `backend/app/main.py` does not import or mount the prepared Coursework, account-link, or tenant-notification routers. That registration remains intentionally blocked until schema and PostgreSQL behavior are reviewed and approved. No database connection or migration was made in this phase.

## Initial state and preservation

- Repository: `C:\Users\Asus\OneDrive\Desktop\MainProject\AttendX`
- Branch: `main`
- Before work: 66 tracked modified entries and 324 untracked entries; the working tree was already heavily modified. Git emitted access-denied warnings while enumerating existing temporary/cache paths.
- No existing files were reset, cleaned, staged, or discarded. The pre-existing `main.py` modification and all untracked work were preserved.
- Focused pre-edit checks passed: 36 backend tests and 13 coursework frontend tests. Code inspection then found the N+1 row-query and pending-state issues described below.

## Root cause of the monitoring error

The prepared router in `backend/app/api/tenant_coursework.py` declares the `/tenant/coursework` routes, but `backend/app/main.py` neither imports nor calls `include_router` for it. The frontend list request therefore has no registered handler and receives a route-not-found response when run against this source. This is a source-based diagnosis; no live HTTP request was made in this phase.

The router remains unmounted because its account-link, assignment, submission, revision, audit, and notification schema dependencies are still draft and PostgreSQL rehearsal is not complete. The UI preserves the useful error and Retry action and now labels this specific 404 as “Coursework monitoring is not enabled yet.” It does not turn failures into zero statistics.

## Dashboard behavior and metric definitions

All card summaries use the same College-scoped filters as the assignment result set and cover the full filtered result, independent of the current page. A successful query may return zero; an unavailable or malformed response leaves metrics unavailable (`—`).

| Card | Prepared definition |
|---|---|
| Total assignments | All College-owned coursework assignment rows matching the selected filters. |
| Published | Matching rows with `status = published`. |
| Draft | Matching rows with `status = draft`. |
| Archived | Matching rows with `status = archived`. |
| Submissions | Logical submission-header rows for matching assignments; revisions are not counted as separate submissions. The draft unique key is required for the one-header-per-student rule. |
| Pending submissions | Active, College-owned enrollments paired with published assignments whose inclusive open interval contains the current UTC time (`issued_at <= now <= due_at`), excluding a logical submission. Drafts, future assignments, and overdue assignments do not inflate Pending. |
| Late submissions | Logical submissions whose latest revision is marked late. Earlier revisions are not counted separately. |

Per-row `submission_count`, `enrolled_count`, and latest-revision `late_submission_count` are joined from pre-aggregated College-scoped subqueries into the paginated list query. They no longer issue multiple additional queries for each assignment row. The pending calculation uses the same issue/deadline window as Student-facing Available/Pending/Late states.

The pending and latest-revision semantics are source-tested on synthetic SQLite only. Their PostgreSQL trigger, uniqueness, and historical enrollment behavior remain unverified.

## Filters, refresh, and error handling

- Teacher, Class, Subject, Status, Due from, and Due to are sent to the backend; filtering is not performed only in the browser.
- Teacher/Class/Subject IDs are checked against College-owned rows before list filtering. Unknown or foreign filter IDs return the same sanitized 404 detail; they do not reveal another College's records.
- Status accepts only `draft`, `published`, or `archived` at the API query boundary.
- Due bounds are inclusive (`due_at >= due_from`, `due_at <= due_to`); a reversed range returns 422. Naive input datetimes are normalized as UTC in the prepared backend helper. The frontend converts the local `datetime-local` value to ISO UTC for requests and displays stored UTC values in local time.
- Apply filters updates the server query and resets pagination. Clear filters clears every value and fetches the unfiltered College-scoped result. Refresh preserves applied filters. Retry repeats the failed list request.
- Request sequence guards discard stale list and detail responses after refresh, selection changes, or College switching. Detail/submission failures remain separate from a successful list result.
- The frontend maps 401, 403, 404, 409, 422, 503, network, and unexpected errors to safe messages. A foreign filter 404 is distinguished from the unregistered-route 404.
- The table displays actual API fields and paginated results. The details panel is monitoring-only; no write actions or fake records are offered.

## Prepared route inventory — NOT REGISTERED

`backend/app/api/tenant_coursework.py` contains prepared routes under `/tenant/coursework`:

| Method | Path | Intended scope |
|---|---|---|
| GET | `/teacher/mappings` | Active linked Teacher and authorized active mappings. |
| POST / GET | `/teacher/assignments` | Teacher-owned College-scoped drafts/list. |
| PATCH | `/teacher/assignments/{assignment_id}` | Edit an owned draft. |
| POST | `/teacher/assignments/{assignment_id}/publish` | Publish an owned eligible draft. |
| POST | `/teacher/assignments/{assignment_id}/deadline-extension` | Audited deadline extension. |
| POST | `/teacher/assignments/{assignment_id}/archive` | Archive an owned published assignment. |
| GET | `/teacher/assignments/{assignment_id}/submissions` | Enrolled student monitoring rows for an authorized Teacher. |
| GET | `/teacher/assignments/{assignment_id}/submissions/{student_id}` | Submission history for the authorized Teacher's assignment. |
| GET | `/student/assignments` | Published/archived work for an explicitly linked Student with active enrollment. |
| POST | `/student/assignments/{assignment_id}/submissions` | Text submission with server-owned timestamp/late state and idempotency handling. |
| GET | `/student/assignments/{assignment_id}/submissions` | Authenticated Student's own submission/revision history. |
| GET | `/admin/assignments` | College Admin read-only list, filters, facets, pagination, and summary. |
| GET | `/admin/assignments/{assignment_id}` | College Admin read-only assignment detail. |
| GET | `/admin/assignments/{assignment_id}/submissions` | College Admin read-only submission roster. |
| GET | `/admin/assignments/{assignment_id}/submissions/{student_id}` | College Admin read-only submission history. |

The separate prepared account-link router contains create/revoke routes for Student and Teacher links. The tenant-notification router contains inbox, unread-count, mark-read, and mark-all-read routes. These routers are also unmounted. Legacy `/assignments` mapping and legacy notification routes remain behind the default-deny gate; this phase did not change that gate.

## Schema and migration status

No live schema inspection was performed in this phase. Earlier dated repository reports describe a prior preflight and identify Coursework tables as missing, but those reports do not substitute for current target verification. The current isolated PostgreSQL cluster was not available for migration rehearsal.

Required draft dependencies include:

- Explicit `student_account_links` and `teacher_account_links` with College-scoped keys; identity links must be verified by an approved administrative process, never inferred by email/name/phone/roll number.
- `coursework_assignments` tied to same-College TeacherAssignment and creator membership.
- `coursework_submissions` with one logical row per assignment/Student/College.
- Append-only `coursework_submission_revisions` with idempotency uniqueness and server-derived submitted/late fields.
- `coursework_assignment_audit_events` and lifecycle guards.
- Notification College-scope schema reconciliation before tenant notification routes use `NotificationEvent`.
- Required composite keys, FK-side indexes, trigger/function semantics, privileges, and a single reviewed migration-history/recovery process.

The migration drafts are:

1. `database/migrations/DRAFT_20261114_01_student_account_links.sql`
2. `database/migrations/DRAFT_20261114_02_coursework_assignments.sql`
3. `database/migrations/DRAFT_20261114_03_coursework_submissions.sql`
4. `database/migrations/DRAFT_20261114_04_coursework_submission_revisions.sql`
5. `database/migrations/DRAFT_20261114_05_coursework_assignment_audit_events.sql`
6. `database/migrations/DRAFT_20261114_06_notification_events_college_scope.sql`
7. `database/migrations/DRAFT_20261114_07_teacher_account_links.sql`

All remain **DRAFT / NOT APPROVED / NOT APPLIED**. The earlier static reconciliation describes `01 → 02 → 03 → 04`, with `02 → 05`; Teacher links and notification scope also require a separately reviewed ordering before those APIs can be used. No PostgreSQL parser or execution test was run. Static SQL and SQLite tests do not establish PostgreSQL compatibility.

## Tenant security

- Backend requests resolve an authenticated active membership and the selected College through tenant context; a caller-supplied College ID is not the authority.
- Assignment, mapping, Teacher, Class, Subject, Student, enrollment, submission, revision, and event reads use College-scoped predicates in the prepared source.
- The new filter validation rejects IDs not owned by the authorized College with a non-disclosing 404.
- Student access depends on an explicit Student account link and active enrollment. Teacher access depends on an explicit Teacher account link and active mapping. No link or legacy ownership is inferred.
- No default College, ownership backfill, automatic membership, account link, or role promotion was added.
- Synthetic tests are not an independent security assessment or PostgreSQL proof.

## Files changed in Phase 14A.30

- `backend/app/api/tenant_coursework.py` — set-based row aggregates, published/open-window pending semantics, and explicit College validation for supplied filter IDs.
- `backend/tests/test_tenant_coursework_isolated.py` — query-count, published/draft/future/overdue pending, and foreign-filter regression coverage.
- `frontend/src/pages/CourseworkMigrationRequired.jsx` — distinguishes an unregistered Coursework route from a filter-ID 404 while retaining safe errors and Retry.
- `frontend/src/services/coursework.js` — safe distinction for a College-scoped invalid filter response.
- `frontend/tests/coursework-migration-required.test.mjs` — route-unavailable/error-state regression assertions.
- `frontend/tests/coursework-service-contract.test.mjs` — filter-error mapping assertion.
- `docs/PHASE_14A30_COURSEWORK_MONITORING_IMPLEMENTATION.md` — this report.

Before editing, timestamped copies were written outside the repository under `%TEMP%` in these directories:

- `attendx_coursework_admin_route_state_20261114_232423`
- `attendx_coursework_n_plus_one_backup_20261114_233746`
- `attendx_coursework_metrics_backup_20261114_234009`
- `attendx_coursework_filter_validation_backup_20261114_234153`
- `attendx_coursework_pending_window_backup_20261114_234614`

## Tests and validation

### Backend focused synthetic suite

Command, from `backend`:

```powershell
$env:ATTENDX_SKIP_DOTENV='1'
$env:ATTENDX_TEST_SQLALCHEMY_URL='sqlite://'
.\.venv\Scripts\python.exe -m unittest tests.test_tenant_coursework_isolated tests.test_tenant_account_links_isolated tests.test_coursework_orm_contract_static tests.test_notification_events_college_scope_migration_static
```

Result: **39 tests passed, 0 failed**. This is synthetic SQLite/static validation, not PostgreSQL compatibility evidence.

### Full backend discovery

Command used the same dotenv opt-out and synthetic SQLite URL:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test*.py'
```

Result: **232 tests discovered/run; 30 import errors; 2 skipped**. Import errors are due to the installed test environment requiring unavailable `httpx2`/`httpx`. No package was installed. This full run preceded the final focused query/metric fixes; the current focused suite was rerun afterward and passed.

### Frontend

Focused Coursework files were executed individually:

```powershell
node tests/coursework-migration-required.test.mjs
node tests/coursework-service-contract.test.mjs
node tests/coursework-workspaces.test.mjs
```

Result after final source changes: **13 tests passed, 0 failed**. JSX parsing passed with the installed Babel parser.

The full 38-file frontend suite was run serially one file at a time after the source updates: **203 tests; 178 passed; 25 failed**. Twenty-four failures were `spawn EPERM` in `face-camera-component`, `landing-page`, `public-pages`, `super-admin-colleges`, and `super-admin-review`; the other failure is the existing `api-base-url` build-artifact audit (`production-loopback-fallback` in the existing artifact). The coursework files passed. A single Node `--test` invocation also failed because its worker process creation returned `spawn EPERM`.

### Build and static checks

- Safe Vite validation build used a temporary empty environment directory, `https://attendx-validation.invalid`, and an output path outside the repository. It failed with `spawn EPERM` in Vite's Windows `optimizeSafeRealPathSync` before producing build output. `frontend/dist` was untouched; no deployable build was produced.
- `git diff --check`: **PASS** (existing LF-to-CRLF warnings were reported).
- Scoped trailing-whitespace scan for changed source/test files: **PASS**.
- Python AST parse of changed Python files: **PASS**.
- Browser rendering: **NOT TESTED**.
- PostgreSQL migration, API persistence, concurrency, and end-to-end workflow: **NOT TESTED**.

## Remaining blockers and readiness

1. The isolated PostgreSQL 18 cluster at `%LOCALAPPDATA%\AttendX-PG18-TestCluster` was found stopped during read-only metadata inspection: PID 21768 was absent, no PostgreSQL process/listener on 55432 was found, the PID file was stale, and `pg_ctl status` reported no server. Saved startup options show the previous `-p 55432` override; the stopped cluster config default is 5432. SCRAM host authentication is configured. The prior password failure does not establish whether the role exists or the password is wrong.
2. No offline password reset was performed. Explicit approval for a controlled reset on this disposable cluster only is still required before any credential-changing recovery. The existing AttendX database/port 5432 was not accessed.
3. The seven migration drafts and notification schema reconciliation require independent review and explicit approval. They remain unapplied.
4. After recovery, verify cluster/data directory/port/database identity and use a separate test-only role. Rehearse each reviewed migration, constraints, triggers, privileges, rollback/recovery, and PostgreSQL integration tests on that isolated database only.
5. Only after those checks pass should Coursework/account-link/notification routers be considered for registration. Then exercise Teacher create/publish, Student view/submit/history, Admin filters/details, and cross-College denials through actual APIs and browser.
6. The frontend full-suite environment failures and production artifact audit remain unresolved; the safe Vite build has not succeeded.

**Final readiness:** Coursework schema **NOT VERIFIED**; Coursework APIs **NOT AVAILABLE** (prepared in source, not mounted); Admin dashboard **SAFE UNAVAILABLE**; migrations **NOT APPLIED**; migration approval **NOT GRANTED**; production readiness **NOT CLAIMED**.

## Safety confirmation

No `.env`, credentials, JWTs, password stores, or `backend/create_admin.py` were accessed. No database connection, SQL, DDL/DML, migration, service or configuration change, dependency installation, `frontend/dist` overwrite, destructive Git operation, commit, or push occurred. Existing user work remains in the worktree.
