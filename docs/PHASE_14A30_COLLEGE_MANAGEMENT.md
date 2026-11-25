# Phase 14A.30 — Super Admin College Management and Registration (2026-11-10)

## Summary and disposition

The source now includes public application submission/status, Super Admin application list/search/detail/review/decision, College directory/search/detail, permitted profile editing, College suspend/reactivate, and auditable College status history. The Super Admin routes use the server-side database-backed `get_current_super_admin` dependency; frontend route protection is an additional navigation guard, not the security boundary.

**Source implementation: PARTIAL. End-to-end deployed workflow: BLOCKED.** The required registration and tenant migrations remain DRAFT / NOT APPLIED. No configured database was accessed. A new draft adds College profile columns and status history. Until both prerequisite drafts are reviewed and separately applied to an authorized test database, these APIs cannot be claimed operational against the configured app. PostgreSQL behavior and concurrent locking were not tested.

## Route and feature inventory

| Capability | API / UI | Result |
|---|---|---|
| Submit public registration | `POST /college-registration/applications`; `/register-college` | IMPLEMENTED IN SOURCE; synthetic persistence tested |
| Check status by reference + private token | `POST /college-registration/status`; same public page | IMPLEMENTED IN SOURCE; synthetic status/invalid-token tests pass |
| List/filter/search applications | `GET /platform/college-applications?status=&q=` | IMPLEMENTED; Super Admin only |
| Application detail and history | `GET /platform/college-applications/{id}` and `GET /platform/college-applications/{id}/history` | IMPLEMENTED; Super Admin only |
| Start review, approve, reject | POST `/platform/college-applications/{id}/start-review`, `/approve`, `/reject` | IMPLEMENTED in source; transactional SQLite tests pass; PostgreSQL row-lock/concurrency behavior NOT TESTED |
| College directory/search/filter | `GET /platform/colleges?q=&status=` | IMPLEMENTED; supports name, display name, slug, numeric ID |
| College detail and associated admin memberships | `GET /platform/colleges/{college_id}` | IMPLEMENTED; source uses approved application metadata and actual college_admin memberships/accounts |
| College status history | `GET /platform/colleges/{college_id}/history` | IMPLEMENTED in source; depends on new draft history table |
| Update profile | `PATCH /platform/colleges/{college_id}` | IMPLEMENTED for official/display names, type, address, city/region/postal/country, official email, phone and website only |
| Suspend/reactivate | `POST /platform/colleges/{college_id}/status` | IMPLEMENTED; active→suspended and suspended→active only; reason required; history row written in same transaction |
| Super Admin screen | `/platform` and `/platform/colleges` | Application and College screens call real service methods; test suite uses mocked services, not a browser |

Profile endpoints reject extra fields. Slug, College ID, tenant ownership, membership/account roles, College Admin identity and activation state cannot be changed through the profile endpoint. Status transitions also cannot be smuggled through profile updates.

## Approval and activation behavior

Approval locks the application row, accepts only pending/under-review applications, and atomically creates a pending College, inactive `college_admin` user, pending `college_admin` membership, application decision history, and initial `provisioned_pending` College status-history event. It transfers the stored one-way password hash to the inactive account and clears it from the application. A repeated decision is rejected. The College remains pending because account activation/invitation is not configured; the UI explicitly reports that no invitation was sent.

Rejection requires a reason, creates no College/account/membership, clears the pending password hash, and records review history. This workflow does not activate an applicant or give an applicant workspace access. Existing tenant context checks College status and active membership on each tenant API request. Suspension therefore denies tenant data access; the synthetic test confirmed the tenant profile route returns 403 after suspension.

## Authentication and isolation tests

Synthetic tests verify anonymous, legacy global admin, College Admin, Teacher and Student denial for platform College operations; Super Admin acceptance; constrained profile updates; invalid transitions; duplicate approval rejection; no provisioning on rejection; and suspended-College tenant denial. Existing tenant security suites continue to cover membership-scoped cross-College access and suspended/inactive context denial. These tests use SQLite and do not prove PostgreSQL lock or transaction guarantees.

## Draft schema requirement

`database/migrations/DRAFT_20261110_add_college_status_history.sql` adds nullable College profile fields (preserving existing rows without ownership assumptions) and `public.college_status_history`. Source review found that approval writes those fields/history, while the prior preflight incorrectly required the registration table. The draft prerequisite is corrected to require tenant foundation `users` and `colleges` only, so proposed order is foundation, College profile/status-history schema, then registration workflow, before enabling approval. It remains **DRAFT / NOT APPLIED**. Adding these ORM fields means code deployment must be coordinated with an approved schema rollout; current PostgreSQL schema compatibility is UNKNOWN. No migrations were executed.

## Testing and validation

**Backend command** (from `backend`; explicit synthetic test setup, dotenv disabled):

```powershell
$env:ATTENDX_SKIP_DOTENV='1'
$env:ATTENDX_TEST_SQLALCHEMY_URL='sqlite://'
$env:SECRET_KEY='<synthetic-only value of at least 32 bytes>'
$env:ALGORITHM='HS256'
..\.venv\Scripts\python.exe -m unittest tests.test_platform_college_management_isolated tests.test_college_registration_isolated tests.test_tenant_foundation_isolated tests.test_tenant_membership_selection_isolated tests.test_tenant_api_pilot_isolated tests.test_tenant_authorization_negative_paths -q
```

**PASS:** 55 tests, 0 failures. Starlette emitted a non-failing deprecation warning about `httpx` TestClient integration. No `.env` was loaded.

**Frontend:** All `frontend/tests/*.test.mjs` were sorted by filename and executed serially as `node <file>`. **PASS:** 22 files, 107 tests passed, 0 failed, 0 skipped. New Super Admin College screen tests passed 2/2; existing review tests 2/2 and route tests 3/3. UI tests mounted React in jsdom with mocked APIs. No real browser was launched.

**Vite validation build:** dotenv disabled (`envFile:false`), inherited VITE variables removed by name without reading their values, temporary reserved URL `https://phase1430-validation.example.invalid`, source maps disabled, `build.write:false`. Vite 7.3.7 transformed 1,948 modules. PASS as validation only; output was not written and this is not deployable. Existing non-fatal ignored `use client` directive warnings remain.

Python AST checks, `git diff --check`, and scoped whitespace scan: PASS. No SQL parser, PostgreSQL connection, production DB, migration execution, credential, DPAPI, service, cluster, port or ACL operation occurred.

## A–H acceptance status

A. **College registration submission — IMPLEMENTED AND TESTED (synthetic SQLite).** Real configured-database persistence remains NOT TESTED / BLOCKED by unapplied schema.

B. **Application status tracking — IMPLEMENTED AND TESTED (synthetic SQLite).** Public status returns only reference/status/timestamps after reference+token verification. Token is not placed in a URL or browser storage.

C. **Super Admin application review — IMPLEMENTED AND TESTED (synthetic SQLite/API and jsdom UI mocks).** Database-backed role dependency protects every endpoint; application query supports status and search. Browser E2E NOT TESTED.

D. **College approval/provisioning — IMPLEMENTED, NOT FULLY TESTED.** Atomic source transaction and sequential retry protections covered by SQLite; PostgreSQL transaction/concurrency and deployment behavior NOT TESTED. Result is pending College/inactive account/pending membership, not activated access.

E. **College profile updates — IMPLEMENTED, NOT FULLY TESTED.** APIs restrict edits to profile fields and synthetic tests cover permitted and protected fields. Requires the new DRAFT profile columns to be applied.

F. **Suspend/reactivate — IMPLEMENTED, NOT FULLY TESTED.** Synthetic APIs verify transitions, audit history and suspension denial. Requires status-history schema and PostgreSQL verification.

G. **College Admin login/dashboard — BLOCKED — APPROVAL/IMPLEMENTATION REQUIRED.** The provisioned account is inactive and membership/College are pending; no verified activation or invitation flow exists. Login is expected to fail until a separate secure activation workflow is implemented and approved. Existing tenant page routes are not proof of this new account being usable.

H. **Teacher/Student management integration — NOT IMPLEMENTED for full CRUD.** Existing tenant-scoped read views remain available to authorized active members. Tenant-safe teacher/student writes, class/subject management writes and attendance submission are not enabled by this phase and remain behind existing security gates.

## Manual verification after approvals

1. Separately review the tenant foundation, registration workflow and Phase 14A.30 drafts against a known isolated schema. Obtain approval before any migration execution; do not target production.
2. After approved isolated PostgreSQL application, verify the new columns/tables and then run the same workflow tests against that isolated instance. Verify rollback/recovery and concurrent duplicate-review behavior before rollout.
3. Using an authorized Super Admin test account and synthetic institution data, submit once through `/register-college`; confirm the UI shows a returned reference only after 201 and check status with the returned reference/token.
4. In `/platform`, search/filter, open detail/history, approve or reject. For approval, verify pending College, inactive account, pending membership, application history and initial College status history. Do not expect an invitation email or login to succeed.
5. In `/platform/colleges`, search by name/slug/ID, edit permitted fields, verify profile changes, suspend an active College and confirm tenant-scoped APIs deny access; reactivate with a recorded reason and confirm context works only if membership/account are active.
6. Do not test College Admin login until a separately approved activation/invitation feature is implemented.

## Remaining blockers

- Tenant foundation, Phase 14A.29 registration and Phase 14A.30 profile/history migrations remain DRAFT / NOT APPLIED.
- PostgreSQL syntax, schema, foreign keys, transactions, row locking and concurrent double-review behavior NOT TESTED.
- College Admin invitation/activation and login are unavailable.
- Teacher/Student/academic write endpoints and teacher attendance submission are not implemented/enabled.
- Production API endpoint remains UNKNOWN. Browser visual/E2E and deployment are NOT TESTED. Production readiness is NOT CLAIMED.
- Credential rotation A–E remains BLOCKED / NOT APPROVED.

The workspace contained extensive pre-existing modified and untracked files before Phase 14A.30. No destructive Git operation, commit, push, dependency installation, or unrelated cleanup was performed.
