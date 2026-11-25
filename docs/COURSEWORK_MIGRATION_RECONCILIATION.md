# Coursework Migration Preparation and Live-Schema Reconciliation

**Status:** PREPARATION ONLY — no coursework migration applied. The 2026-11-14 live preflight reported **READY FOR MIGRATION DESIGN**, which does not authorize migration application.

## Scope and safety

The preflight connected through the existing application configuration to PostgreSQL 18.6 at loopback, database `attendx`, user `postgres`, schema `public`, search path `"$user", public`. It set `transaction_read_only = on` before catalog inspection and aggregate `SELECT`s, then rolled back. No database writes, schema operations, or migration stamping occurred. No credentials or personal records were reported.

The current branch is `main`. Before this task's edits the worktree had 66 tracked modifications, no staged paths, and 13,894 untracked paths. Most untracked paths were under the existing `backup-before-changes-20261026-151033` tree (13,153 paths); Git also reported access-denied temporary directories. This preparation added eight untracked files and edited one already-modified tracked route file. No pre-existing work was staged, removed, or replaced.

## Migration-history reconciliation

No conventional migration ledger table was found, including `alembic_version`; this is an **absent ledger**, not an empty ledger. Thus no applied revision values, multiple heads, or source-to-live revision match can be asserted. No `alembic.ini`, Alembic environment, or revision package was found. The migration directory is a collection of manually named SQL scripts and drafts, including tenant foundation v1/v2 alternatives, tenant ownership, College registration/status history, student/teacher academics, and account activation. Their presence is not evidence that they were applied.

### Source/live conflict map

- `DRAFT_20261105_add_tenant_foundation_postgresql_v2.sql` creates `public.colleges` and `public.college_memberships` without `IF NOT EXISTS`; both relations and their key structures already exist live. It must not be run against this database.
- `DRAFT_20261110_add_college_status_history.sql` has nullable College profile `ADD COLUMN IF NOT EXISTS` operations, but also unconditional `CREATE TABLE public.college_status_history`; that table already exists live. The draft is not safe to rerun here.
- `DRAFT_20261110_add_college_registration_workflow.sql` unconditionally creates registration application/review tables; both already exist live. Do not run it against this database.
- `20261111_college_registration_schema_idempotent.sql` uses `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and `ADD COLUMN IF NOT EXISTS` for portions of that schema. The live catalog contains its target registration/history objects, but without a ledger or source checksum it is impossible to attribute them to this exact file or prove that rerunning it is harmless on every object; do not rerun it as a substitute for reconciliation.
- `DRAFT_20261111_student_teacher_registration_academics.sql` has unconditional `ALTER TABLE ... ADD COLUMN` and unique-index/table creation for structures already present live, including Student academic columns and `student_academic_history`; it would conflict if run against the current schema.
- Tenant ownership and other old drafts are not migration history. Several corresponding ownership columns, composite keys, and `NOT VALID` FKs already exist live. Do not rerun a draft or foundation alternative to “complete” history.
- The 2026-11-14 Coursework drafts are new, clearly labeled, and not present in any database ledger (there is no ledger). They are not applied.

### Baseline/adoption strategy

1. Keep the current SQL files as historical source artifacts; do not rerun them merely because the ledger is absent.
2. Before introducing a migration tool, produce a reviewed catalog snapshot and compare each live relation, constraint, index, trigger, sequence, and function with every proposed revision.
3. Choose one migration owner: either a new controlled SQL revision ledger or an adopted Alembic baseline. Do not use both as competing authorities.
4. Establish any baseline only after explicit review of the live-vs-source diff. A baseline/stamp operation changes migration metadata and needs separate approval; it was not performed here.
5. Record future revisions in a single ordered chain, with immutable revision identifiers, dependency declarations, checksums/source review, and an application log. Any failed transaction must be diagnosed and forward-repaired; do not blindly rerun a partially applied script.

## Live prerequisites

All required tenant foundation relations were present: `students`, `teacher_assignments`, `college_memberships`, `colleges`, `users`, and `student_class_assignments`. Referenced `classes`, `teachers`, and `subjects` were also present. Relevant identifiers and College IDs are PostgreSQL `INTEGER` (`int4`).

The required unique targets exist:

| Target key | Live constraint |
|---|---|
| `students(id, college_id)` | `uq_students_id_college` |
| `teacher_assignments(id, college_id)` | `uq_teacher_assignments_id_college` |
| `college_memberships(user_id, college_id)` | `uq_college_memberships_user_college` |
| `college_memberships(id, user_id, college_id)` | `uq_college_memberships_id_user_college` |
| `coursework_assignments(id, college_id)` | Prepared by revision 02 |
| `coursework_submissions(id, college_id)` | Prepared by revision 03 |

### Existing relevant rules

- `students`: PK `(id)`; unique `(id, college_id)`; College FK is `ON DELETE RESTRICT NOT VALID`; email and student code are unique, with partial College enrollment/roll-number indexes.
- `teacher_assignments`: PK `(id)`; unique `(id, college_id)`; College, teacher, class, and subject ownership FKs exist. Its composite teacher/class/subject FKs are `NOT VALID`.
- `college_memberships`: PK `(id)`; unique `(user_id, college_id)` and `(id, user_id, college_id)`; user and College FKs are RESTRICT; actor fields reference users with `SET NULL`.
- `student_class_assignments`: PK `(id)`; unique `(id, college_id)`; single-column and composite student/class FKs exist; active enrollment has a partial unique index on `student_id`.
- `users`: PK `(id)` and unique email index. No `students.user_id` exists.
- The live catalog showed no coursework, submission, or Student-account-link table.

## NOT VALID constraints and validation plan

The following same-College FKs are live but `convalidated = false`:

- `fk_teacher_assignments_teacher_college`
- `fk_teacher_assignments_class_college`
- `fk_teacher_assignments_subject_college`
- `fk_student_class_assignments_student_college`
- `fk_student_class_assignments_class_college`
- `fk_students_college` is also marked `NOT VALID`.

The preflight found zero non-NULL College mismatches in checked Student/Teacher assignment-parent relationships. It also found zero orphans in checked simple Student, Teacher, class, subject, user, and College references. Those counts do not change the catalog fact that the composite constraints remain unvalidated, and they do not prove a future validation will pass after data changes.

Before any future validation, run separately reviewed read-only counts for: missing parent rows; each composite key with unequal College IDs; NULL ownership; and duplicate target keys. Resolve exceptions only through an approved row-specific ownership/data plan. Validate parent keys before child keys, in dependency order: Colleges/Students/Classes/Teachers/Subjects, then TeacherAssignments and StudentClassAssignments. Issue `VALIDATE CONSTRAINT` only after a separate approval and rehearsal; it was not run here.

## Data risks and policy

- NULL College ownership counts: **23 students**, **5 teacher assignments**, **5 student-class assignments**. Keep these records UNKNOWN and outside coursework authorization. Never backfill by name, email, roll number, class, or teacher association.
- One duplicate `(student_id, class_id, college_id)` group exists in `student_class_assignments`, involving two rows. There is no current unique index on that complete tuple; adding one would conflict with those two existing rows. The separate partial unique index `uq_student_class_one_active` is on `student_id` where `is_active = true`, so the duplicate group does not establish which row is active. Do not infer, delete, or merge either row. The existing single-active-class rule also requires an explicit decision if multi-class enrollment is intended.
- Checked simple relationship orphan counts were zero. Checked same-College mismatches among rows with known ownership were zero.
- Student account linking must be explicit and verified. The live schema has no `students.user_id`; do not associate accounts using personal-field matching. A link must not grant access by itself: each request must also check active user, active student membership, active verified link, and current active enrollment.

### Manual ownership-resolution plan (not executed)

For any future ownership attribution, a College must submit a row-specific roster/evidence mapping through a separately authorized review. An authorized reviewer records the source evidence, target College, affected primary keys, and rationale; a second reviewer checks the mapping against official records. The owner must approve the exact rows before any targeted update. Preserve the before/after mapping in an approved audit record, then verify FK/orphan and cross-College counts before validating constraints. NULL rows remain excluded until this process completes. The current schema has no reviewed legacy-ownership audit workflow, so designing/approving that recordkeeping mechanism is a prerequisite; no ownership values were read or changed in this task.

## Prepared migration revisions

These are independent draft SQL files, not an Alembic chain and not applied. Each uses an explicit transaction and fails if target objects already exist, so a partial/manual prior application requires reconciliation instead of blind rerun.

| Order | File | Creates | Depends on |
|---|---|---|---|
| 1 | `database/migrations/DRAFT_20261114_01_student_account_links.sql` | `student_account_links`, verified/revoked state, College composite FKs, partial active-link uniqueness | Live students/memberships/users and their catalog keys |
| 2 | `database/migrations/DRAFT_20261114_02_coursework_assignments.sql` | `coursework_assignments`, creator-membership and TeacherAssignment composite FKs, status/deadline/marks checks | Revision 1 and live College membership/TeacherAssignment keys |
| 3 | `database/migrations/DRAFT_20261114_03_coursework_submissions.sql` | One logical submission per assignment/Student/College | Revisions 1–2 and live Student composite key |
| 4 | `database/migrations/DRAFT_20261114_04_coursework_submission_revisions.sql` | Append-only revisions, revision/idempotency uniqueness, server timestamp/late trigger | Revision 3 |
| 5 | `database/migrations/DRAFT_20261114_05_coursework_assignment_audit_events.sql` | Publish/deadline/archive audit events, audit append-only trigger, assignment mutation/deletion guard | Revision 2 |

The revision graph is `01 → 02 → 03 → 04`, with `02 → 05`. Execute only in a future reviewed deployment order. A failed DDL transaction should be rolled back by PostgreSQL; inspect resulting catalog state before preparing a forward repair. Do not drop objects to force a retry. These drafts intentionally create no default College, link, assignment, submission, or ownership data. They do not create/recreate the live tenant foundation or its composite unique keys.

## Append-only and concurrency guarantees

Revision 04's trigger assigns `submitted_at` and `is_late` from the published assignment deadline at insertion and rejects ordinary UPDATE/DELETE attempts. Revision 05 rejects audit UPDATE/DELETE and prevents published content/mapping changes or published/archived physical deletion. Trigger protections are not absolute against a database owner/superuser able to disable triggers; production custody must use a least-privilege application role that does not own these objects.

The service must create the logical submission with a unique `(coursework_assignment_id, student_id, college_id)` key, then insert the revision in one transaction. Serialize competing first submissions using the logical submission row/unique conflict path; do not retry an ambiguous committed write blindly. On idempotency collision, fetch the existing revision and compare content internally: identical returns that revision; different content returns HTTP 409. This service behavior is not implemented or tested yet.

## Backend and API status

No coursework ORM models, schemas, authorization services, endpoints, or backend tests were added. The existing `/assignments` router operates on `TeacherAssignment` (teacher/class/subject mapping), not student coursework, and is mounted behind `block_unscoped_legacy_business_api` with OpenAPI exclusion. It remains unchanged and blocked.

Future endpoints must use authenticated selected College context and active membership on every request. College Admin manages only the selected College; Teachers access only coursework through their own active TeacherAssignment; Students require active account, student membership, explicit verified account link, and active enrollment; Super Admin has no implicit coursework access. Foreign identifiers should use sanitized 404s. Legacy `/assignments` must remain default-denied.

No coursework backend route is exposed by this preparation. This avoids importing incomplete ORM metadata into existing application startup or making the feature reachable before schema review/application.

### Proposed API surface for a later backend phase

These are design targets, not registered endpoints:

| Target | Required authorization / behavior |
|---|---|
| `GET /tenant/coursework/assignments` | Active selected-College membership; role-filtered visible assignments; no NULL ownership |
| `POST /tenant/coursework/assignments` | College Admin only; active same-College TeacherAssignment; creator membership is server-derived |
| `GET /tenant/coursework/assignments/{id}` | College context checked on every request; sanitized 404 for foreign IDs |
| `PATCH /tenant/coursework/assignments/{id}` | College Admin; draft-only content/mapping edits |
| `POST /tenant/coursework/assignments/{id}/publish` | College Admin; event and transition in one transaction |
| `POST /tenant/coursework/assignments/{id}/deadline-extension` | College Admin; strictly later due date, non-empty reason, append audit event and update atomically |
| `POST /tenant/coursework/assignments/{id}/archive` | College Admin; archive event and transition atomically; deny later submissions |
| `GET /tenant/coursework/assignments/{id}/submissions` | College Admin; Teacher only if authorized under the historical-access policy below |
| `POST /tenant/coursework/assignments/{id}/account-links` | College Admin in own College, with an approved identity-check procedure; no matching by personal fields |
| `POST /tenant/coursework/account-links/{id}/revoke` | College Admin in own College; one-way revocation with actor/time/reason |
| `POST /tenant/coursework/assignments/{id}/submissions` | Student only; active account, membership, explicit active link and active enrollment; server sets timestamps/late flag; idempotency rules below |
| `GET /tenant/coursework/submissions/{id}` | Student only for own submission; active identity link required; teacher/admin access separately scoped |

No legacy `/assignments` path is repurposed or enabled.

### Historical access policy proposal

- TeacherAssignment deactivation removes create/edit/publish/deadline-extension permissions immediately. A previously assigned Teacher may receive read-only access to historical coursework and submissions only while their account and College membership remain active and their identity is still verifiably tied to that historical Teacher profile. Reassignment to a different Teacher does not transfer historical access. The current account-to-Teacher identity binding must be confirmed before implementation.
- Student enrollment deactivation removes new-submission permission immediately. Keep read-only access to the Student's own historical submissions while the account, active Student membership, and verified Student link remain active. If those conditions fail, deny access.
- Student account-link revocation immediately denies that account all Student coursework access, including historical submissions. Existing rows remain preserved for College Admin and properly authorized staff.
- Archived assignments accept no new submissions. College Admins can view retained work in their College. A historically authorized Teacher can view it read-only; a Student can view only their own history while their current account/link/membership checks pass.
- These rules are proposed contract behavior. They do not grant implicit access based on a former role or a reused profile ID, and require a separate authorization test review.

### Link verification and service invariants

The link table records the College Admin verifier and server timestamp but deliberately stores no identity document or secret evidence payload. The accepted evidence types and retention policy remain a decision for the project owner; no link-creation UI/API is implemented until that policy is approved. A College Admin must verify through the approved process and create the link explicitly. Membership role/status, user active state, Student active state, verified active link, and active enrollment must all be checked at access time. Revocation is a one-way transition and link history cannot be deleted by ordinary application sessions.

### Transaction and lock order proposal

For submit/resubmit requests, use one transaction and one global lock order: (1) published assignment row `FOR SHARE`, (2) active verified account-link row `FOR SHARE`, (3) active StudentClassAssignment row `FOR SHARE`, (4) create or obtain the logical submission through its unique assignment/Student/College key, then lock that submission `FOR UPDATE`, (5) resolve idempotency key and append revision. Check membership and account state within the same transaction. Archive, link revocation, and enrollment deactivation update their respective rows and therefore wait for in-flight submissions holding shared locks; after their commit, new submissions fail. Every service path touching these rows must follow the same order to avoid deadlocks. This is a proposed service contract, not implemented or PostgreSQL-rehearsed.

The server assigns revision timestamps and late status after the assignment row is locked. Unique constraints serialize duplicate first submissions and idempotency collisions. An idempotency collision must compare stored content internally: equal content returns the existing revision; unequal content returns HTTP 409. Client timestamps and late flags are ignored.

## Required isolated backend test matrix

These are acceptance requirements for the later service/API implementation. They are not represented as passing merely because the SQL constraints are drafted.

1. College A Admin can manage College A drafts; College B Admin and Super Admin cannot read or mutate them.
2. Foreign assignment, submission, revision, and link identifiers return sanitized 404s.
3. Account linking requires explicit verified flow; email/name/roll/phone matches never create a link.
4. One active link per Student and one active Student profile per user/College are enforced; a user may be linked in another College.
5. Revoked links deny Student access immediately and preserve link/history rows.
6. Inactive user, inactive Student membership, suspended College, or inactive Student profile denies access.
7. Teacher sees only coursework attached to their own active TeacherAssignment; after deactivation, only the approved read-only historical policy may apply.
8. Student sees only own submissions and only after active verified link plus active enrollment checks.
9. Draft visibility/editing is limited to College Admin; publication creates an audit event atomically.
10. Published title/instructions/issued date/TeacherAssignment mapping/maximum marks cannot change; direct delete is rejected.
11. Deadline extension must be strictly later, include a reason, and produce previous/new values, actor, and server time atomically.
12. Archived coursework denies new submissions while retaining prior submissions/revisions.
13. Two concurrent first submissions produce one logical submission and no lost/duplicate revision.
14. Same idempotency key and same content returns the existing revision; same key and different content returns 409.
15. Revision timestamps and late flags ignore client input; revisions and audit events reject UPDATE/DELETE through normal app role.
16. NULL-owned legacy records remain inaccessible; legacy `/assignments` still returns default-deny and no new routes are registered before schema approval.

Use a disposable PostgreSQL database for composite-FK, trigger, locking, and concurrent transaction tests. SQLite and mocks can cover service validation but do not establish PostgreSQL compatibility.

## Rollback and forward recovery

Each new draft wraps its additive DDL in a transaction. A failure before commit should roll back that revision; inspect catalog state after an error rather than assuming every client/tool failure mode is atomic. Do not automatically drop a successfully created table or trigger. If a defect is found after commit, preserve links, coursework, submissions, revisions, and audit history and prepare a separately reviewed forward-fix revision. Destructive rollback is acceptable only before dependent data exists, after verified backup/restore rehearsal, and with separate approval. No rollback or recovery SQL was executed.

## Frontend status

`/admin/assignments` now displays an explicit Coursework Migration Required state. It explains that schema approval/application and Student account linking are pending, and that no assignments are available. The view is inert: it makes no API calls and exposes no creation, edit, publish, submission, or statistics controls. The route path and surrounding dashboard navigation remain unchanged.

## Separate approvals still required

1. Approve the migration-ledger/baseline ownership strategy and reconcile historical scripts to live schema.
2. Approve the identity-verification evidence and College Admin procedure for Student account links, including revocation and audit.
3. Approve the SQL review and disposable PostgreSQL rehearsal of these five drafts.
4. Approve production/local target backup and migration execution separately; no migration is authorized by this preparation.
5. After schema application, separately review and authorize backend API implementation, tests, and enablement.

## Verification performed

- Live PostgreSQL preflight was read-only; PostgreSQL compatibility beyond catalog/type/key inspection is not established.
- No coursework migration was executed or parsed by PostgreSQL.
- No PostgreSQL SQL parser is installed in the existing backend environment (`pglast` and `sqlglot` were absent); draft syntax received static review only.
- The focused frontend static test was attempted but Node's test runner failed with Windows `spawn EPERM` before executing any assertions.
- No database, backend, attendance, authentication, GPS, face, QR, or default-deny behavior was changed.

## Static remediation addendum — 2026-11-14

This addendum supersedes earlier statements in this document about the draft trigger guards and prerequisite checks. It records source changes only. The five scripts remain **DRAFT / NOT APPLIED**; no migration ledger was adopted, no SQL was run, and no database operation occurred.

### Revised dependency graph and preflight guarantees

The intended sequence remains `01 → 02 → 03 → 04`, with `02 → 05`. The scripts now fail closed when prerequisites are missing or incompatible; these checks inspect catalogs and validate schema prerequisites but do **not** prove that a specific draft filename/revision was applied.

| Draft | Prerequisites checked | Dependency detail |
|---|---|---|
| 01 Student account links | `students`, `college_memberships`, `users`; required `INTEGER NOT NULL` columns; exact ordered unique keys `(id,college_id)`, `(user_id,college_id)`, `(id,user_id,college_id)`; single-column primary keys | Target object/function collision checks remain fail-closed. |
| 02 Coursework assignments | Draft 01 link relation columns/types/nullability, link status/revocation checks, named active-link partial unique indexes and exact index key order; TeacherAssignment and College columns/keys; membership triple key | Draft 01 is an explicit sequencing prerequisite even though the assignment table has no direct account-link FK. |
| 03 Coursework submissions | Draft 01 link contract above; Draft 02 assignment columns, types, key order, and nullable archive timestamp; Student composite key | Rejects an existing/partial target table or guard function. |
| 04 Submission revisions | Draft 01 link contract above; Draft 02 assignment columns/keys; Draft 03 submission columns and `(id,college_id)` key | Requires the full dependency chain and checks trigger-function collision names. |
| 05 Assignment audit events | Draft 02 assignment columns/keys; membership triple key | Requires assignment/audit trigger objects to be absent before creation. |

The checks validate required PostgreSQL types by catalog type names and selected `format_type` typmods (including `VARCHAR(12)` and `VARCHAR(240)`), key column order through `pg_constraint.conkey`, `NOT NULL` for mandatory prerequisite columns, and nullable archive/revocation fields. They are reviewable preflight code, not execution evidence. They do not validate the migration ledger or prove historical application.

### Supporting indexes and guards

The drafts now include FK-side indexes in referencing-column order. Existing College-first indexes remain where they support distinct list-query patterns. Index names are recorded in `docs/COURSEWORK_SQL_DRAFT_REMEDIATION.md`. The user/College account-link FK is covered by the existing `(user_id,college_id,link_status)` prefix; no duplicate two-column index was added.

Statement-level `BEFORE TRUNCATE` guards are drafted for account-link history, coursework assignments, submission headers, submission revisions, and assignment audit events. Row triggers still implement record-level rules. These controls are only safeguards for ordinary sessions: owners/superusers and sufficiently privileged roles can disable or replace triggers or alter privileges. They are not tamper-proof audit storage. No roles or grants are created by these drafts.

### Submission header and concurrency rule

Draft 03 now rejects header INSERT unless its same-College assignment is currently `published` and not archived. The trigger locks that assignment `FOR SHARE` while checking state. It rejects all header UPDATE/DELETE operations, preserving the logical submission identity/history. Draft 04’s revision trigger also locks the published, non-archived assignment `FOR SHARE` before reading its due time and setting server-owned `submitted_at` and `is_late`.

These locks serialize header/revision insertion against assignment publication, deadline changes, and archival row updates. The service must retain the documented single global order: assignment `FOR SHARE` first, then account link, enrollment, logical submission, and revision/idempotency handling. All writers that touch those rows must follow that order. This locking design is still **NOT TESTED** against PostgreSQL concurrency; an isolated PostgreSQL rehearsal remains required before any endpoint is enabled.

### Recovery and privilege boundary

The previous forward-recovery policy remains: after any failed or ambiguous migration attempt, stop, inspect catalog objects and their definitions, compare them with the exact draft, and prepare a reviewed forward repair. Do not blindly rerun, stamp history, or drop objects. A failed transaction is expected to roll back its uncommitted DDL, but tool/process failures and any post-commit state must be reconciled from catalog evidence. Destructive post-commit rollback is not the default because it can destroy account-link, assignment, submission, revision, and audit history.

Before application, separately approve a migration-history adoption strategy and rehearse the exact ordered scripts on a disposable PostgreSQL copy. Verify complete object definitions and data/catalog state after each revision, including interrupted/partial-attempt scenarios. Require a verified backup and restore rehearsal for the approved target before deployment.

Proposed least-privilege design for separate review (not created here): use a controlled migration principal for DDL; make a dedicated non-login owner own schema objects; use a distinct runtime principal that is not a table owner, superuser, or schema owner and has no DDL, trigger-management, ownership, or `TRUNCATE` privilege. Grant only the per-table `SELECT`/`INSERT`/`UPDATE`/`DELETE` operations required by reviewed APIs, excluding destructive history mutations. Review sequence usage and function execution separately. Do not treat a role name or grant as already present; verify effective privileges in the rehearsal and target catalog before approving application.

The coursework UI remains the inert Migration Required state, the default-deny legacy gate remains unchanged, backend Coursework APIs remain absent, and migration approval remains **NOT GRANTED**.
