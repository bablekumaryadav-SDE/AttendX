# Student, Teacher and Account Activation Migration Review

**Date:** 2026-11-10
**Status:** STATIC REVIEW COMPLETE; PostgreSQL catalog comparison NOT TESTED; both new migrations remain DRAFT / NOT APPLIED.

## Scope and safety

Reviewed `DRAFT_20261111_student_teacher_registration_academics.sql`, `DRAFT_20261112_account_activation_invitations.sql`, the SQLAlchemy metadata in `backend/app/models.py`, registration/activation handlers and existing migration drafts. No PostgreSQL connection, SQL execution, migration, `.env` read, SMTP connection, or live data inspection was performed. The live local PostgreSQL schema therefore remains UNKNOWN.

## Migration findings

### `DRAFT_20261111_student_teacher_registration_academics.sql`

- Requires `public.users`, Colleges, memberships, Students, Teachers, Classes, Subjects, `student_guardians`, `teacher_assignments`, and `student_class_assignments`, plus the composite `students(id, college_id)` and `classes(id, college_id)` unique keys from the tenant-ownership migration.
- The preflight now verifies `users.id` is `INTEGER NOT NULL PRIMARY KEY`, assignment ownership columns exist, and expected same-College assignment FK names exist. These are source-level checks only; live PostgreSQL preflight has not run.
- Adds nullable Student/Teacher profile fields, relaxes legacy guardian name/mobile nullability, and creates `student_academic_history` with same-College Student/Class composite FKs. It inserts no business or ownership data.
- Enrollment number receives a partial unique index for non-NULL values. ORM `Student.enrollment_number` is globally unique, which is stricter than per-College uniqueness and can reject the same enrollment number in two Colleges. Resolving that semantic difference needs a separate data/constraint decision before schema freeze.
- ORM Teacher `employee_id` is also globally unique. The implementation is stricter than per-College uniqueness; existing uniqueness behavior is preserved pending explicit schema decision.
- Migration statements are not rerunnable (`ADD COLUMN`/constraints/index/table have no general `IF NOT EXISTS`). Treat it as a single controlled migration, with an external migration ledger/checklist and a clean preflight; do not retry after an ambiguous partial result.
- The SQL draft has a manual downgrade note only. Dropping profile columns/history would destroy entered data. Do not use a destructive downgrade; use a verified pre-migration backup and a separately reviewed forward repair or isolated restore.

### `DRAFT_20261112_account_activation_invitations.sql`

- Adds a composite unique key on `(college_memberships.id, user_id, college_id)` and an `account_invitations` table. ORM and SQL both relate each invitation to the exact membership/user/College triple.
- Stores a unique SHA-256 token digest, expiry, consumed/revoked timestamps, delivery state, sender and creation time. The token itself is never a column.
- Uses restrictive membership/College/user references; creator reference uses `ON DELETE SET NULL`. It contains no seed/update/delete statements.
- The draft assumes prior tenant foundation, ownership and Student/Teacher tables and assumes the role lifecycle has `pending` state. It must follow those prerequisites. It is also non-rerunnable and has no automatic downgrade because dropping it destroys invitation/audit state and removing its composite key would break the FK.
- ORM/migration parity is currently a static source check. PostgreSQL parser, catalog parity, lock behavior, FK creation, transaction rollback and concurrency behavior are NOT TESTED.

## Proposed local-development rehearsal plan (not approval to execute)

1. Obtain a separate explicit authorization and verify an isolated local target identity with a fresh, uncompromised credential. Do not use a production/application database or the existing C: service.
2. Record PostgreSQL version, address/port, cluster data directory/system identifier, database name/owner and current schema. Stop if identity or privilege checks are ambiguous.
3. Create and verify a restorable custom-format backup outside the repository. Confirm target schema matches the prerequisites below; record a checksum. Never overwrite the existing source database.
4. Rehearse on a separate disposable database or restored copy. Required baseline includes `users(id INTEGER NOT NULL PRIMARY KEY)` and compatible legacy Students, Teachers, Classes, Subjects, TeacherAssignments, StudentClassAssignments and StudentGuardians tables, with the listed columns and named composite constraints.
5. Apply only in dependency order: core legacy baseline/guardian schema; tenant foundation; college registration/status-history drafts if part of the selected product schema; tenant ownership; student/teacher academics; account invitations. The 11/11 registration migration must follow tenant ownership and guardians. The 11/12 activation migration follows the registration migration.
6. After each migration, inspect catalog columns, primary/unique/FK/index definitions, check constraints, nullable fields, `ON DELETE`, and row counts. Verify no College, membership, Student, Teacher, role, or ownership backfill was introduced. Run synthetic registration, invitation, activation, login and cross-College checks against that disposable database only.
7. On failure, stop. Preserve logs without secrets. If the transaction rolled back and the pre-migration schema is verified, diagnose before any retry. For ambiguous/partial state, do not rerun or drop objects; restore the separate rehearsal copy or use an approved forward correction.
8. Keep production migration blocked until independent ownership decisions, uniqueness scope, data compatibility, backup/restore, rollback and operational approvals are complete.

## Schema compatibility limits

The project has standalone SQL scripts rather than an identified central Alembic revision ledger. The empty Phase 13B `users` fixture is not a complete legacy schema. Historical database state cannot be inferred from ORM metadata or SQLite. No statement in this report establishes that the current PostgreSQL database has the required tables or constraints.

## Outcome

- Draft migration ordering and dependency shape: **PASS (static source review only)**.
- Live schema compatibility and PostgreSQL syntax/execution: **NOT TESTED**.
- Rollback: **manual recovery plan only; destructive downgrade not authorized**.
- Migration execution: **NOT APPLIED**.
- Local database workflow verification: **BLOCKED pending separate review/approval and a verified uncompromised login**.
