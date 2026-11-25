# AttendX Master Requirement Audit

**Audit date:** 2026-11-05  
**Repository:** `AttendX` under `MainProject`  
**Branch:** `main` tracking `team/main`  
**Audit status:** Phase 1 complete by source and documentation inspection. Runtime, PostgreSQL, browser, and device claims are limited to the dated evidence cited below.

## Repository state and method

The workspace root is not a Git repository. `AttendX/` is the likely primary repository: it contains the current app source, docs, and a `.git` directory. The sibling `AttendX_backup_final/` is a separate copy. This audit uses `AttendX/`; no files in either backup copy were changed.

At audit start, `git status --short --branch` reported branch `main...team/main`, extensive modified backend/frontend/test files, many untracked reports, migrations, deployment files, and timestamped backups. All were preserved. Git also emitted a permission warning for `backend/.pytest_cache`. No `.env` contents were read into this report. Existing backups were not overwritten and no new backup was needed because this phase made no application-source or schema change.

Inspected current README, all named existing reports that are present, app models, API registration, auth dependencies, auth/config/database/security code, route and frontend inventories, package/dependency manifests, migrations, tests, and deployment scaffold. Presence in source is recorded as implementation, not as proof of runtime correctness. Test results are only those explicitly documented with commands and outcomes in `docs/TEST_RESULTS.md`, `docs/ATTENDANCE_FLOW_TEST_REPORT.md`, `docs/FACE_REGISTRATION_TEST_REPORT.md`, and `docs/FINAL_ACCEPTANCE_REPORT.md`.

## Existing stack and repository structure

- **Backend:** FastAPI, SQLAlchemy, PostgreSQL driver via `psycopg2-binary`, Python JWT/password support, OpenCV contrib headless and NumPy. API code is in `backend/app`; no Alembic setup was identified.
- **Frontend:** React 19, Vite 7, React Router 7, Axios; source in `frontend/src`. Browser app has landing/login and Admin, Teacher, Student workspaces.
- **Authentication:** bearer JWT and bcrypt. Current role is reloaded from the database for requests. Stored frontend bearer token is in `localStorage`; there is no refresh-token/session-revocation flow identified.
- **Data:** SQLAlchemy models cover students, teachers, users, classes, subjects, teacher assignments, student class assignments, legacy attendance, attendance records, and face embeddings. Session attendance, audit logs, and some other tables are partly managed through raw SQL migrations rather than ORM models.
- **Face:** local YuNet/SFace ONNX model files, server-side embedding extraction and matching, registration and student attendance routes. Raw reference image bytes and embedding JSON are stored in `face_embeddings`.
- **Attendance:** session QR and face routes, HMAC QR tokens, enrollment/assignment checks, geofence validation, duplicate protection represented in additive SQL migration, attendance audit, and absence notification enqueueing are present.
- **Deployment:** Docker Compose, backend/frontend Dockerfiles, and Nginx configuration exist under `deployment/`; runtime validation is not established.
- **Android:** no native Android project/build files found in the active repository inventory. The frontend is a web app; a native mobile stack would be a new architecture decision.

## Requirement-to-feature matrix

Statuses describe the brief's target requirement against the inspected active repository.

| Area | Status | Current evidence and gap |
|---|---|---|
| Preserve existing AttendX stack/site | PARTIALLY IMPLEMENTED | React/Vite and FastAPI app exists; current README is stale and still describes the prior face-attendance task. Existing website identity should be inspected before visual changes. |
| Central web/backend/database architecture | PARTIALLY IMPLEMENTED | One web client and API configured to one database URL; no verified staging/production topology. |
| PostgreSQL schema and migrations | NEEDS SECURITY IMPROVEMENT | PostgreSQL configured and SQL migrations exist, but no migration ledger/version runner was identified. Live schema/migration state unknown; migration application not verified. |
| Four roles: Super Admin, College Admin, Teacher, Student | PARTIALLY IMPLEMENTED | Shared login recognizes `super_admin` and `/platform` is frontend role-protected; existing roles remain `admin`, `teacher`, `student`. No College Admin role or complete Super Admin permission matrix/platform APIs. |
| Super Admin bootstrap | PARTIALLY IMPLEMENTED | A guarded local-development bootstrap script exists, writes user+audit event transactionally, refuses existing Super Admin/owner account, non-PostgreSQL and non-loopback hosts. Script has not been run; no account was created. PostgreSQL transaction remains unverified. |
| College registration, review, approval | MISSING | No college/application/subscription models or onboarding routes found. |
| College Admin invitation/account activation | MISSING | No invitation or single-use token models/routes found. |
| Multi-college tenant ownership and isolation | MISSING | No `college_id` or equivalent in inspected core models. Existing admin access is platform-wide within a single data set; tenant isolation cannot be claimed. |
| Existing-data tenant backfill | BLOCKED | Ownership of existing records cannot be inferred safely from current schema. Requires explicit mapping to the first institution and isolated PostgreSQL validation before any migration. |
| Role-based API authorization | PARTIALLY IMPLEMENTED | Current DB-backed role checks and protected routes exist for three roles. No Super Admin/College Admin matrix; route-by-route scope and object ownership need review before SaaS use. |
| Admin/Teacher/Student dashboards | PARTIALLY IMPLEMENTED | Three web workspaces and related API routes exist. No Super Admin or College Admin distinction; dashboards are not evidence of complete target workflows. |
| Teacher/student/guardian administration | PARTIALLY IMPLEMENTED | Student/teacher CRUD and a guardian contact API exist. Guardian schema is currently described as one contact per student, not multiple verified relationship records. |
| Academic structure and timetable | PARTIALLY IMPLEMENTED | Classes, subjects, assignments, and student class assignment exist. Departments/courses/branches/academic sessions/sections/classrooms/timetables/holidays and collision prevention are not evidenced as a complete workflow. |
| QR attendance | PARTIALLY IMPLEMENTED | Signed, expiring, session-linked QR and duplicate handling exist in source; isolated QR/session flow tests are recorded as passing. Cross-tenant binding is absent because tenants are absent. |
| GPS/GIS | PARTIALLY IMPLEMENTED | Class coordinates/radius and backend Haversine/accuracy checks plus GIS UI are present. Device spoofing resistance is limited; real-device boundary/GPS tests are not established. |
| Face verification | PARTIALLY IMPLEMENTED | Actual YuNet/SFace pipeline and registration/verification source exist. Positive genuine-face round trip, calibration, retention, encryption-at-rest and liveness are not established. Face remains an optional existing attendance path, but policy configuration is not comprehensive. |
| Attendance attempts/finalization/corrections | PARTIALLY IMPLEMENTED | Session acceptance, duplicate protection, session close and absence finalization/notifications exist in code. Separate attempt lifecycle, configurable grace/late policy, auditable correction workflow and full idempotent job processing are not established. |
| Guardian/parent notifications | PARTIALLY IMPLEMENTED | In-app notification events and absence enqueueing are present. No Parent Dashboard/login is found (consistent with target); verified multi-guardian delivery, provider queue/retry and external delivery confirmation are not complete. |
| Reports and analytics | PARTIALLY IMPLEMENTED | Analytics/report APIs and screens exist; tenant-scoped reporting/export cannot be satisfied before tenant isolation. |
| Security/privacy | NEEDS SECURITY IMPROVEMENT | bcrypt, DB-backed role refresh, JWT validation and explicit CORS checks are present. Current local JWT configuration is documented as too short and startup fails closed. No rate limiting, refresh/revocation, full audit trail, biometric retention controls or independent security test evidenced. |
| Password recovery/MFA | MISSING | No secure reset-token flow or MFA implementation found. |
| Website public pages | PARTIALLY IMPLEMENTED | Landing and login exist. College registration, terms, privacy and full public content are not established. Founder claim must only be added as supplied by owner, without invented history. |
| Native Android app | MISSING | No native project found. Any new native stack requires architecture approval under the brief. |
| Subscriptions/plans/usage | MISSING | No subscription entities/workflows. No prices or payment success claims should be invented. |
| Backup/restore | BLOCKED | Instructions exist, but no verified backup/restore drill or backup monitoring evidence. |
| Deployment readiness | NEEDS SECURITY IMPROVEMENT | Compose/Nginx scaffold and instructions exist; Docker, TLS, production database, monitoring, and deployment were not validated. |
| Automated tests | PARTIALLY IMPLEMENTED | On 2026-11-05, isolated backend `unittest` discovery passed 55 tests and serial frontend Node suite passed 28 tests, including Super Admin backend auth-boundary and frontend route-decision checks. PostgreSQL and browser/device flows remain untested. |
| Browser and Android/device tests | NOT TESTED | Prior reports document no current physical Android test; genuine camera/GPS outcomes and full browser flows remain unverified. |

## Security and data-integrity findings

1. **Tenant isolation is absent.** Adding only frontend filters or a `college_id` field without query, ownership, background job, notification, and migration controls would leave cross-college exposure risks.
2. **Legacy identity is ambiguous.** Existing user, student, teacher, class, subject and attendance tables do not record institution ownership. Do not infer or silently backfill a tenant.
3. **Role bootstrap is constrained but not verified against PostgreSQL.** Existing `admin` is not equivalent to `SUPER_ADMIN`; script did not run and no account was created. No platform API permissions or College Admin role exist yet.
4. **JWT/session limitations.** The previous security report states the configured local secret is shorter than the source-enforced 32-byte minimum, so the backend will not start until operators configure a strong key. There is no refresh token or revocation model. Never print or copy `.env` values.
5. **Biometrics.** Raw reference images and embeddings are persisted. Access is omitted from ordinary response schemas, but encryption, retention/deletion, consent, threshold calibration and liveness evidence remain gaps. Liveness must not be claimed.
6. **Attendance migration safety.** Duplicate prevention depends in part on a PostgreSQL migration whose application state is unknown. No production migration or database write was made.
7. **Browser token exposure.** The frontend stores bearer tokens in `localStorage`; XSS hardening and CSP are incomplete per existing deployment/security report.
8. **Availability and abuse controls.** Login/recovery rate limiting and brute-force controls are not evidenced. External notification delivery is not configured/verified.

## Database impact and migration constraints

No schema change was made during this audit. Before tenant work, inventory the actual database schema read-only, identify one explicit first-college ownership mapping for every legacy row, identify orphaned/ambiguous rows, and test a reversible additive migration on a separate PostgreSQL test database. Use a migration ledger/runner or documented versioned process before relying on ordered SQL files. Do not apply production DDL without explicit approval. Existing attendance and biometric records must remain intact; no arbitrary tenant assignment is acceptable.

## Dependencies and environment

- Python runtime dependencies are listed in `backend/requirements.txt`; no project-pinned test dependency set was found there.
- Frontend dependencies and scripts are in `frontend/package.json` with `package-lock.json` present.
- `.env` files exist locally but are excluded from this report and must remain private.
- Earlier report: C: was reported full on 2026-11-04; later phase report recorded free space above the 1.5 GB threshold. Check the current drive before any dependency/build operation. Prefer D: for temporary output where available.
- Previous tests used isolated SQLite fixtures. They did not validate PostgreSQL schema migration, a live database, deployment, browser camera, or physical Android.

## Prioritized implementation order

1. Preserve this baseline and establish a clean, repeatable, isolated test/runtime environment; reconcile current uncommitted source changes before edits.
2. Approve and define role/tenant ownership semantics and explicit first-college mapping; document target architecture and migration/recovery plan before schema work.
3. Implement tenant-aware data model and migration only after an isolated PostgreSQL test plan and ownership mapping are complete; enforce scope at API/query and background-work boundaries.
4. Add auditable platform/college roles, secure bootstrap and invitation/onboarding flows on the common auth system.
5. Complete academic structure, account management, attendance policy/finalization/corrections and guardian relationship/notification workflows using the tenant model.
6. Harden authentication, privacy/biometric handling, rate limiting, audit trails, retention and operational backups.
7. Preserve and complete the current website flows; make the Android architecture decision separately before adding a native project.
8. Validate with isolated PostgreSQL migrations/integration, full automated regression, browser/device, provider and staging deployment tests. Production remains blocked until those checks and approvals are complete.

## Evidence documents and current verification boundaries

- `docs/PROJECT_AUDIT.md` — prior code/environment audit.
- `docs/TEST_RESULTS.md` — dated automated suite/build results and environment caveats.
- `docs/ATTENDANCE_FLOW_TEST_REPORT.md` — isolated SQLite QR sequence; PostgreSQL not connected.
- `docs/FACE_REGISTRATION_TEST_REPORT.md` — genuine positive face registration and match not verified; liveness absent.
- `docs/GIS_IMPLEMENTATION_REPORT.md` — GIS source and tests; consult `GIS_RECOVERY_REPORT.md` for later work.
- `docs/SECURITY_AUDIT_REPORT.md` — current known JWT/CORS/privacy issues.
- `docs/POSTGRESQL_MIGRATION_PLAN.md` — migration ordering and separate PostgreSQL setup constraints.
- `docs/DEPLOYMENT_GUIDE.md` — deployment scaffold; Docker/TLS/live hosting not tested.
- `docs/FINAL_ACCEPTANCE_REPORT.md` — prior phase checklist; its ratio is not commercial readiness.
- `docs/BROWSER_E2E_TEST_REPORT.md` and `docs/PHASE_7_COMPLETION_REPORT.md` — historical test scope only; not assumed current.

## Audit conclusion

Phase 1 is complete as a repository/source/documentation audit and requirement matrix. Phase 2 adds a guarded but unexecuted bootstrap path and login landing; it does not add platform operations. AttendX has substantial single-college attendance functionality, but the requested multi-college SaaS, College Admin, college onboarding/invitations, native Android, subscription management, complete policy/finalization, and production validation are not present or not proven. The project is **NOT PRODUCTION READY**. No configured PostgreSQL database, schema, or deployment target was modified.

## Phase 3 design status (2026-11-05)

Tenant foundation is documented in `TENANT_ENTITY_OWNERSHIP_MATRIX.md`, `TENANT_AUTHORIZATION_DESIGN.md` and `LEGACY_DATA_RECONCILIATION_PLAN.md`. These are **DESIGN ONLY**: no tenant model/context, tenant query scope or migration is implemented. `admin` remains the legacy single-college role and is distinct from `super_admin`; no silent rename or automatic permission inheritance was introduced. Legacy ownership remains **UNKNOWN / BLOCKED** pending evidence. Current regression rerun: 55 backend and 28 frontend tests pass in isolated/local test contexts; these do not establish cross-tenant isolation. See `PHASE_3_TENANT_FOUNDATION.md` and the newest `TEST_RESULTS.md` section.

## Phase 14A.25 current alignment addendum (2026-11-10)

This addendum updates the requirement matrix status using later tenant source reviews without rewriting the historical Phase 1 baseline. The 24 V6 areas and current evidence are summarized in `PHASE_14A25_TENANT_SCHEMA_RISK_RESOLUTION.md`.

Current material deltas from the 2026-11-05 baseline: tenant context/membership and a default-deny gate now exist; read-only tenant APIs and a narrowly limited College profile PATCH exist; College/ownership migration drafts remain unapplied; existing legacy ownership remains UNKNOWN; no tenant-safe business creation route is enabled. This is partial implementation only. Existing dashboard and historical route claims are not equivalent to complete V6 workflows. Production API endpoint, actual deployed schema, production role setup, and current PostgreSQL compatibility remain UNKNOWN/NOT TESTED.

**Super Admin/bootstrap row correction for this continuation:** bootstrap is **BLOCKED / NOT TESTED** in this phase. `backend/create_admin.py` was expressly excluded from inspection and was not executed. No credential, password, token or current script content is verified here. Prior statements about it are retained only as dated historical audit content, not reaffirmed by Phase 14A.25.

The current statuses remain: migration **DRAFT / NOT APPLIED**; credential rotation A–E **BLOCKED / NOT APPROVED**; production readiness **NOT CLAIMED**.

## Phase 14A.28 current public website status (2026-11-10)

The active React/Vite app now includes public routes for About, Features, How It Works, Founder, Contact, Privacy draft and Terms draft, in addition to the existing landing and Login routes. Shared public chrome is used across the landing and secondary pages. This is incremental website implementation, not release acceptance. Contact, registration, pricing/payment and full tenant management remain unavailable/unconfigured. Privacy and Terms are owner/legal review drafts, not approved policies. Real browser and physical-device checks remain NOT TESTED; no production domain is configured or claimed.

The pages use source-supported implementation status labels. The tenant ownership migration remains **DRAFT / NOT APPLIED**, credential rotation A-E remains **BLOCKED / NOT APPROVED**, PostgreSQL validation remains **NOT TESTED**, and production readiness remains **NOT CLAIMED**. See `PHASE_14A28_PUBLIC_WEBSITE_SECONDARY_PAGES.md` for exact routes and verification evidence.
## Phase 14A.29 College registration and onboarding status (2026-11-10)

Current-source audit confirms College registration, application tracking/review, approval-driven provisioning, and College Admin invitation/activation are **NOT IMPLEMENTED**. `College` and `CollegeMembership` models exist, but neither is a registration application record. The tenant foundation migration remains **DRAFT / NOT APPLIED**. No application/review/activation schema or APIs were found in the registered FastAPI routers. `/platform` is a frontend-protected Super Admin sign-in landing page only; no server-side application-review endpoints are registered. The existing internal membership lifecycle service does not create Colleges or implement registration approval/invitation and is not a public API.

The public website correctly presents registration as unavailable. Existing auth/tenant code keeps global legacy `admin`, membership `college_admin`, and global `super_admin` separate; Super Admin receives no implicit College context, and tenant context requires active membership and active College. Four existing synthetic SQLite authorization suites passed (38 tests) but do not test registration or PostgreSQL compatibility. Persistent application/review/activation schema and product lifecycle decisions are the first approval boundary; no mock or local-only substitute was added. See `PHASE_14A29_COLLEGE_REGISTRATION_ONBOARDING.md`.

Current status remains: credential rotation A-E **BLOCKED / NOT APPROVED**; PostgreSQL validation **NOT TESTED**; production endpoint **UNKNOWN**; production readiness **NOT CLAIMED**.

## Phase 14A.29 registration continuation (2026-11-10)

Registration, applicant status, and Super Admin application review have been implemented in source, with focused SQLite/API and frontend tests. This changes the pre-implementation Phase 14A.29 inventory above for source-code status only. The new application/review migration is **DRAFT / NOT APPLIED**; no database was changed. Approval creates pending/inactive records only, with no invitation or activation, and cannot provide College workspace access. PostgreSQL transaction/locking behavior, rate limiting, request-body log suppression, retention/legal approval and provider setup remain unresolved. Teacher/student/business writes and tenant-safe attendance submission are not completed by this continuation. Validation passed 48 isolated backend tests and 104 serial frontend tests; a non-deployable no-output Vite transform passed. PostgreSQL and real browser remain NOT TESTED; endpoint remains UNKNOWN; production readiness is NOT CLAIMED. Credential rotation A�E remains BLOCKED / NOT APPROVED. See the Phase 14A.29 implementation continuation addendum.

## Phase 14A.30 implementation status (2026-11-10)

Super Admin application review is extended with search. New Super Admin College directory/detail/profile/suspend/reactivate APIs and pages are implemented in source. All platform endpoints enforce the DB-backed Super Admin role; ordinary global admin and College roles are denied. College suspension is checked by existing tenant context and blocks tenant operations. Approval continues to create only pending/inactive identities; no invitation or activation exists. Application/review/provisioning, profile and status-history schema remains **DRAFT / NOT APPLIED**, and tenant-safe writes for Teachers/Students/academic entities plus teacher attendance submission remain incomplete. Validation was 55 backend synthetic SQLite tests and 107 serial frontend tests. PostgreSQL, real browser and configured database are NOT TESTED. See `PHASE_14A30_COLLEGE_MANAGEMENT.md` for route inventory and A�H acceptance status.
