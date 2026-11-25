# Phase 14A.13A — Teachers Regression Audit and Feature Preservation

**Date:** 2026-11-10
**Final status:** PASS (confirmed useful read-only features restored; forbidden writes remain removed)

## Scope and evidence

Reviewed the complete working-tree diffs for `frontend/src/pages/auth/admin/Teachers.jsx` and `frontend/src/services/teachers.js`, the pre-change versions from `HEAD`, the current `Teachers.css`, `AdminDashboard.jsx`, `DashboardLayout.jsx`, `AppRoutes.jsx`, and all frontend imports/callers for the old service exports. The page remains mounted at `/admin/teachers`, linked from the Admin Dashboard and sidebar. The existing `Teachers.css` is still imported and its layout classes are reused. The route/navigation files were not changed for this audit.

Diff sizes after the audit's selective restoration: `Teachers.jsx` **142 additions / 1,997 deletions**; `teachers.js` **12 additions / 86 deletions**. Most remaining page deletions are the old write forms, account controls and assignment management; these are intentionally excluded from a read-only tenant API. The page diff was reviewed by its complete hunk content and the previous implementation's complete function/section inventory, not inferred from line counts alone.

## Before/after feature inventory

| Previous feature or behavior | Classification | Current result |
|---|---|---|
| Admin route `/admin/teachers`, Dashboard link and sidebar item | Replaced/equivalent; no regression | Route and navigation remain present. The Teacher page continues to load inside the existing dashboard layout. |
| Faculty stats: total, active, inactive and department count | Unintentionally removed in initial 14A.13; RESTORED | Same four summary metrics now derive solely from the selected College's tenant-filtered list. |
| Search by name, department, email, employee ID | Partially incompatible; RESTORED safely | Search works on name, department and the returned Teacher record ID. Email and employee ID search are omitted because those fields are intentionally not returned by the tenant API. |
| Active/inactive filter, department filter, clear filters, department option list | Unintentionally removed; RESTORED | Existing interactions are back and operate on the tenant list. |
| Directory table, avatar initials, status, department, responsive table scroll | Unintentionally removed; RESTORED | Existing table and CSS classes are reused. Email/employee ID, access-pill duplication, assignment column, and write action column are omitted. |
| Refresh button | Unintentionally removed; RESTORED | Refresh triggers a new GET with the current AuthContext College ID and is disabled during loading or without selection. |
| Loading, empty, filtered-empty, error and dismiss-error states | Partially replaced; RESTORED/IMPROVED | Existing visual classes are reused; messages reflect missing selection, tenant loading, or empty College-owned records. 401/403/404/409/503 messages remain distinct and sanitized. |
| Teacher detail view | Replaced/equivalent | A read-only profile dialog now fetches `GET /teachers/{id}` with the selected College and displays only name, department, active status, record number, and creation time. Email, employee ID, global User/account details, and assignments are not shown. |
| Escape-to-close and backdrop-to-close behavior | Unintentionally removed; RESTORED | Escape and backdrop close the read-only profile. Closing invalidates the detail request guard. |
| Add/edit Teacher forms, name/email/employee-ID validation, password creation and password-strength display | Intentionally removed | These submit Teacher/User writes and cannot be enabled in this phase. No write service methods or controls remain. |
| Activate/deactivate actions and confirmation | Intentionally removed | Changes Teacher/account access and are outside the read-only API. |
| Teacher assignment list/detail | Intentionally removed | `GET /teachers/{id}/assignments` is still behind the default-deny gate and has no reviewed tenant-scoped contract. No assignment query was enabled. |
| Assignment create/delete, duplicate checks, Subject/Class selectors, year/semester fields | Intentionally removed | Writes to the unreviewed assignment API are not permitted. Subject/Class selector data is no longer fetched by the Teachers page. |
| Copy employee ID to clipboard | Intentionally removed | Employee ID is omitted from the tenant response. |
| Sort and pagination | No regression found | The prior page had no sort or pagination state/control/handler; the replacement does not claim to restore either. |
| `getTeachers()` and `getTeacher(id)` | Replaced/equivalent | Both now require an explicit College ID and pass it through `selectedCollegeParams`; missing selection throws before HTTP dispatch. |
| `getSubjects()` and `getClasses()` in `teachers.js` | Replaced/equivalent | They now require an explicit College ID. Application pages use the canonical `academic.js` clients; the remaining Teacher-service references are tests only. |
| Teacher and assignment write exports | Intentionally removed | Removed `createTeacher`, `updateTeacher`, `activateTeacher`, `deactivateTeacher`, `createAssignment`, and `deleteAssignment`. |
| Teacher assignment read export | Intentionally removed | Removed `getTeacherAssignments`; its route is unscoped and gated. |

## Regression findings and remediation

The initial Phase 14A.13 rewrite replaced the whole 2,000-line administration page with a short directory, unintentionally removing useful read-only navigation, search/filter, summary, table, refresh, and profile affordances along with prohibited write features. Those read-only features have now been restored selectively. The new search excludes email and employee ID because the current tenant response deliberately withholds them. Existing CSS was preserved; the page reuses its hero, stats, directory, table, loading/empty, modal, profile, and responsive styles. No CSS file was changed.

No broken frontend references to removed Teacher write/assignment exports remain. A repository-wide frontend search found only `getTeachers(activeCollegeId)` and `getTeacher(id, activeCollegeId)` in application code. Other application pages use `academic.js` for Subjects/Classes. `AdminDashboard.jsx` passes `activeCollegeId` to its Teacher count request. No localStorage value is read by the Teachers page for authorization.

The route is unchanged and remains reachable through `/admin/teachers`. No browser was launched, so visual appearance and responsive rendering were not browser-verified. The existing stylesheet is reused and the production build validates JSX bundling, but this is not a substitute for interactive visual verification.

## Security boundary

This audit changed only the frontend page, its frontend test, and this report plus result summaries. It did not change tenant backend authorization or the default-deny gate. No Teacher write route, global User-role authorization, unscoped request, or assignment route was restored. The previous membership selector remains the source of the active College ID; list and detail service calls require it explicitly. Credential rotation A–E remains BLOCKED / NOT APPROVED.

## Tests and checks actually executed

- Focused test: from `frontend`, `node tests/tenant-teachers.test.mjs` — **4 passed, 0 failed, 0 skipped**. Covers mocked Axios list/detail selector and GET behavior, pre-dispatch rejection with no College, safe status messages, stale-response/selection clearing source contract, restored directory controls, and absence of write methods/controls.
- Full frontend serial suite: from `frontend`, sorted sequential `node` execution for every `tests/*.test.mjs` — **10 files, 51 passed, 0 failed, 0 skipped**.
- Production build: `npm run build` — first restricted attempt failed before transformation with environmental Windows `spawn EPERM`; retry under approved elevated execution passed (Vite 7.3.7, 1,935 modules). Non-fatal `use client` directive and >500 kB chunk warnings remain.
- Browser/UI run: NOT TESTED.
- PostgreSQL/database/credential operations: NOT RUN and not accessed.

No database, PostgreSQL process/service/cluster/port, credential, DPAPI, ACL, migration, or Git destructive operation occurred.
