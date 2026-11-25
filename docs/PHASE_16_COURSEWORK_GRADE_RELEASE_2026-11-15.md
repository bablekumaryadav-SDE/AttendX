# Phase 16 Coursework Grade Release Correction

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