# AttendX Database Migration Precheck â€” Source-Only

**Date:** 2026-11-10
**Database target named by the project prompt:** `127.0.0.1:5432/attendx`
**Target accessed:** NO. Its identity and migration state are UNKNOWN. No backup, SQL, PostgreSQL connection, or migration execution occurred.

## Migration file inventory

The repository contains standalone SQL scripts. No Alembic configuration, revision ledger, or revision IDs were found. A file's presence or a `DRAFT / NOT APPLIED` source marker is not evidence of live catalog state. The unprefixed scripts below have no explicit draft status, so their applied state is **UNKNOWN**.

**Important:** `DRAFT_20261105_add_tenant_foundation_postgresql_v2.sql` describes itself as a static-hardening revision of the first foundation draft. Both define the same College/membership tables; they are alternatives, not sequential migrations. Do not apply both. The v2 draft is the reviewed candidate in the proposed order, still subject to exact-target rehearsal and approval.

| File | Source status | Dependencies / effects | Main compatibility, rollback, or data risks |
|---|---|---|---|
| `20261101_add_session_face_attendance.sql` | No DRAFT marker; runtime status UNKNOWN | Adds legacy session/face attendance structures/columns against existing business tables. | Assumes prior tables; exact deployed state not recorded in a central ledger. |
| `20261101_allow_session_close_method.sql` | No DRAFT marker; runtime status UNKNOWN | Changes the attendance-event method constraint for session-close absence finalization. | Requires the expected prior constraint/schema. |
| `20261103_add_notification_events_postgresql.sql` | No DRAFT marker; runtime status UNKNOWN | Creates PostgreSQL notification event structures and indexes using existing users/students. | Depends on compatible legacy tables; companion SQLite script is not PostgreSQL validation. |
| `20261103_add_notification_events_sqlite.sql` | No DRAFT marker; runtime status UNKNOWN | SQLite companion for notification event schema. | Not evidence of PostgreSQL deployment. |
| `20261104_add_classroom_gis_location_postgresql.sql` | No DRAFT marker; runtime status UNKNOWN | Adds nullable class/attendance location configuration. | Assumes existing class/attendance tables and expected schema. |
| `20261105_add_student_guardians_postgresql.sql` | No DRAFT marker; runtime status UNKNOWN | Adds guardian-contact schema for existing students. | Assumes existing students/users schema. |
| `DRAFT_20261105_add_tenant_foundation_postgresql.sql` | DRAFT / NOT APPLIED marker | Creates tenant colleges and memberships, referencing `users`. | First-version draft; requires compatible existing user table. No fresh core schema. |
| `DRAFT_20261105_add_tenant_foundation_postgresql_v2.sql` | DRAFT / NOT APPLIED marker | Validates `public.users(id INTEGER NOT NULL PRIMARY KEY)`, then creates colleges and memberships. | Does not create users or legacy business tables; `CREATE TABLE` requires expected names to be absent. Partial preexisting schema needs manual reconciliation. |
| `DRAFT_20261109_add_tenant_ownership_v1.sql` | DRAFT / NOT APPLIED / not PostgreSQL-validated marker | Adds nullable `college_id`, composite same-College keys/FKs and indexes across existing business tables. | Requires foundation and compatible existing tables/columns; does not support an empty application schema; refuses existing ownership columns. NULL stays UNKNOWN. Notification deletion semantics remain unresolved. |
| `DRAFT_20261110_add_college_status_history.sql` | DRAFT / NOT APPLIED marker | Adds nullable College profile columns and `college_status_history`. | Corrected source prerequisite: only tenant `users` and `colleges`; proposed before registration approval is enabled. `IF NOT EXISTS` does not validate an existing column's type; history creation is not rerunnable. Commented rollback drops history data. |
| `DRAFT_20261110_add_college_registration_workflow.sql` | DRAFT / NOT APPLIED marker | Creates application and review tables, constraints, partial unique indexes and references to users/colleges. | Requires compatible tenant foundation. Does not verify every parent column shape. Manual rollback drops application/review data. PostgreSQL concurrency/row-lock behavior untested. |
| `DRAFT_20261111_student_teacher_registration_academics.sql` | DRAFT / NOT APPLIED marker | Adds student/teacher profile fields and academic history; current enrollment index is College-scoped. | Requires existing legacy business/guardian/assignment schema and tenant ownership keys; not an empty-schema migration. |
| `DRAFT_20261112_account_activation_invitations.sql` | DRAFT / NOT APPLIED marker | Adds invitation table and a composite membership key. | Depends on tenant plus Student/Teacher registration schema; activation still requires separate security and SMTP validation. |

## Registration API schema contract

The registered public routes are `POST /college-registration/applications` and `POST /college-registration/status`. Submission looks up `users.email`, then inserts `college_registration_applications`; status lookup reads the application reference, tracking-token digest, status, submission and review timestamps. The raw tracking token is returned only in the successful submission response; only its digest is persisted.

The Super Admin routes are `GET /platform/college-applications` with optional `status`/`q`, `GET /{application_id}`, `GET /{application_id}/history`, and POST `/{application_id}/start-review`, `/approve`, `/reject`. `get_current_super_admin` validates the database-backed global role. The list/detail operations use the application table; history uses the review table. Approval additionally writes a College, College status-history row, inactive User, pending CollegeMembership, application decision and review event in one SQLAlchemy transaction. Approval therefore requires the College profile columns and `college_status_history` table as well as tenant base and registration tables.

Application errors are intentionally sanitized to HTTP 503. Safe diagnostic logs now classify missing table/column/schema, connection, integrity and other database operation failures without printing SQL, submitted values or credentials. No exception text or query parameters are logged.

## Proposed order, only after separate approval

For a verified compatible existing local schema, proposed core registration order is:

1. Verify exact server, database, schema, process/listener and compatible `users(id INTEGER NOT NULL PRIMARY KEY)` plus required existing base tables.
2. Review and, only if absent/compatible, apply tenant foundation v2.
3. Apply College profile/status-history draft so ORM reads and approval writes match the College model.
4. Apply College registration workflow draft.
5. Deploy/enable registration and review code; then verify submission/list/status/details/review using synthetic records and explicit authorization.
6. Treat tenant ownership, Student/Teacher academic registration and account-activation drafts as separate dependent work with their own preflight, backup and approval. They are not implicitly applied by College registration.

This order is a source-level proposal, not a claim that the target database currently lacks those tables or that any migration should be run. A fresh empty database is unsupported by these drafts because they assume the legacy users/business tables. A partial schema is blocked pending read-only catalog comparison and a reviewed reconciliation plan.

## Data, rollback, and safety notes

- Draft migrations do not establish any legacy College ownership; NULL ownership remains UNKNOWN.
- Foundation and registration drafts create schema objects but can fail on name collisions/partial setup. They are not generally rerunnable.
- Registration/status migrations use explicit transactions in PostgreSQL source; actual lock duration and behavior are untested.
- Commented rollback SQL that drops registration/review or status-history tables destroys records. No automatic rollback is proposed. Any rollback requires a verified backup and a separate data-retention decision.
- Tenant ownership notification FK uses composite `ON DELETE SET NULL`, which can clear College attribution; resolve before schema freeze.
- `StudentIdCounter` is currently global by year; choose College/session semantics before enabling new tenant Student ID generation.
- Teacher Employee ID remains globally unique pending deployed-schema and historical-data compatibility review. Student enrollment number is College-scoped in ORM/draft only; PostgreSQL behavior is NOT TESTED.

## Approval boundary

No approval for live database access, backup or migration was supplied by this prompt; it explicitly withholds it. Before any database action, obtain separate explicit approval identifying the exact target operation and backup destination. The preflight/backup/migration plan must be presented before execution. Nothing in this document authorizes a connection or migration.
