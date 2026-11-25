# Phase 14A.29 - College Registration, Super Admin Approval and Onboarding Foundation

**Date:** 2026-11-10
**Phase status:** BLOCKED at the persistence/schema approval boundary
**Repository:** `C:/Users/Asus/OneDrive/Desktop/MainProject/AttendX`
**Branch:** `main`

## Scope and safety

This was a source, route, documentation and isolated-test audit of the real College-registration-to-onboarding workflow. Initial `git status --short` showed 49 modified rows and 117 untracked rows. All pre-existing changes, backups and untracked paths were preserved. The only intended edits for this phase are this report and dated additions to `MASTER_REQUIREMENT_AUDIT.md`, `TEST_RESULTS.md`, and `FINAL_ACCEPTANCE_REPORT.md`.

No database, PostgreSQL, SQL, migration, credential, DPAPI, `.env`, service, cluster, port, ACL, deployment, or provider operation occurred. `backend/create_admin.py` was not opened, run, copied, or modified. No bootstrap script was run. No dependency was installed. Synthetic SQLite tests below used disposable in-memory fixtures and are not PostgreSQL evidence.

## Architecture readiness inventory

| Capability | Existing implementation observed | Missing work | Database/schema dependency | Safe to implement now |
|---|---|---|---|---|
| College identity | `College` model: `id`, unique `slug`, `official_name`, optional `display_name`, lifecycle `status`, timestamps | No application contact/address/type/representative fields; no application-to-College link | College foundation draft is unapplied; model presence is not deployed schema | Source audit only; no registration persistence |
| Membership | `CollegeMembership` stores user, College, membership role/status, actor/timestamps/reason; unique user/College pair | No invite token, onboarding state, or account activation association | Same unapplied tenant foundation draft | Existing internal helper only; no public invite flow |
| User/authentication | Shared `User` model stores name, email, password hash, global role, active flag; `/auth/login` and `/auth/me`; role is refreshed from database | No pending applicant/account activation model or single-use activation token | Existing users schema and tenant migration compatibility are not verified in PostgreSQL | Keep current auth; no account provisioning |
| Super Admin | `super_admin` is a distinct database-backed global role; `/platform` is wrapped in frontend `ProtectedRoute`; `SuperAdminHome` is a signed-in landing page | No platform application list/detail/review/approve/reject/audit API or UI | No application/audit schema | No review workflow |
| College Admin | `college_admin` exists as a membership role; the legacy global role `admin` remains distinct; tenant context requires an active membership and active College | No registration approval-to-admin-invitation integration | Requires approved College/member/account transaction design and schema | Do not promote `admin`; do not implicitly grant membership |
| Application lifecycle | No College application ORM model, schema, service or route found | Persistent reference, status, transition rules, reviewer/decision history, duplicate control and public status lookup | Requires new persistent schema and migration | Blocked; no in-memory/localStorage substitute |
| College provisioning | College model supports `pending`, `active`, `suspended`, `archived`; no registration-driven College creation/activation route found | Atomic, idempotent provisioning linked to approved application | College/membership tables and unique constraints need applied/verified schema | No College or membership row creation |
| Membership lifecycle helper | `membership_service.py` has internal grant/activate/revoke functions with actor checks; not mounted as an API router | No invite/activation token delivery, application linkage, audit browsing or public onboarding API | Depends on tenant schema; caller transaction/route design required | Existing helper is not an onboarding system |
| Audit history | Generic `AttendanceAuditLog` model/table supports actor, action, entity and metadata | No application-specific relation, lifecycle constraints, review history API, or verified event semantics for registration | Audit table/migration status and schema compatibility are unverified | Do not repurpose as proof of complete application auditability |
| Email/notification | Existing notification source is account/event-oriented; no college invitation or registration delivery path identified | Verified provider configuration, templates, delivery state, retries and token lifecycle | Provider and persistent outbox/token schema required | No email/SMS delivery claims |
| Public website | `/`, `/about`, `/features`, `/how-it-works`, `/founder`, `/contact`, `/privacy`, `/terms`; registration is explicitly described as planned/unavailable | No registration form/API; contact page also correctly says no verified submission channel | None for existing static status display | Preserve truthful unavailable status |
| Test coverage | Existing synthetic tests cover tenant context, membership selection, pilot profile, Super Admin/legacy role separation and default-deny | No registration validation, lifecycle, provisioning, invitation, application audit or public status tests | A real persistence schema is needed before meaningful lifecycle tests | Existing tenant security tests can be run; no fake workflow tests |

### Actual model and route findings

- `User` contains identity/authentication fields and a global role. It does not represent a registration application or activation invitation.
- `College` contains only tenant identity/display/lifecycle fields. A `pending` College status is not an application: it has no applicant/representative information, reference, decision history, or transition API.
- `CollegeMembership` is an explicit grant. Its `college_admin` role is membership-scoped and is not the existing global `admin` role.
- `resolve_tenant_context` reloads the user and active membership from the database, denies global `super_admin` on College-context paths, and requires an active College. A selected College ID only selects among memberships already verified for that user.
- `main.py` registers authentication, tenant read/pilot routes, and legacy routes behind the default-deny dependency. It registers no College-registration or platform-review router. No `POST` registration, application review, approval, rejection, invitation, or activation API was found.
- `get_current_admin` authorizes the legacy global `admin`; it is not a Super Admin dependency. Super Admin's `/platform` frontend protection is useful navigation control but cannot replace server-side authorization for future platform APIs.
- `SuperAdminHome` displays the signed-in identity and says platform onboarding/approvals are unavailable. It has no application list or action controls.
- `membership_service.py` can create a pending College Admin membership when called by a Super Admin, but it does not create a College, require an approved application, issue an invitation, create/activate an account, or expose an HTTP endpoint. This internal primitive does not satisfy onboarding requirements and must not be wired to an unreviewed route.
- The generic attendance audit model is not application-specific evidence of approval history. The bootstrap documentation describes a development-only Super Admin bootstrap, but that script was not run; no Super Admin account was created or verified here.

The tenant foundation and ownership migrations remain **DRAFT / NOT APPLIED**. The foundation draft creates only `colleges` and `college_memberships` over a compatible `users` table; it does not define College application, review history, activation token, or outbox structures. The ownership draft adds nullable ownership to existing business tables and is unrelated to public registration persistence.

## Registration and API readiness

| Workflow / endpoint | Current result | Required evidence before implementation |
|---|---|---|
| Public application submission | **NOT IMPLEMENTED**; no form or API | Approved fields/data-minimization policy, persistent application schema, server validation, duplicate/idempotency policy, abuse/rate-limit design, and tests |
| Application reference/status | **NOT IMPLEMENTED** | High-entropy or non-enumerable reference design, persistence, lookup privacy, expiration/withdrawal policy and tests |
| Super Admin list/detail/review | **NOT IMPLEMENTED** | Server-side platform authorization dependency, schemas, list/detail API, filters, audit controls and denial tests |
| Begin review | **NOT IMPLEMENTED** | Explicit valid state transitions, concurrency/transaction behavior and reviewer audit record |
| Approve/reject | **NOT IMPLEMENTED** | Atomic, idempotent decision/provisioning transaction; immutable decision history; rejection-reason privacy; repeat/concurrency tests |
| College creation/activation | **NOT IMPLEMENTED from an application** | Applied/verified schema, application relationship, uniqueness policy and transaction/rollback design |
| College Admin invitation/activation | **NOT IMPLEMENTED** | Secure single-use expiring token, safe storage, delivery provider or approved alternative, account association and replay/recovery tests |
| College workspace access | Foundation only | Existing context enforces active membership + active College, but no approved registration workflow creates those states; pending/suspended denial must remain |
| Login after activation | Shared login exists for active users | Activation must establish an account and explicit membership safely; no invitation/activation flow currently does so |

The exact future endpoint paths are **not approved or implemented**. Do not infer an API from a proposed path. Endpoint design must specify authentication, request/response schemas, validation, tenant/platform scope, errors, rate limiting, audit, and persistence before route implementation.

## Safe design prerequisites (not implementation authorization)

The smallest coherent persistent design needs an application aggregate with a non-sequential public reference, normalized submitted institution/representative fields, status and timestamps; a separate append-only decision/review history with reviewer identity; and an activation/invitation record whose token is high entropy, single-use, expiring and stored as a verifier rather than plaintext. If delivery is supported, use a transactional outbox/delivery state rather than claiming an email was sent when only a token row was created. Approval must create/activate the College and associate the intended administrator through an explicit membership in one transaction or a recoverable provisioning state machine; it must not mark provisioning complete before both succeed. Database uniqueness constraints and concurrency controls are needed for duplicate submissions and repeated approval.

This is a design outline only, not a final schema. Required decisions include permitted application fields and retention, duplicate institution/email policy, public status lookup threat model, review-role scope, whether rejected applications may be resubmitted, re-review rules, activation expiry/resend/revocation, verified email requirements, College slug generation, and recovery from partial external email delivery. No accreditation, identity, or institutional verification capability is currently established.

### Required future approval sequence

1. Approve product/privacy requirements and lifecycle semantics, including who may submit, review, withdraw, resubmit, and receive application status.
2. Approve an additive application/review/invitation schema and migration after a canonical migration-history and rollback plan exists. The current migration remains DRAFT / NOT APPLIED.
3. Separately authorize an isolated PostgreSQL rehearsal after the existing credential-recovery blocker is resolved. SQLite tests cannot establish PostgreSQL constraints, locking, transactions, or concurrency behavior.
4. Implement persistence/services and transaction boundaries; review concurrency/idempotency and audit semantics.
5. Implement server-side Super Admin APIs and negative-path tests before any review UI can operate.
6. Approve and configure a real email/activation delivery provider or a separately reviewed secure activation procedure. Never expose activation tokens in logs, UI URLs, or support output.
7. Implement public form and status UI only after the API contract exists; success must depend on a confirmed persisted backend response.
8. Run backend synthetic tests, then isolated PostgreSQL integration/rehearsal, frontend serial tests/build, browser verification, privacy/security review, and release review. Production activation/deployment requires separate approval.

## Security boundary matrix

| Principal / state | Current supported behavior | Registration workflow behavior |
|---|---|---|
| Anonymous | May access public static pages; protected routes redirect to login | No submission/status/review endpoint exists |
| Legacy global `admin` | Existing global role is distinct; it does not gain tenant context without explicit membership | No automatic Super Admin or College Admin promotion |
| `super_admin` | Shared login can represent this role; tenant context explicitly denies implicit College access; `/platform` is frontend-protected | No server-side application review/provisioning endpoints exist |
| `college_admin` membership | Tenant access requires active membership and active College on each tenant context resolution | No authority to approve registration or activate its own application is implemented |
| Teacher/student | Tenant access is limited by enabled route role policies | No registration review permission |
| Pending/rejected/suspended application | No application records/states exist | Cannot assert lifecycle denial behavior for a nonexistent workflow |
| Pending/suspended College or inactive membership | Tenant context rejects because both active membership and active College are required | No registration workflow may bypass this guard |

No row-level registration denial test can be meaningful until registration/review APIs exist. Existing tenant tests verify adjacent membership and role boundaries only; they do not prove the required application lifecycle or approval flow.

## Validation

Executed from `backend` with dotenv disabled and an explicit synthetic SQLite URL:

```powershell
$env:ATTENDX_SKIP_DOTENV='1'
$env:ATTENDX_TEST_SQLALCHEMY_URL='sqlite://'
..\.venv\Scripts\python.exe -m unittest tests.test_tenant_foundation_isolated tests.test_tenant_membership_selection_isolated tests.test_tenant_api_pilot_isolated tests.test_tenant_authorization_negative_paths -v
```

**PASS:** 38 tests, 0 failures. These synthetic in-memory SQLite tests cover current tenant membership resolution, inactive/ambiguous/foreign selection denial, Super Admin and legacy-admin separation, the tenant profile pilot, and default-deny behavior. They do not exercise registration and do not establish PostgreSQL compatibility. A Starlette `httpx` deprecation warning appeared; it did not fail tests.

**NOT TESTED:** Registration submission/validation, duplicate applications, status lookup, review transitions, approve/reject, concurrency/idempotency, application audit, College provisioning, invitation delivery/activation, real browser workflow, PostgreSQL parsing/execution/integration, migration application, production endpoint, or deployed schema.

Frontend tests/build were not run because no frontend source changed. No browser test was run. No SQL parser or database operation was used.

## Reality assessment

| Product workflow | Status |
|---|---|
| Public College registration | **NOT IMPLEMENTED**; static site explicitly marks it planned/unavailable |
| Persistent application reference and lifecycle | **BLOCKED BY SCHEMA** |
| Super Admin application list/detail/review authorization | **NOT IMPLEMENTED**; current platform route is a protected landing page only |
| Approval/rejection with audit | **BLOCKED BY SCHEMA** and missing server APIs |
| College provisioning from approval | **BLOCKED BY SCHEMA** and missing transaction/service/API |
| College Admin invitation and secure activation | **BLOCKED BY SCHEMA / PROVIDER** |
| Login and tenant context for existing accounts | **IMPLEMENTED IN SOURCE; synthetic tests pass**, PostgreSQL/deployed schema not tested |
| Tenant isolation foundations | **IMPLEMENTED IN SOURCE; adjacent synthetic negative-path tests pass**, not production acceptance |

### Release and approval status

- Migration: **DRAFT / NOT APPLIED**.
- Credential rotation A-E: **BLOCKED / NOT APPROVED**.
- PostgreSQL validation: **NOT TESTED**.
- Production API endpoint: **UNKNOWN**.
- Browser E2E for this workflow: **NOT TESTED**.
- Email/provider delivery: **NOT IMPLEMENTED / NOT TESTED**.
- Legal/privacy approval: **NOT CLAIMED**.
- Production readiness: **NOT CLAIMED**.

The first blocking gate is schema/product approval for persistent application, review, and activation data. No registration code or fake success path was added. Stop here pending separate authorization for schema design and, later, an isolated PostgreSQL rehearsal.

## Phase 14A.29 implementation continuation (2026-11-10)

**Status: IMPLEMENTED IN SOURCE; PERSISTENT OPERATION BLOCKED.** This addendum supersedes the preceding “NOT IMPLEMENTED” inventory for source-code status only. It does not supersede the unapplied schema gate or imply a deployed workflow. The original audit remains intact as the pre-implementation baseline.

### Implemented source

- Added `CollegeRegistrationApplication` and `CollegeRegistrationReview` ORM models and the DRAFT migration `database/migrations/DRAFT_20261110_add_college_registration_workflow.sql`. The migration depends on compatible `public.users`, `public.colleges`, and `public.college_memberships` tables and has not been parsed by a PostgreSQL parser, applied, or tested against PostgreSQL.
- Public endpoints: `POST /college-registration/applications` accepts validated application fields, stores the administrator password only as the existing one-way hash, and returns a random reference plus a status token once; only a digest of the token is stored. `POST /college-registration/status` requires reference and token and returns only reference/status/submission/review timestamps. Duplicate responses are deliberately generic.
- Server-authorized Super Admin endpoints: `GET /platform/college-applications` (optional `status` filter), `GET /platform/college-applications/{id}`, `GET /platform/college-applications/{id}/history`, and POST actions `/start-review`, `/approve`, `/reject`. Each is guarded by the distinct database-backed `get_current_super_admin`; legacy global `admin` is not treated as Super Admin.
- Approval creates a College in `pending`, a `college_admin` global User marked inactive, and a pending `college_admin` membership in the same ORM transaction. The application moves to `approved` / `pending_activation`, and its stored password hash is transferred to the inactive account and cleared from the application. Rejection creates no College, account, or membership and clears the application password hash. No invitation or activation message is sent; these accounts cannot log in or access a College workspace until a separate verified activation flow exists.
- The public registration/status page and platform review UI call these endpoints. The tracking token is displayed for the applicant to save and is not persisted in browser storage. The review UI supports listing, detail, history, start-review and approve/reject actions. Public pages explicitly state migration and activation limitations.
- Backend dotenv behavior is unchanged by default; `ATTENDX_SKIP_DOTENV=1` is an opt-out for isolated test runs. No `.env` file was read or changed during this continuation.

### Boundaries and remaining risks

- All changes are source-only. The workflow is **not operational against the project database** while the migration is DRAFT / NOT APPLIED. No DB operation was performed. The isolated SQLite fixtures establish API/model behavior only, not PostgreSQL locking, partial indexes, transaction semantics, DDL compatibility or deployment.
- No verified invitation/activation provider or alternative exists. Approval provisions a pending/inactive identity only; do not tell applicants that an email was sent or access is ready.
- Public registration and status endpoints have no application-level rate limiting in this implementation. A separately reviewed rate limit/abuse-control layer and request-body-safe logging policy are required before exposing them publicly. Do not log request bodies containing passwords or tracking tokens.
- Application fields, privacy notice, legal retention period, deletion/withdrawal policy, duplicate institutional identity policy, and status-token support/recovery procedure need owner/legal approval. Pending application password hashes persist until review unless operations decide otherwise; retention is not implemented.
- Row locks and integrity handling are implemented in source, but concurrent approve/reject and retry behavior still needs PostgreSQL verification and a designed recovery procedure. SQLite tests are not evidence for those guarantees.
- No tenant business write APIs were added. Teacher/student/class/subject assignment and attendance submission remain incomplete or gated; the previously enabled read-only tenant APIs are unchanged. No Super Admin tenant access, legacy-admin promotion, default College, automatic membership beyond the explicit pending approval transaction, or legacy ownership backfill was added.
- `backend/create_admin.py` remains untouched and uninspected. No bootstrap script, credentials, tokens, DPAPI, PostgreSQL, production database, service, cluster, port, ACL, provider, or migration operation was used.

### Final continuation validation

- **PASS:** Backend focused registration + tenant security suites: 48 tests, 0 failures, synthetic in-memory SQLite, dotenv opt-out and synthetic signing key. Command: from `backend`, set `ATTENDX_SKIP_DOTENV=1`, `ATTENDX_TEST_SQLALCHEMY_URL=sqlite://`, synthetic `SECRET_KEY` and `ALGORITHM=HS256`; run `..\.venv\Scripts\python.exe -m unittest tests.test_college_registration_isolated tests.test_tenant_foundation_isolated tests.test_tenant_membership_selection_isolated tests.test_tenant_api_pilot_isolated tests.test_tenant_authorization_negative_paths -q`. A Starlette/httpx deprecation notice was emitted; no assertion failures.
- **PASS:** Frontend serial suite: **21 files, 104 passed, 0 failed, 0 skipped**. Command: in `frontend`, enumerate `tests/*.test.mjs` in filename order and invoke `node <file>` one process at a time. The initial sandboxed worker-style run encountered Windows `spawn EPERM`; serial per-file execution outside that restricted process sandbox passed. An initial serial run exposed one stale assertion for updated “awaiting secure admin activation” wording; after correcting that assertion, the full serial suite passed.
- **PASS (validation only):** Vite 7.3.7 build transformed **1,947 modules**, with dotenv loading disabled, `https://phase1429-validation.example.invalid` as the temporary reserved API URL, source maps disabled, and `build.write=false`; no output artifact was written. This is not a deployable build. Non-fatal dependency `use client` directive warnings remain.
- **PASS:** Python AST check, `git diff --check`, and scoped trailing-whitespace scan (reported in the final continuation report) are static checks only.
- **NOT TESTED:** Real browser E2E, PostgreSQL parser/execution/integration, migration application, deployed schema, email/activation delivery, production API endpoint and production security controls. No production readiness claim.

Source files added/changed for this continuation include `backend/app/api/college_registration.py`, `backend/app/schemas/college_registration.py`, the two registration models in `backend/app/models.py`, `backend/app/main.py`, the dotenv opt-out in `backend/app/security.py`, frontend registration/review services and pages/routes, the draft SQL migration, and focused backend/frontend tests. Existing user modifications and untracked paths were preserved.
