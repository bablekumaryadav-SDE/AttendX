# AttendX mandatory acceptance checklist ? 2026-11-11

A criterion is PASS only when its full listed requirement has evidence. Lower-level unit tests are noted but do not substitute for missing browser/PostgreSQL end-to-end evidence. Count: 1 PASS / 28 criteria = **3.57% verified completion** under the requested formula. This is acceptance evidence coverage, not estimated code completion.

| # | Mandatory criterion | Status | Evidence / gap |
|---:|---|---|---|
| 1 | All four roles authenticate correctly | BLOCKED | HTTP suites require missing `httpx2`; PostgreSQL/browser login workflow not run. |
| 2 | All role permissions work | NOT TESTED | Partial tenant negative-path unit coverage exists; complete four-role endpoint verification unavailable. |
| 3 | College isolation works | NOT TESTED | Synthetic tenant suites cover representative cross-College denials; full API/PostgreSQL verification absent. |
| 4 | All College Admin modules work | NOT TESTED | No complete browser workflow; reports/notifications and persistence remain unverified. |
| 5 | Student registration works | BLOCKED | Synthetic service tests exist; PostgreSQL persistence and login workflow not run. |
| 6 | Teacher registration works | BLOCKED | Synthetic service tests exist; PostgreSQL persistence and login workflow not run. |
| 7 | Automatic Student ID works | NOT TESTED | Not established in a full registration persistence workflow. |
| 8 | Automatic Teacher ID works | NOT TESTED | Not established in a full registration persistence workflow. |
| 9 | Class management works | NOT TESTED | Synthetic tests exist; browser and PostgreSQL workflow not completed. |
| 10 | Subject management works | NOT TESTED | Synthetic tests exist; browser and PostgreSQL workflow not completed. |
| 11 | Assignments work | NOT TESTED | Synthetic tenant assignment tests pass; complete UI and PostgreSQL workflow absent. |
| 12 | Teacher lecture start/end works | NOT TESTED | Synthetic session tests pass; complete browser/PostgreSQL lecture workflow absent. |
| 13 | Secure QR generation works | PASS | `tests.test_tenant_attendance_sessions_isolated.TenantAttendanceSessionTests.test_qr_rotation_and_session_close_finalize_only_owned_roster` passed in the 58-test synthetic SQLite batch. This is not PostgreSQL verification. |
| 14 | Student Dashboard displays both camera options | NOT TESTED | Source-level checks exist; no browser rendering was performed. |
| 15 | QR attendance works end to end | NOT TESTED | Direct synthetic handler flow exists, but actual browser scan and PostgreSQL persistence were not performed. |
| 16 | Actual face registration works | NOT TESTED | Synthetic blank-image/model checks only; no real student capture or persistence. |
| 17 | Actual face matching works | NOT TESTED | Synthetic vector paths only; no real-user matching/accuracy validation. |
| 18 | Duplicate and concurrent attendance are prevented | NOT TESTED | Sequential duplicate handling is covered; concurrent PostgreSQL requests and retry-after-timeout are not. |
| 19 | Attendance is correctly persisted in PostgreSQL | BLOCKED | No PostgreSQL operation/verification in this continuation. |
| 20 | Student sees the correct attendance record | NOT TESTED | Synthetic history path tested; no PostgreSQL-backed dashboard check. |
| 21 | Teacher sees the same record | NOT TESTED | Synthetic event aggregation tested; same persistent record not verified through UI. |
| 22 | College Admin sees the same record | NOT TESTED | Tenant event list tests exist; no shared PostgreSQL workflow across dashboards. |
| 23 | Overview metrics are correct | NOT TESTED | Tenant summaries have isolated tests; live persisted-count comparison not performed. |
| 24 | Reports and notifications work | NOT TESTED | No complete tenant Reports/Notifications workflow verified. |
| 25 | Security and tenant-isolation tests pass | NOT TESTED | 58 isolated tests passed, but unavailable HTTP suites and complete route coverage prevent a full PASS. |
| 26 | Regression tests pass | BLOCKED | Frontend serial suite has 24 environment `spawn EPERM` failures; no assertion failures. |
| 27 | Required production build succeeds | BLOCKED | Validation-only build stops at `vite:build-html` with `spawn EPERM`; no deployable build. |
| 28 | Mandatory end-to-end workflow passes | BLOCKED | Full workflow requires browser, PostgreSQL and actual camera/face verification, none performed. |

## Environment blockers

- Backend HTTP tests: Starlette TestClient requires `httpx2` (or legacy `httpx`), neither is installed. `backend/requirements-test.txt` now declares `httpx2`; it was not installed.
- Frontend UI tests and Vite build: Vite's esbuild transform service requires child-process creation; Windows returns `spawn EPERM`. Test-only interception of the optional `net use` probe does not solve this required subprocess.
- Tenant migrations: six reviewed additive migrations were applied earlier under prior authorization as recorded in `COLLEGE_ADMIN_WORKSPACE_REPAIR_20261111.md`; no database operation occurred in this continuation.
- Credential rotation A?E remains BLOCKED / NOT APPROVED. Production API URL remains UNKNOWN. Production readiness is NOT CLAIMED.


## Dated addendum - activation and teacher assignment sync (2026-11-12)

The overall acceptance status above remains unchanged; these focused results do not establish the complete product workflow.

| Scope item | Status | Evidence / gap |
|---|---|---|
| Student activate/deactivate route | PARTIAL PASS | Synthetic SQLite ASGI test covers HTTP `DELETE /students/{id}` and `PATCH /students/{id}/activate`, linked account/membership state, login blocked/allowed, and returned Student status. Live PostgreSQL/browser persistence not tested. |
| Teacher assignment appears on Teacher workspace query | PARTIAL PASS | Synthetic SQLite handler-level regression creates through Admin assignment handler then reads through authenticated Teacher assignment query; active item appears immediately and inactive item is excluded. No live PostgreSQL/browser UI evidence. |
| Class-first Teacher attendance selection | PASS (source/test) | UI now derives Classes from active assignment rows, filters Subjects by selected Class, clears Subject on Class switch, and disables invalid session submit. Backend rejects unassigned pairs. |
| Dashboard freshness across focus/return | PASS (source/test) | Dashboard keeps visible 15-second polling and reloads on focus/visibility return, with College isolation and stale-response guard. |

Validation: backend focused teacher suites **11 passed** and Student lifecycle rerun **25 passed** (synthetic SQLite); focused frontend teacher tests **7 passed**, Student test **6 passed**; Python AST **3 files PASS**; JSX parse **2 files PASS**; `git diff --check` and scoped whitespace **PASS**. Build/browser/PostgreSQL remain **NOT TESTED**. These results do not change production-readiness status.


## 2026-11-12 - Attendance workflow checkpoint (partial)

- [x] Fix unbound Class variable in Teacher Subject option rendering.
- [x] Keep Teacher Class/Subject options limited to active authenticated tenant assignments; retain selected College propagation and server authorization.
- [x] Make session location semantics consistent: configured Class geofence wins; when absent, validated optional session coordinates may be supplied; no coordinates remains allowed.
- [x] Add empty assignment guidance and regression checks for unbound JSX identifiers and tenant contracts.
- [x] Verify the focused tenant backend suite (62 synthetic SQLite tests) and focused frontend suite (27 serial tests).
- [ ] Complete the broader College Admin workspace redesign and verify all requested CRUD/filter/export behaviors.
- [ ] Add a supported timetable/lecture model and workflow if product requirements still require timetables; none was found in the inspected schema/routes.
- [ ] Obtain successful Vite build in an environment where Windows process spawning is permitted.
- [ ] Perform browser, PostgreSQL and real device QR/GPS validation under appropriate separate authorization.

Overall project completion remains PARTIAL; no production-readiness claim is made.
