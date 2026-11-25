# AttendX Read-only Database Inspection

**Date:** 2026-11-10
**Target approved by user:** `127.0.0.1:5432/attendx`, read-only identity and schema catalog inspection only.
**Outcome:** **BLOCKED before connection.** Automatic safety review rejected use of the application database module to obtain its URL because importing it can load `.env`. No database connection or SQL query was attempted.
**Database modification:** None. No backup, migration, row read, registration request, or schema change occurred.

## 1. Source tracing and user-supplied evidence

The logs supplied by the user report these outcomes: `POST /college-registration/applications` returned 422 once and 503 later; `GET /platform/college-applications?status=pending` and `GET /platform/colleges` returned 503. A registration-module diagnostic reports `ProgrammingError`, SQLSTATE `42P01`, category `schema_missing_table`.

SQLSTATE `42P01` confirms that a relation referenced by the corresponding database statement was undefined. The excerpt does not contain the relation name or a request correlation ID. It cannot identify the missing table or prove which of the listed requests produced that diagnostic. The 422 is a distinct validation response and does not explain the 503/42P01.

| Endpoint | Source query and ORM model | Expected relations / absent-table candidates | Relevant source migration |
|---|---|---|---|
| `POST /college-registration/applications` | `backend/app/api/college_registration.py:165-207`. Checks `User.id` using `User.email`, checks duplicate `CollegeRegistrationApplication`, then inserts/refreshes that application. | `public.users`; `public.college_registration_applications`. A missing column would ordinarily be a different SQLSTATE (`42703`). | Registration workflow draft creates the application table; tenant foundation v2 and a compatible `users` table are declared prerequisites. |
| `GET /platform/college-applications?status=pending` | `college_registration.py:263-284`. Super Admin dependency loads the database-backed `User`; handler selects full `CollegeRegistrationApplication` rows. | `public.users`; `public.college_registration_applications`. It does not query `college_registration_reviews`. | Registration workflow draft creates applications and review history. |
| `GET /platform/colleges` | `backend/app/api/platform_colleges.py:83-109`. Super Admin dependency loads `User`; handler selects full `College` entities, then full `CollegeRegistrationApplication` entities for listed Colleges. | `public.users`; `public.colleges`; `public.college_registration_applications`. Missing mapped columns are a separate undefined-column issue. | Tenant foundation v2 creates Colleges/memberships; status-history draft adds College profile columns; registration workflow draft creates application table. |
| `POST /college-registration/status` | `college_registration.py:238-260`; filters `CollegeRegistrationApplication` by reference and compares the token digest. | `public.college_registration_applications`. | Registration workflow draft. |
| Platform College detail/profile/status/history | `backend/app/api/platform_colleges.py`; reads College, application, membership/User and/or `CollegeStatusHistory`, depending on operation. | `public.colleges`, `public.college_registration_applications`, `public.college_memberships`, `public.users`, `public.college_status_history`. | Tenant foundation v2, College status-history draft, registration workflow draft. |

`backend/app/main.py:241-244` registers these routers without an added `/api` prefix. Source route paths align with the frontend service paths. The current source returns sanitized 503 responses and records safe failure metadata; it does not record the relation name in the shown diagnostic. No source or runtime change was made.

## 2. Expected schema and catalog checklist (source-derived, not live-verified)

The exact metadata scope for an approved inspection is:

| Relation | Expected columns to inspect (metadata only) | Constraints / indexes to inspect |
|---|---|---|
| `public.users` | `id`, `name`, `email`, `hashed_password`, `role`, `is_active`, `created_at` | `id` integer, not-null primary key; email type and uniqueness/index. Do not select column values. |
| `public.colleges` | `id`, `slug`, `official_name`, `display_name`, `college_type`, `address`, `city`, `state`, `postal_code`, `country`, `official_email`, `contact_number`, `website`, `status`, `created_at`, `updated_at` | Primary key; unique slug; slug/name/status checks; referenced FKs where present. |
| `public.college_memberships` | `id`, `user_id`, `college_id`, `role`, `status`, `created_by_user_id`, `activated_by_user_id`, `revoked_by_user_id`, `activated_at`, `revoked_at`, `status_reason`, `created_at`, `updated_at` | Primary key; unique `(user_id, college_id)`; role/status checks; user/College FKs; user/status and College/status indexes. This relation is a migration/approval prerequisite but is not queried by the three listed failing handler bodies. |
| `public.college_registration_applications` | `id`, `application_reference`, `tracking_token_digest`, `status`, `provisioning_status`, `college_name`, `college_type`, `address`, `city`, `state`, `postal_code`, `country`, `official_email`, `contact_number`, `website`, `admin_name`, `admin_email`, `admin_contact_number`, `admin_password_hash`, `submitted_at`, `reviewed_at`, `reviewed_by_user_id`, `review_reason`, `college_id`, `admin_user_id` | Primary key; unique application reference; partial unique active official/admin email indexes; status/provisioning checks; FKs to users/colleges; status/submitted index. |
| `public.college_registration_reviews` | `id`, `application_id`, `reviewer_user_id`, `decision`, `reason`, `created_at` | Primary key; application/User FKs; decision check; application/created index. Not queried by the failing list/submit paths. |
| `public.college_status_history` | `id`, `college_id`, `actor_user_id`, `action`, `previous_status`, `new_status`, `reason`, `created_at` | Primary key; College/User FKs; action/status checks; College/created index. Not queried by the three listed handler bodies. |
| `public.students`, `public.teachers`, `public.account_invitations` | Inspect relation presence, schemas, and columns/constraints only if catalog scope includes them; they are not referenced by the three failing request query paths above. | No row data or unnecessary counts. These relations are not candidate causes for those three handlers based on source tracing. |

The complete ORM definitions are in `backend/app/models.py` (`User` lines 190-198, `College` 201-255, `CollegeMembership` 257-290, registration application/review/history 323-420). Route and schema definitions are documented in `docs/COLLEGE_REGISTRATION_ERROR_FIX_REPORT.md`.

## 3. Migration source audit and dependency order

Source files reviewed:

- `database/migrations/DRAFT_20261105_add_tenant_foundation_postgresql.sql`
- `database/migrations/DRAFT_20261105_add_tenant_foundation_postgresql_v2.sql`
- `database/migrations/DRAFT_20261110_add_college_status_history.sql`
- `database/migrations/DRAFT_20261110_add_college_registration_workflow.sql`
- Related ownership, academic-registration, and account-activation draft filenames were inventoried; they do not create the listed registration application relation.

Source-proposed order for a compatible existing database is `public.users` prerequisite â†’ tenant foundation v2 â†’ College profile/status-history draft â†’ College registration workflow draft. Foundation v1 and v2 are alternatives, not sequential migrations. The tenant v2 preflight requires `public.users.id INTEGER NOT NULL PRIMARY KEY`; the registration workflow preflight requires users, colleges and memberships. The College status/history draft adds nullable College profile columns used by the full College ORM select.

The registration workflow draft creates `college_registration_applications` and `college_registration_reviews`; its manual rollback drops both tables and would remove their data. The status-history rollback removes its audit table. The foundation rollback drops tenant tables. All are marked `DRAFT / NOT APPLIED` in source, but those comments and filenames do not establish actual database migration state. No SQL parser or migration execution was run.

Repository source search found no Alembic setup or established central migration ledger. This is a repository finding, not a live-database finding. If approved catalog inspection finds a migration ledger, inspect its metadata and status values only; otherwise report no ledger in that database.

## 4. 422 validation response

Source inspection found the form fields aligned with `CollegeRegistrationCreate`, including `admin_contact_number`; blank website is sent as `null`; the schema requires `+` international phone format after removing spaces, parentheses, and hyphens; password strength and confirmation are checked. The provided log omits the sanitized 422 `detail`, so the failed field and validation rule are **UNKNOWN**. No frontend/backend mismatch is established and no validation change was made. The sanitized validation response's field locations/messages, with no submitted values, would identify that separate failure.

## 5. Connection attempt and blocker

- **User authorization:** Explicitly grants read-only identity/catalog inspection of exactly `127.0.0.1:5432/attendx`; does not authorize backups, migrations, or writes.
- **Tool discovery:** `psql` and `pg_isready` were not found on PATH.
- **Attempt:** The proposed read-only command would load the application database URL through `backend/app/database.py`, verify the parsed target before connecting, force PostgreSQL default read-only mode, issue `BEGIN READ ONLY`, inspect identity/catalog metadata, and `ROLLBACK`.
- **Auto-review result:** **REJECTED before command execution.** The reviewer stated that importing the database module may load `.env` and access credentials despite the secret-access restriction, so credential supply was not authorized. No environment file was opened or displayed; no connection was attempted; no SQL ran.
- **Identity:** Host, port, database, server version, role, schema/search path: **NOT TESTED**.
- **Actual relations, columns, constraints, indexes, migration history:** **NOT TESTED**.
- **Database changes:** None.

The approved schema inspection cannot continue until a safe credential-supply method is authorized that does not load or inspect `.env` and does not expose credentials in chat, commands, logs, or reports. The automatic rejection is the blocker for this turn; no alternative path was used.

## 6. Proposed correction plan (not approved or executed)

1. After safe credential supply is resolved, repeat the exact identity check for database `attendx`, server address `127.0.0.1`, port `5432`, and record version/current user/current schema/search path. Stop if any mismatch.
2. In one read-only transaction, inspect `to_regclass`, information-schema columns, `pg_constraint`, `pg_indexes`, relevant non-system schemas, and any established migration-ledger status. No application data rows or counts.
3. Identify the relation named by the actual catalog state and map it to the endpoint query above. Distinguish absent relation, relation in another schema, search-path issue, missing column, and incompatible constraint.
4. Prepare a migration plan only if source and live schema comparison demonstrates the exact missing object. For an absent tenant/registration schema, review prerequisites and actual legacy compatibility before proposing the foundation v2, status-history, and registration drafts in dependency order. Existing schema must not be overwritten or treated as empty.
5. A separate exact approval is required for backup creation and another explicit approval for any migration. A later synthetic registration write and persistence/status test also requires separate approval.

No fix can be claimed until an approved real registration persists and the Super Admin application listing can retrieve it. Current status remains **BLOCKED / NOT VERIFIED**.
