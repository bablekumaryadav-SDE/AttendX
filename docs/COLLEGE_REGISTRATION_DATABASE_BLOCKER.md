# College Registration Database Blocker — Source-Only Diagnosis

**Date:** 2026-11-10

**Status:** IMPLEMENTED, NOT FULLY TESTED

**Database state:** UNKNOWN. No `.env`, connection string, database, PostgreSQL process, credential, or DPAPI file was inspected or accessed.

## Finding

The existing frontend uses the implemented API contract: public submission posts to `POST /college-registration/applications`; Super Admin review calls `GET /platform/college-applications?status=&q=`, `GET /platform/college-applications/{id}`, `GET .../{id}/history`, and the registered review action routes. The routers are included by `backend/app/main.py`. The platform routes use the database-backed `get_current_super_admin`; a legacy `admin` role is not sufficient.

`GET /platform/college-applications` queries `CollegeRegistrationApplication` and returns its sanitized list schema. Detail reads that model; history reads `CollegeRegistrationReview`. Submission first queries `User.email`, then inserts a pending application. These handlers do not check schema before querying. Their `SQLAlchemyError` path logs safe metadata and returns HTTP 503 with `College application service is unavailable.` The frontend now explains that the review service is temporarily unavailable, advises retry, and suggests an administrator check service/schema status. It never displays an application as successful unless a successful response arrives.

The exact historical runtime cause cannot be established under the no-database-access constraint. Missing application/review tables or columns are plausible because their SQL remains DRAFT / NOT APPLIED; connection failures and other SQLAlchemy failures can produce the same public 503. A 401/403 is a distinct authorization result, and an incorrect route would normally produce a routing error rather than this handler-generated 503. No live diagnosis is claimed.

Safe diagnostic logs now distinguish missing tables, missing columns, missing schemas, database connection failures, integrity failures, and other operation failures. They record only the classification, exception class, SQLSTATE and constraint metadata. They do not record exception text, SQL, query parameters, submitted fields, passwords, tokens, or tracking-token digests. Missing-table and missing-column tests verify the same sanitized public 503 and their distinct internal categories.

## Migration inventory and prerequisites

The repository contains standalone dated SQL files; no Alembic configuration, revision graph, or central migration ledger was found. The files do not provide revision IDs. A filename's presence does not establish whether it has been applied. Relevant files explicitly marked DRAFT / NOT APPLIED are:

| Draft | Requires / provides | Compatibility and safety limits |
|---|---|---|
| `DRAFT_20261105_add_tenant_foundation_postgresql_v2.sql` | Requires an existing `public.users(id INTEGER NOT NULL PRIMARY KEY)`; creates `public.colleges` and `public.college_memberships`. | Does not create `users` or legacy business tables. `CREATE TABLE` assumes target names are absent; partial preexisting tenant schema is not reconciled. No rows are inserted or backfilled. |
| `DRAFT_20261109_add_tenant_ownership_v1.sql` | Requires the tenant foundation and compatible legacy business tables; adds nullable ownership and composite same-College constraints. | Not a fresh empty-schema migration. It refuses preexisting `college_id` columns. Existing records remain NULL/UNKNOWN; no ownership backfill. |
| `DRAFT_20261110_add_college_status_history.sql` | Adds nullable College profile fields and `college_status_history`. | Its prerequisite was corrected to tenant foundation only, allowing it to precede application approval. `ADD COLUMN IF NOT EXISTS` does not validate an already-present column's type; history-table creation is not rerunnable. No legacy profile values are inferred. |
| `DRAFT_20261110_add_college_registration_workflow.sql` | Requires compatible `users`, `colleges`, and `college_memberships`; creates application and review tables, status checks, partial unique indexes and references. | Does not validate every existing prerequisite column/constraint. New table-name collisions or partial prior setup require manual review. The commented rollback drops application/review data and is destructive. |
| `DRAFT_20261111_student_teacher_registration_academics.sql` | Requires the tenant ownership constraints and existing Students, Teachers, Classes, Subjects, Guardians and assignment tables. | Not usable on an empty database. Does not establish unknown ownership. Separate from public College application submission/review. |
| `DRAFT_20261112_account_activation_invitations.sql` | Requires tenant plus Student/Teacher registration schema; adds invitation storage and a membership key. | Separate activation workflow; not required for application submission/listing, but the approved College Admin remains inactive/pending until activation exists. |

The unprefixed `20261101`–`20261105` SQL scripts have no DRAFT marker in their filenames, but there is no source ledger confirming their application state. They assume legacy core tables. Their status is **UNKNOWN**, not APPLIED.

### Required safe rollout order (proposal only)

For a compatible existing schema: first verify the required legacy `users` shape and all foundation prerequisites; then tenant foundation v2; then the College profile/status-history draft; then the application/review workflow draft; then deploy/enable code that performs approval. Ownership and Student/Teacher/activation drafts have additional independent prerequisites and are not implied by this sequence. Every draft needs separate review and approval, an isolated-target backup, and PostgreSQL rehearsal. A fresh empty schema needs an independently designed core-schema installation path; these drafts do not create the legacy `users` or business tables. A partially initialized schema is **BLOCKED** until catalog comparison and a recovery design establish every table/column/constraint.

The profile/status-history draft previously required the application table even though it only depends on `users` and `colleges`; meanwhile the approval handler writes the profile fields and history table. That created an unnecessary ordering cycle and allowed the application list to work before approval's schema dependencies existed. The draft's preflight and dependency note were corrected so it can be installed after the tenant foundation and before the registration workflow. It remains DRAFT / NOT APPLIED.

## Persistence and review behavior verified synthetically

Using only dependency-overridden in-memory SQLite:

- Valid submission persists a pending application and returns a reference and one-time tracking token; only the token digest and administrator password hash are stored. No College or membership is created on submission.
- Status lookup requires both reference and token and returns only non-private status fields; invalid token and unknown reference are indistinguishable.
- Super Admin pending/approved/rejected filters, search by College/official email/admin email/reference, detail views, history, approval, rejection, repeat-decision protection and non-Super-Admin denial pass isolated API tests.
- Missing-table submission and missing-column platform-list tests return sanitized 503. Internal classification is verified without SQL or submitted data in logs.
- Mounted frontend tests verify loading, empty, unavailable, and success/error behavior. This is component-level DOM testing with mocked service calls, not a browser or live API test.

SQLite confirms application code behavior against the ORM-created synthetic schema only. It does not prove PostgreSQL syntax, migration compatibility, actual configured-database persistence, locks/concurrency, or production behavior.

## Other migration risks reviewed

- The notification composite FK draft uses `ON DELETE SET NULL` for `(student_id, college_id)`, which can clear both fields and lose tenant attribution. The design decision from Phase 14A.25 remains unresolved; do not freeze schema until reviewed.
- `StudentIdCounter` remains keyed globally by academic year. Whether Student identifiers should be global, College-scoped, or College-and-session-scoped remains a product/schema decision.
- NULL legacy ownership remains UNKNOWN. No College, membership, ownership backfill, or role promotion is introduced.
- SQL rollback sections that drop registration/history tables would destroy workflow/audit records. Rollback requires a separate reviewed data-preservation plan.

## Tests and limitations

Exact commands/results are recorded in `TEST_RESULTS.md`. Focused College registration and tenant registration tests pass on synthetic SQLite. Full backend tests still include legacy route assertions that conflict with default-deny and unrelated fixture/Windows filesystem failures. Frontend tests run serially. PostgreSQL parser/migration tests, database persistence, SMTP and browser E2E are NOT TESTED.

No migration was executed. Migration execution is required only if an authorized inspection later confirms that required schema objects are missing. Approval must identify the exact isolated target, migration order, backup/rollback plan, and expected schema effects; this report requests no such approval.
