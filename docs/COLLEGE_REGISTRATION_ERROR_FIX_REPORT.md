# College Registration Temporarily Unavailable â€” Root-Cause Investigation

**Date:** 2026-11-10
**Result:** **BLOCKED — user-supplied logs confirm SQLSTATE `42P01` (undefined table) for a registration-module database failure, but do not identify the missing relation or correlate it to each listed request.** No backend or frontend application-code fix is justified until the exact relation and live schema are established. The synthetic missing-table fixture was tightened so `public.users` exists and the request reaches the missing registration-table query.
**Acceptance:** `REAL POSTGRESQL REGISTRATION NOT YET VERIFIED.`

## A. Original error and confidence

The reported UI text is `Registration is temporarily unavailable. Please try again later.` In the current component, this text is selected for either HTTP 503 or a request with no HTTP response (`frontend/src/pages/public/CollegeRegistrationPage.jsx:16-20`); other HTTP 5xx responses also select it at lines 30-32. Therefore the displayed text alone does **not** identify whether the request reached FastAPI or whether the server returned 503.

The backend's sanitized registration 503 body is `College application service is unavailable.` (`backend/app/api/college_registration.py:124-137`). The code maps SQLAlchemy storage errors, including missing table/column/schema and database connection/operation errors, to that response. A synthetic SQLite test keeps `users` available while omitting the registration table, so the request reaches the application-table query and reproduces this exact 503 path (`backend/tests/test_college_registration_isolated.py:167-187`). This proves that a missing registration table is one cause, not that it is the cause in the user's configured PostgreSQL database.

**User-supplied live evidence:** POST `/college-registration/applications` returned 422 for one attempt and 503 for a later attempt; application-list and College-list requests returned 503; a `college_registration_database_unavailable` log recorded `ProgrammingError`, SQLSTATE `42P01`. The 422 is a separate request-validation failure. The log contains no relation name or request correlation ID, so it cannot establish which relation failed or which request produced that diagnostic. **Independent live verification:** NOT TESTED. No database was connected to in this phase.

## B. Request trace

| Layer | Implementation and evidence |
|---|---|
| Form | `frontend/src/pages/public/CollegeRegistrationPage.jsx:9-14, 104-128`; controlled fields are `college_name`, `college_type`, `address`, `city`, `state`, `postal_code`, `country`, `official_email`, `contact_number`, optional `website`, `admin_name`, `admin_email`, `admin_contact_number`, `password`, and `password_confirmation`. |
| Submit handler | `frontend/src/pages/public/CollegeRegistrationPage.jsx:49-68`; prevents a second submission while `submitting`, sends the fields as JSON through the service, converts blank website to `null`, shows success only after a resolved backend response, and clears the form only after success. It does not log the body. |
| API service | `frontend/src/services/collegeRegistration.js:3-6`; `api.post("/college-registration/applications", payload)` returns `response.data`. |
| API client/base | `frontend/src/services/api.js:3-23`; base URL is resolved from the public Vite API setting via `apiBaseUrl.js`, JSON content type is configured, and the shared Axios client is used. `frontend/src/services/apiBaseUrl.js:39-46` prefers `VITE_API_BASE_URL`, then `VITE_API_URL`; development may use loopback when unset. The effective runtime value was not inspected. |
| Method/path | `POST /college-registration/applications`. `backend/app/main.py:241` includes the public router without a global `/api` prefix; `backend/app/api/college_registration.py:63-67, 160-167` sets the router prefix and application path. The service path is correct for this route registration. |
| Request schema | `backend/app/api/college_registration.py:160-167` accepts `CollegeRegistrationCreate`; `backend/app/schemas/college_registration.py:26-43` defines the same field names and types (strings, optional nullable website, `SecretStr` passwords; extra fields forbidden). Email is lowercased, phone is normalized and must be international format, password strength/confirmation are checked at lines 45-90. |
| Persistence/service | `backend/app/api/college_registration.py:169-212` checks existing user/admin email and non-rejected application duplicates, creates a random `AXR-` reference and high-entropy tracking token, stores only token SHA-256 and a password hash, adds the pending application and commits/refreshes before returning. |
| ORM/schema | `backend/app/models.py:323-380` defines `CollegeRegistrationApplication`, matching the registration draft's columns and partial unique indexes. The draft is `database/migrations/DRAFT_20261110_add_college_registration_workflow.sql:1-6`; it requires `public.users`, `public.colleges`, and `public.college_memberships` (`12-18`) and creates the application/review tables (`20-77`). Its runtime application status was not checked. |
| Response | `CollegeRegistrationSubmission` (`backend/app/schemas/college_registration.py:93-97`) contains `application_reference`, `status`, and `tracking_token`; backend returns HTTP 201 (`backend/app/api/college_registration.py:160-164, 205-212`). The frontend consumes these fields at `CollegeRegistrationPage.jsx:60-62`. |
| Errors | Backend returns sanitized 409 for duplicates and 503 for SQLAlchemy failures (`college_registration.py:115-137, 213-236`). Validation errors are sanitized to type/location/message only (`44-60`). The component maps 409 and 422 separately; it maps 503/no-response/other 5xx to its generic unavailable text (`CollegeRegistrationPage.jsx:16-34`). |

No extra `/api` prefix is added by FastAPI. Whether a deployed frontend base URL includes a prefix incompatible with the backend is UNKNOWN because no environment values were inspected and no live request was made.

## C. Source and migration findings

- The client route, HTTP method, JSON payload field names, and response property names align with the current FastAPI route and Pydantic models. The `website` empty-to-null conversion matches the optional schema field.
- Registration relies on `public.users` (existing-account check) and the full `public.college_registration_applications` table (duplicate check, insert, refresh). The migration draft additionally checks for `public.colleges` and `public.college_memberships` because the workflow includes later approval/provisioning. Review/approval also uses registration review/history and tenant tables. Exact live columns/indexes cannot be inferred from draft filenames.
- ORM and migration source agree on registration table columns and unique/index intent at static inspection level. This is not proof of PostgreSQL DDL validity or live schema compatibility.
- DRAFT status is source metadata only. No migration ledger or PostgreSQL catalog was queried, so no applied/unapplied status is asserted.
- The current failure handler safely conflates multiple storage causes into a sanitized 503 while logs classify common categories without SQL or request bodies. This is appropriate for public disclosure; logs are not available to this read-only investigation.

## D. Security and data handling

Source uses `secrets.token_urlsafe(32)` for the status token, stores SHA-256 digest only, returns the raw token only in the successful submission response, and verifies reference plus token with constant-time comparison (`college_registration.py:183-212, 238-255`). Password input uses `SecretStr`, is checked against confirmation, is hashed before persistence, and is omitted from response schemas. Synthetic tests verify no College/account/membership is provisioned by public submission, token digest persistence, password hashing, and non-disclosure. No real token/password was used or inspected in this phase.

## E. Tests and validation

All backend commands were run from `backend` with process-only `ATTENDX_SKIP_DOTENV=1`, `ATTENDX_TEST_SQLALCHEMY_URL=sqlite://`, a synthetic test signing key, and explicit test CORS values. These tests use isolated SQLite and are not PostgreSQL validation.

| Status | Command | Result |
|---|---|---|
| PASS | `..\\.venv\\Scripts\\python.exe -m unittest tests.test_college_registration_isolated tests.test_tenant_registration_isolated -v` | 27 passed, 0 failed, 0 errors. Includes valid synthetic persistence/reference, missing required fields, invalid email/phone/password/confirmation, duplicate conflict, missing-table 503, privacy, and tenant registration coverage. |
| FAIL (unrelated existing suite issues) | `..\\.venv\\Scripts\\python.exe -m unittest discover -s tests -q` | 258 run: 225 succeeded, 23 failed, 10 errored. Assertion failures primarily reflect legacy tests expecting unscoped APIs to respond instead of the default-deny 503. Setup errors are SQLite fixtures manually creating tables already created by ORM metadata (`attendance_events`, `attendance_sessions`, `student_guardians`). No default-deny behavior or assertions were changed. |
| PASS | `node --test --test-concurrency=1 tests/public-pages.test.mjs` | 9 passed, 0 failed. Initial restricted run stopped before assertions with Windows `spawn EPERM`; retry outside the restricted process sandbox passed. |
| PASS | `node --test --test-concurrency=1 tests/*.test.mjs` | 111 passed, 0 failed, 0 skipped. The run was serial and outside the restricted process sandbox. |
| NOT RUN | Frontend production build | No frontend source was changed; the test-only investigation did not require a build. |
| NOT TESTED | PostgreSQL, actual registration/persistence, browser flow, post-restart status lookup | No live operation was permitted/performed. |

## F. Files changed

- `backend/tests/test_college_registration_isolated.py` â€” tightened the missing-registration-table fixture to retain the `users` prerequisite, proving the request fails at the application-table query in synthetic SQLite.
- `docs/COLLEGE_REGISTRATION_ERROR_FIX_REPORT.md` â€” this investigation report.
- `docs/TEST_RESULTS.md` â€” appended exact results for this investigation.

No backend/frontend application code, migration, `.env`, or database configuration was modified in this pass. Existing dirty and untracked work was preserved.

## G. PostgreSQL findings and blocker

**PostgreSQL persistence: BLOCKED / NOT TESTED.** The provided local target is `127.0.0.1:5432/attendx`, but it was not contacted. To distinguish missing schema from connection failure, constraint mismatch, or another runtime failure, a separately approved read-only identity/schema inspection must verify:

1. Server identity/version and database identity for only `127.0.0.1:5432/attendx`.
2. `public.users.id` type/primary key and `public.users.email` type/uniqueness needed by the existing-account query.
3. Presence and definitions of `public.college_registration_applications` columns used by the submit route: `id`, `application_reference`, `tracking_token_digest`, `status`, `provisioning_status`, `college_name`, `college_type`, `address`, `city`, `state`, `postal_code`, `country`, `official_email`, `contact_number`, `website`, `admin_name`, `admin_email`, `admin_contact_number`, `admin_password_hash`, `submitted_at`, `reviewed_at`, `reviewed_by_user_id`, `review_reason`, `college_id`, and `admin_user_id`.
4. Unique constraints/indexes for `application_reference` and the active (non-rejected) `official_email` and `admin_email` rules, plus referenced foreign keys.
5. Existence and compatible structure of prerequisite `public.colleges` and `public.college_memberships` because the reviewed workflow draft requires them and approval depends on them.

If schema is compatible, establishing actual persistence requires a separately approved synthetic registration write and verification. If schema is missing/incompatible, review the exact migration and backup plan and obtain separate explicit approval before any backup or migration. Neither approval is included here. No credentials can be obtained by reading `.env` under the current restrictions; any authorized connection must use a separately approved safe credential-supply method.

## H. Next action

Request separate explicit authorization for **read-only** inspection of the exact local target and listed catalog metadata, with no row data, write, backup, or migration. If the read-only result does not explain the issue, seek a second exact approval for one synthetic registration and persistence/status verification. Until then, report the source path as verified, synthetic behavior as passed, and the user's actual PostgreSQL failure cause as **UNKNOWN / BLOCKED**. Do not claim `College Registration Fixed`.

## I. Follow-up: user-supplied 42P01 evidence and route/table mapping

The supplied log confirms a PostgreSQL `ProgrammingError` with SQLSTATE `42P01` on a registration-module diagnostic. PostgreSQL defines this category as an undefined table/relation. The diagnostic excerpt does not include PostgreSQL's relation identifier or a request ID, and it cannot be paired conclusively with the POST, application-list GET, or College-list GET. Therefore the exact missing relation is still **UNKNOWN**.

| Request | Source query sequence | Source-derived relation candidates if the query raises 42P01 | Migration source |
|---|---|---|---|
| `POST /college-registration/applications` | `college_registration.py:165-207`: first query `users.id` filtered by `lower(users.email)`; then `college_registration_applications.id` for duplicate lookup; then INSERT/refresh of the application model. | `public.users` or `public.college_registration_applications`. A missing application column would normally be `42703`, not `42P01`. | Tenant foundation v2 is the source for `colleges` and `college_memberships`; registration workflow draft `DRAFT_20261110_add_college_registration_workflow.sql:20-63` creates the application relation. The draft also has a preflight for users/colleges/memberships at lines 10-18. |
| `GET /platform/college-applications?status=pending` | `college_registration.py:263-284`: Super Admin dependency loads the database-backed `User`; handler queries the complete `CollegeRegistrationApplication` ORM row, filters status/search, orders by submission and ID. | `public.users` (auth dependency) or `public.college_registration_applications`. `college_registration_reviews` is not queried by this list endpoint. | User table is legacy prerequisite; registration workflow draft creates the application table. The same draft creates reviews for separate history/review operations. |
| `GET /platform/colleges` | `platform_colleges.py:83-109`: Super Admin dependency loads `User`; query selects full `College` ORM entity; then selects full `CollegeRegistrationApplication` ORM entities for those college IDs. | `public.users`, `public.colleges`, or `public.college_registration_applications`. If a relation exists but required mapped columns are absent, that is a separate undefined-column class (`42703`). | Tenant foundation v2 creates `colleges` and `college_memberships`; status-history draft adds College profile columns used by the full College ORM select; registration workflow draft creates application relation. The list handler does not query `college_memberships` or `college_status_history` directly. |

The `/auth/me` 200 in the supplied log is evidence that that particular request authenticated successfully, but it does not prove the application/College relations exist, nor does it correlate to the later 503 requests. No route's missing table can be named from the current logs.

### Exact read-only inspection approval scope

If explicitly approved, inspect only `127.0.0.1:5432/attendx`, first verifying connection identity with database name, server address/port, server version, and authenticated role. Then query PostgreSQL catalog metadata only—no business rows, passwords, hashes, verifiers, application data, or connection strings—for:

1. **`public.users`:** relation presence; column names/types/nullability; `id` integer primary key; email definition and uniqueness/indexes. For the Super Admin dependency's full `User` ORM selection, verify `id`, `name`, `email`, `hashed_password`, `role`, `is_active`, and `created_at` exist with compatible types. Do not select their values.
2. **`public.colleges`:** relation presence; all mapped columns `id`, `slug`, `official_name`, `display_name`, `college_type`, `address`, `city`, `state`, `postal_code`, `country`, `official_email`, `contact_number`, `website`, `status`, `created_at`, `updated_at`; primary key; unique slug index; status/name/slug checks; referenced constraints. The profile fields are added by the status-history draft, while the base fields are created by tenant foundation v2.
3. **`public.college_memberships`:** presence and metadata required by the registration migration preflight and approval flow: `id`, `user_id`, `college_id`, `role`, `status`, creator/activator/revoker IDs, activation/revocation timestamps, `status_reason`, `created_at`, `updated_at`; primary/unique constraints, role/status checks, FKs and user/status and College/status indexes. This relation is not read by the three listed failing endpoints, but is an explicit registration-workflow migration prerequisite and approval dependency.
4. **`public.college_registration_applications`:** presence and all mapped columns: `id`, `application_reference`, `tracking_token_digest`, `status`, `provisioning_status`, `college_name`, `college_type`, `address`, `city`, `state`, `postal_code`, `country`, `official_email`, `contact_number`, `website`, `admin_name`, `admin_email`, `admin_contact_number`, `admin_password_hash`, `submitted_at`, `reviewed_at`, `reviewed_by_user_id`, `review_reason`, `college_id`, `admin_user_id`; primary/unique `application_reference`; partial unique indexes `uq_college_registration_applications_active_official_email` and `..._active_admin_email`; status/provisioning checks; FK targets and types; status/submitted index.
5. **`public.college_registration_reviews`:** relation/column/constraint/index metadata for the broader review workflow, although it is not queried by these three failing operations. Verify `id`, `application_id`, `reviewer_user_id`, `decision`, `reason`, `created_at`; primary key, FKs, decision check, and `ix_college_registration_reviews_application_created`.
6. **`public.college_status_history`:** relation/column/constraint/index metadata for approval/status lifecycle, not a direct dependency of the three listed read/submit query bodies. Verify `id`, `college_id`, `actor_user_id`, `action`, `previous_status`, `new_status`, `reason`, `created_at`; primary key, FKs, checks, and `ix_college_status_history_college_created`.
7. **Migration history:** inspect a migration ledger only if its actual name/schema is established by source or catalog metadata; do not infer applied state from filenames. Compare catalog state with the source drafts listed below. No application migration will be marked or executed.

Identity and schema checks must use read-only `SELECT` from identity functions and PostgreSQL catalogs/information schema. If identity, role, or metadata is ambiguous, stop. No credential may be obtained by reading `.env`; the connection needs an independently approved credential-supply method.

### Migration dependency/order review (source-only)

The registration workflow draft declares tenant foundation v2 and compatible `public.users` prerequisites. Tenant foundation v2 requires `public.users.id INTEGER NOT NULL PRIMARY KEY` and creates `colleges` and `college_memberships`. The College status-history draft requires users/colleges, adds the nullable profile columns used by the College ORM and creates `college_status_history`. The registration workflow draft creates application and review tables. **Source-proposed order for a verified compatible existing DB:** users prerequisite → tenant foundation v2 → College status/profile history → registration workflow. Foundation v1 and v2 are alternative drafts, not sequential migrations. This is a proposal only; actual schema and migration history are unverified.

The drafts are marked `DRAFT / NOT APPLIED` in source. The registration workflow manual rollback drops both application/review tables and would destroy their data; the status-history rollback drops its audit table; tenant foundation rollback drops tenant tables. None is an automatic or authorized rollback. No SQL parser or PostgreSQL validation was run in this phase. The DRAFT filenames do not establish live application state.

### HTTP 422 separation

The provided request logs establish one 422 before a later 503, but contain no validation detail. Static comparison found no field-name mismatch: the React form's field set matches `CollegeRegistrationCreate`, including `admin_contact_number`; blank website is sent as JSON null; passwords use matching names. Server phone validation accepts normalized international numbers in `+` form, and password length/strength/confirmation are enforced. The exact 422 field/reason remains **UNKNOWN** without the sanitized response `detail` (location and message only) for that attempt. Do not infer that it is the cause of the later 42P01 failure. No source correction is justified by the evidence supplied.

## J. Current stop boundary

**No PostgreSQL connection, schema inspection, backup, migration, or database write was performed.** The exact request for permission is a one-time read-only identity and schema-catalog inspection of `127.0.0.1:5432/attendx` limited to the relations and metadata in section I; no row data or write. A synthetic registration submission, backup, and migration each remain outside that scope and require separate explicit approval. The 422 can be diagnosed independently if the user supplies its sanitized field locations/messages without submitted input.

## I. Follow-up migration correction and execution plan (2026-11-10)

- **PASS (source correction prepared):** `DRAFT_20261105_add_tenant_foundation_postgresql_v2.sql` now declares the ORM-required `UNIQUE (id, user_id, college_id)` as `uq_college_memberships_id_user_college`. The account-activation draft verifies that exact named unique key and ordered columns before creating its composite foreign key; it no longer attempts to add a duplicate constraint.
- **PASS (fail-closed profile preflight):** The College status-history draft checks pre-existing profile columns for exact nullable `VARCHAR(n)` type/length before `ADD COLUMN IF NOT EXISTS`, preventing silent acceptance of conflicting definitions.
- **PASS (migration tests):** Static migration tests were extended to check the composite-key placement/dependency, profile-column compatibility guard, and registration-draft prerequisites/transaction framing.
- **BLOCKED (application/API isolated tests in this environment):** The focused unittest command could not import Starlette's `TestClient` because installed Starlette requires the absent `httpx2` package. No dependency was installed. The database-independent migration static suite passed 9/9.
- **Migration execution plan:** See `docs/COLLEGE_REGISTRATION_MIGRATION_PLAN.md`. Proposed order is foundation v2 only, College profile/status history, then registration/review. Validate exact target schema and backup/restore first; never apply v1 and v2 together. Account activation is a separate later dependency.
- **NOT TESTED:** PostgreSQL syntax/execution, actual schema/migration state, live registration persistence, pending-list query, and real browser submission. The prior user-supplied 42P01 remains not correlated to a relation or endpoint; the exact live cause is UNKNOWN. The earlier 422's exact validator is also UNKNOWN without its sanitized validation details.
- **NO DATABASE ACTION:** No connection, SQL, migration, backup, registration request, `.env`, credential, service, or `backend/create_admin.py` access occurred.

## 2026-11-10 urgent follow-up — structured registration failure diagnostics

- **PASS (source trace):** `submit_college_application` executes database work in this order: (1) `SELECT users.id` for the administrator email; (2) `SELECT college_registration_applications.id` for a non-rejected email duplicate; (3) INSERT at commit; (4) refresh by primary key. The first potential 42P01 stage is `existing_user_lookup` / `public.users`. If that succeeds, the next potential stage is `duplicate_application_lookup` / `public.college_registration_applications`. Insert/commit and refresh are subsequent stages. The supplied log has no stage or relation field, so it does not establish which stage failed.
- **UNKNOWN (exact missing relation):** The existing log's `sqlstate=42P01 constraint=unknown` proves an undefined-table class error, but it does not name a table. The user-provided inventory is not a fresh catalog check. The likely relation, conditional on `public.users` being present and compatible, is `public.college_registration_applications`; this is not proven.
- **PASS (diagnostic hardening):** Registration storage and integrity logs now include a fixed stage label and sanitized PostgreSQL `diag.schema_name` / `diag.table_name` when supplied. Identifiers are bounded and restricted to a single-line safe character set. No SQL text, bind parameters, emails, passwords, tokens, connection data, or original exception messages are logged; the public response remains the existing generic 503. If the server/driver does not provide structured object fields, relation remains `unknown`; the code does not parse error text.
- PostgreSQL 18 documentation says `42P01` is `undefined_table`, while separate error object-name fields are provided only for some errors; full coverage is limited to integrity class 23. Therefore structured table-name diagnostics must be treated as optional, not guaranteed: https://www.postgresql.org/docs/18/errcodes-appendix.html .
- **BLOCKED (read-only catalog verification):** No safe credential-supply mechanism was available within the restriction against reading `.env` or credentials. No connection was attempted. Owner metadata still needed: server/database identity and search path; `to_regclass`/catalog presence for users, colleges, memberships, applications, reviews, and status history; `users.id` type/nullability/PK; relevant columns, indexes and FK targets; same-named objects in other schemas; and migration records.
- **PASS (tests):** From `backend`, dotenv opt-out and explicit synthetic SQLite URL: `..\\.venv\\Scripts\\python.exe -m unittest tests.test_college_registration_diagnostics tests.test_tenant_migration_static -v` — 12 passed. These are unit/static tests, not PostgreSQL validation.
- **NOT TESTED:** Actual registration persistence, pending-list response, live missing relation, PostgreSQL diagnostic behavior, and browser workflow. The separate earlier API test command remains blocked at import because Starlette TestClient requires unavailable `httpx2`; no dependency was installed.
- Migration drafts remain **DRAFT / NOT APPLIED**; no SQL, migration, backup, database, `.env`, credential, service, or `backend/create_admin.py` operation occurred.

## Urgent registration 503 follow-up � 2026-11-11

- **Exact stage from source order:** `submit_college_application` performs session dependency creation, then `users.id` lookup, then duplicate lookup on `college_registration_applications.id`, then INSERT during commit, then refresh. The first query can fail if `users` is absent or not visible through the connection search path. If it succeeds, the duplicate query is the next table-dependent operation. Current logs predate or lack the new stage fields, so the failing stage is not identified by the supplied log.
- **Exact missing table:** **UNKNOWN / NOT PROVEN.** Conditional on a successful users lookup, `public.college_registration_applications` is the first likely missing relation. The user-supplied old inventory is not a current catalog query and is not treated as proof.
- **Safe catalog preflight:** No connection was attempted. Although read-only identity/schema inspection is authorized, there is no available safe credential-supply path that avoids reading `.env` or credential material. The exact PowerShell `psql` invocation and SELECT-only metadata queries are in `docs/COLLEGE_REGISTRATION_MIGRATION_PLAN.md` for the owner to run locally with a hidden prompt.
- **Frontend contract:** The page calls `POST /college-registration/applications`; fields align with `CollegeRegistrationCreate`. The component sets success state only after the API promise resolves and displays the returned application reference/status. A 503 remains a clear temporary-unavailable state; no success is fabricated.
- **PASS (backend isolated):** `ATTENDX_SKIP_DOTENV=1`, explicit synthetic `ATTENDX_TEST_SQLALCHEMY_URL=sqlite://`; diagnostic + migration static tests: 12 passed. Python AST: 3 files passed.
- **BLOCKED (backend API tests):** `tests.test_college_registration_isolated` cannot import Starlette `TestClient` because the installed Starlette requires unavailable `httpx2`. No package installed.
- **PASS (frontend retry):** `node --test --test-concurrency=1 tests/public-pages.test.mjs` outside the restricted process sandbox: 9 passed. Earlier sandbox run and direct Node script failed before assertions due Windows `spawn EPERM` from esbuild; this was environmental, and serial retry passed.
- **NOT TESTED:** PostgreSQL catalog, migration execution, real persistence, Super Admin pending listing against PostgreSQL, and browser UI.
- **Migrations:** Foundation v2, College profile/status history, then registration/review; account activation remains separate. All drafts are **DRAFT / NOT APPLIED**. No database writes or migration approval were performed.
