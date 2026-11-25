# Coursework SQL Draft Remediation

**Date:** 2026-11-14
**Scope:** Static-only remediation of five coursework SQL drafts and their reconciliation documentation.
**Overall status:** PARTIALLY REMEDIATED — FINDINGS REMAIN

## Executive summary

The five existing coursework scripts were amended to address the independent review findings: prerequisite checks now inspect required column types/nullability and ordered keys, later drafts check the earlier account-link contract, composite FK-side indexes were added in referencing-column order, statement-level `TRUNCATE` guards were added, and submission headers now require a published non-archived assignment under a row lock. The reconciliation document now records dependency, recovery, migration-history, concurrency, and least-privilege proposals.

The drafts remain **DRAFT / NOT APPLIED**. No PostgreSQL connection, SQL execution, migration, role/privilege change, API implementation, or endpoint activation occurred. A PostgreSQL-compatible SQL parser was not available, so syntax validation is **NOT TESTED**. PostgreSQL locking behavior and migration execution are also **NOT TESTED**.

## Repository state and preservation

- Repository: `C:\Users\Asus\OneDrive\Desktop\MainProject\AttendX`
- Branch: `main`
- Before editing, the worktree showed 66 modified tracked files, no staged files, and approximately 13,902 untracked paths. Git emitted permission-denied warnings while enumerating several pre-existing cache/temp directories.
- The five migration drafts and reconciliation document were already untracked before this task. They were edited in place as specifically authorized; unrelated modifications and untracked files were left untouched.
- Exact task files changed: the five SQL drafts, `docs/COURSEWORK_MIGRATION_RECONCILIATION.md`, and this report.

## Independent findings and disposition

| Finding | Remediation | Status / remaining limit |
|---|---|---|
| Row triggers alone did not guard `TRUNCATE`. | Added statement-level `BEFORE TRUNCATE` guards for account-link history (draft 01), assignment headers (draft 05), submissions (draft 03), revisions (draft 04), and audit events (draft 05). | Addressed for ordinary sessions. Owners/superusers or sufficiently privileged roles can bypass/alter triggers. Not tamper-proof. |
| Draft 02 declared draft 01 dependency without checking it. | Draft 02 preflight now checks the account-link table signature, primary key, status/revocation constraints, active partial unique indexes, and their ordered keys. | Addressed as schema prerequisite checking; does not prove migration history. |
| Draft 03 did not enforce draft 01 and draft 02 dependencies. | Draft 03 checks account-link contract, assignment required columns/type/status key, Student composite key, and nullable `archived_at`. | Addressed as catalog preflight only. |
| Draft 04 did not validate its full dependency chain. | Draft 04 checks account-link contract, assignment fields/status/nullable archive timestamp, and submission composite key before creating revisions. | Addressed as catalog preflight only. |
| Draft 05 preflight was incomplete for fields used by guards. | Draft 05 now checks assignment and membership column signatures, nullable lifecycle fields, status constraint, and exact ordered composite keys. | Addressed for listed prerequisites; review against the target catalog is still required before application. |
| Composite FK-side indexes were missing or had reversed/interleaved column order. | Added exact-order indexes listed below. Existing College-first indexes were retained where they serve list queries. | Static definition review only; query plan/performance not tested. |
| Submission headers could exist for draft assignments. | Draft 03 now locks the matching assignment `FOR SHARE` and only permits INSERT when status is published and archive time is null; headers reject UPDATE and DELETE. | Source design addresses the invariant. PostgreSQL syntax and concurrency behavior remain NOT TESTED. |
| Revision insert could race with deadline change/archive. | Draft 04’s trigger now selects the published, non-archived assignment `FOR SHARE` before using its due time. | Must be combined with the documented global lock order and tested under PostgreSQL. |
| Trigger protections could be mistaken for tamper-proof history. | SQL comments and reconciliation/report explicitly document owner/superuser bypass and the need for separately reviewed ownership/grants. Draft 05 also requires JSON object payloads and keeps College/creator/identity fields immutable during draft edits. | Database role/privilege changes are not authorized and were not made. |
| No safe post-commit rollback strategy was documented. | Reconciliation addendum specifies stop-and-inspect, forward recovery, disposable rehearsal, backup/restore rehearsal, and no blind reruns or destructive drops. | Operational procedure still requires owner approval and rehearsal. |

## Draft changes and important references

Line references below refer to the files as modified in this task.

### Draft 01 — Student account links

`database/migrations/DRAFT_20261114_01_student_account_links.sql`

- Prerequisite columns/types/nullability and exact ordered key checks: lines 12–71.
- FK support indexes: lines 106–117. `ix_student_account_links_user_college_status` supports the `(user_id,college_id)` FK prefix; dedicated indexes cover `(student_id,college_id)`, `(verified_by_user_id,college_id)`, and `(revoked_by_user_id,college_id)`.
- Row history guard and TRUNCATE guard: lines 119–163.
- Account linking remains explicit; there is no matching by email, name, roll, or phone and no link data is inserted by this migration.

### Draft 02 — Coursework assignments

`database/migrations/DRAFT_20261114_02_coursework_assignments.sql`

- Fails closed unless draft 01 account-link prerequisites and tenant keys are present: lines 11–101.
- FK support indexes: lines 144–147. Added `(teacher_assignment_id,college_id)` and `(created_by_membership_id,created_by_user_id,college_id)`.
- Draft 01 is a declared sequencing prerequisite but has no direct FK from coursework assignments; the preflight enforces sequencing/schema presence rather than creating an authorization relationship.

### Draft 03 — Logical coursework submissions

`database/migrations/DRAFT_20261114_03_coursework_submissions.sql`

- Checks account-link, assignment and Student prerequisites: lines 10–110.
- FK support indexes: lines 132–135. Added `(coursework_assignment_id,college_id)` and `(student_id,college_id)`; College-first listing indexes remain for their separate access patterns.
- Header-state guard locks a same-College assignment and requires `published` plus `archived_at IS NULL`; it rejects header UPDATE/DELETE: lines 137–180.
- A publication/archive updater must contend on the same assignment row. Under the documented service order, assignment is locked before link, enrollment, submission and revision. If a writer violates that order, deadlock risk is not ruled out.

### Draft 04 — Append-only submission revisions

`database/migrations/DRAFT_20261114_04_coursework_submission_revisions.sql`

- Checks the draft 01 → 02 → 03 chain and target key definitions: lines 10–113.
- FK support index `(coursework_submission_id,college_id)`: lines 135–136.
- Revision creation locks the published, non-archived assignment `FOR SHARE` before deriving due status and server timestamp: lines 138–160.
- UPDATE/DELETE and TRUNCATE guards: lines 162–185.
- Unique revision-number and idempotency constraints remain. Identical-key/content replay versus conflicting-content HTTP 409 still requires backend service logic and is not implemented here.

### Draft 05 — Assignment audit events and lifecycle guard

`database/migrations/DRAFT_20261114_05_coursework_assignment_audit_events.sql`

- Checks assignment/membership types, nullability and key order: lines 11–77.
- FK support indexes: lines 103–110. Added `(coursework_assignment_id,college_id)` and `(actor_membership_id,actor_user_id,college_id)`.
- Audit UPDATE/DELETE and TRUNCATE guards: lines 112–136.
- Assignment state/content/deadline guard and assignment TRUNCATE guard: lines 138–255.
- Actor FK proves membership association only; active membership, College Admin role, and account state remain backend authorization checks. Audit transition and event must be committed in one transaction by the future service.

## FK support index inventory

| Draft | FK referencing columns | Supporting index |
|---|---|---|
| 01 | `(student_id,college_id)` | `ix_student_account_links_student_college` |
| 01 | `(user_id,college_id)` | Prefix of `ix_student_account_links_user_college_status` |
| 01 | `(verified_by_user_id,college_id)` | `ix_student_account_links_verifier_membership` |
| 01 | `(revoked_by_user_id,college_id)` | `ix_student_account_links_revoker_membership` |
| 02 | `(teacher_assignment_id,college_id)` | `ix_coursework_assignments_teacher_assignment_college` |
| 02 | `(created_by_membership_id,created_by_user_id,college_id)` | `ix_coursework_assignments_creator_membership_user_college` |
| 02 | `(college_id)` | Prefix of `ix_coursework_assignments_college_status_due` |
| 03 | `(coursework_assignment_id,college_id)` | `ix_coursework_submissions_assignment_college_fk` |
| 03 | `(student_id,college_id)` | `ix_coursework_submissions_student_college_fk` |
| 04 | `(coursework_submission_id,college_id)` | `ix_coursework_revisions_submission_college_fk` |
| 05 | `(coursework_assignment_id,college_id)` | `ix_coursework_audit_assignment_college_fk` |
| 05 | `(actor_membership_id,actor_user_id,college_id)` | `ix_coursework_audit_actor_membership_user_college_fk` |

These indexes do not change existing live indexes. They are draft DDL only.

## Trigger, concurrency, and privilege limitations

Statement-level `BEFORE TRUNCATE` triggers cover ordinary SQL sessions, while row triggers cover the specified row mutations. Neither is an absolute audit-retention boundary: a table owner or sufficiently privileged role may disable/drop triggers, alter grants, or otherwise bypass ordinary protections. No database roles or grants were invented or changed.

Proposed least-privilege design for separate review:

1. Use a controlled migration principal for DDL, with its use restricted to approved migration windows.
2. Assign schema-object ownership to a dedicated non-login owner principal.
3. Use a separate runtime principal that is not a superuser, object owner, or schema owner and has no DDL, ownership, trigger-management, or `TRUNCATE` rights.
4. Grant only API-required table operations and sequence/function privileges. Do not grant UPDATE/DELETE on immutable history tables; permit only required INSERT/SELECT. Review each assignment/link lifecycle operation individually.
5. Verify effective privileges and trigger state in a disposable PostgreSQL rehearsal and target preflight. Role names and grants remain undecided and uncreated.

The global submission lock order remains: assignment `FOR SHARE`; account link `FOR SHARE`; active enrollment `FOR SHARE`; create/find and lock the logical submission; then resolve idempotency and append a revision. Archive, deadline changes, link revocation and enrollment deactivation must use compatible ordering. This is a proposed service contract, not a tested guarantee. PostgreSQL concurrency rehearsal is required.

## Migration-history and recovery plan

- Draft filenames do not establish that a migration was applied. The reconciliation still reports no conventional migration ledger and no adopted baseline.
- Obtain separate owner approval for one migration-history adoption strategy; reconcile all historical scripts with the live catalog before choosing it. Do not create/stamp a ledger during this task.
- Rehearse the exact order `01 → 02 → 03 → 04`, then `05` after `02`, on a disposable PostgreSQL copy with representative catalog conditions. Test failure/interrupt behavior and inspect each resulting object definition after each step.
- Before target application, obtain a separately approved verified backup and successful restore rehearsal. Check for partial objects/functions/indexes before any retry; do not blindly rerun a script.
- If a revision committed and a defect is discovered, preserve all coursework and link history and prepare a new forward repair. Destructive rollback is not the default; it requires evidence no dependent data exists, a rehearsed restore path, and separate explicit approval.
- Validate trigger behavior, actual privileges, composite FKs, lock contention, concurrent submissions, idempotency, and audit atomicity on the disposable PostgreSQL rehearsal. No such test occurred here.

## Static validation and actual results

- SQL lexical/static consistency checks: targeted source inspection plus a non-executing assertion script. `python -` checked explicit draft markers, transaction framing, balanced dollar delimiters, dependency guards, trigger presence/state conditions, selected type modifiers, and expected FK-index key order; **43/43 assertions passed**. These checks do not parse SQL grammar.
- PostgreSQL-compatible parser: `pglast` and `sqlglot` were not available in the current Python environment. No dependency was installed.
- SQL syntax validation: **NOT TESTED** (manual/static checks are not a PostgreSQL-compatible parser).
- PostgreSQL execution / migration application: **NOT TESTED / NO**.
- Coursework APIs enabled: **NO**. Default-deny legacy protection and the Migration Required page were not modified.
- Migration approval: **NOT GRANTED**.
- Application/backend tests: **NOT RUN**; no API implementation was made.
- `git diff --check`: **PASS**, exit code 0. Git printed pre-existing LF-to-CRLF working-copy warnings for unrelated tracked files.
- Scoped trailing-whitespace scan across the five SQL drafts and two coursework documents: **PASS**, 7 files, 0 trailing-whitespace lines.

## Remaining blockers

1. PostgreSQL-compatible parser validation and disposable PostgreSQL execution/concurrency rehearsal.
2. Separate owner decision on migration-ledger/baseline adoption.
3. Separate approval and implementation of effective least-privilege ownership/grants.
4. Approved Student identity-verification and account-link audit policy.
5. Backend authorization/API implementation and tests after schema approval/application.
6. Verified backup/restore rehearsal before target migration approval.

No migration was applied. All five scripts remain **DRAFT / NOT APPLIED**.
