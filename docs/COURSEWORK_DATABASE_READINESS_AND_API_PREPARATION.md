# Coursework Database Readiness and API Preparation

**Status: BLOCKED — NO VERIFIED DISPOSABLE POSTGRESQL REHEARSAL TARGET**
**Review date:** 2026-11-14
**Scope:** Static source and SQL draft review only. No database connection, SQL execution, migration, or application code implementation was performed.

## 1. Environment determination

No existing disposable PostgreSQL rehearsal target is established by the project evidence reviewed:

- `docs/POSTGRESQL_TEST_DATABASE_CONFIGURATION.md` says the test URL is not configured and its parser guard cannot prove a cluster is disposable.
- `docs/PHASE_7_POSTGRESQL_REHEARSAL.md`, `docs/POSTGRESQL_BACKUP_RESTORE_RESULTS.md`, and `docs/POSTGRESQL_COMPATIBILITY_REPORT.md` say no test target/restore rehearsal was verified; the installed service is not considered disposable.
- `backend/app/test_database_config.py` only validates a separately supplied PostgreSQL test URL and distinct identity. It does not create a test database or connect, and explicitly says its checks do not establish disposability.
- `deployment/compose.yaml` defines API and web services; it does not define a PostgreSQL rehearsal service.
- No PostgreSQL parser package was available in the existing Python environment (`pglast`, `sqlglot`, `sqlparse` absent). `psycopg2` availability is a driver, not a SQL parser; it was not used to connect.

Accordingly Phase 3 stops here. The exact prerequisite is a separately identified and explicitly authorized disposable PostgreSQL 18 cluster/database/role prepared from a sanitized compatible schema baseline, with a verified restore/recovery process. Do not use the existing application database or assume a loopback address/test-like name proves isolation.

## 2. Five Coursework drafts: dependency and static review

All five files begin `STATUS: DRAFT / NOT APPLIED`. Every script is wrapped in `BEGIN`/`COMMIT`, performs catalog prerequisite checks in a `DO` block, and rejects target-object/function collisions rather than silently adopting partial objects. These properties are visible in source; no PostgreSQL syntax or runtime claim is made.

| Draft | Objects / guarantees reviewed | Dependencies and assessment |
|---|---|---|
| `database/migrations/DRAFT_20261114_01_student_account_links.sql` | Creates explicit Student/User/College link history with active/revoked state, verifier/revoker references, composite Student/College and User/College FKs, membership actor FKs, partial unique active-link indexes, lookup/FK indexes, immutable identity and one-way revocation trigger, and row/statement truncate guards. It inserts no links. | Requires `students`, `college_memberships`, `users`, exact INTEGER keys and named ordered unique keys. No personal-attribute matching. Runtime must still enforce active Student role/membership/User, College Admin verifier authorization, and accepted identity evidence; FKs alone do not enforce roles or status.
| `database/migrations/DRAFT_20261114_02_coursework_assignments.sql` | Creates draft/published/archived assignments with College and TeacherAssignment ownership, creator membership/user, time/status/marks checks, composite FKs, listing/FK indexes. Draft creation and published/archived mutation/deletion rules are in draft 05. | Depends on draft 01 and tenant foundation keys. FK proves same College for `teacher_assignment_id`, not that the TeacherAssignment is active/effective or that the actor may publish; API must check those conditions every time.
| `database/migrations/DRAFT_20261114_03_coursework_submissions.sql` | Creates one logical submission per assignment/Student/College, College-safe composite FKs, read/FK indexes, insertion guard requiring published non-archived assignment, immutable header and truncate guard. | Depends on drafts 01–02 plus Student key. Header/FK does not prove active account link or enrollment; API must check them transactionally. Trigger locks the assignment row on header insertion.
| `database/migrations/DRAFT_20261114_04_coursework_submission_revisions.sql` | Append-only text revisions with revision-number and idempotency uniqueness, composite FK, indexes, server-set submitted timestamp/late flag, published/non-archived assignment lock, mutation and truncate guards. | Depends on drafts 01–03. The trigger protects assignment state/deadline at revision insert but does not verify authenticated Student identity/link/enrollment. Those checks belong in one transaction with the documented lock order.
| `database/migrations/DRAFT_20261114_05_coursework_assignment_audit_events.sql` | Append-only publish/deadline/archive audit events with same-College assignment and actor-membership composite FKs, JSON-object/reason checks and indexes. Assignment guard requires a corresponding event for transitions, protects published content/mapping and archive state, and blocks ordinary row/statement deletes/truncates. | Depends on draft 02 and the membership triple key. Application must authorize the actor and insert event plus assignment transition atomically. A DB owner/superuser or sufficiently privileged role can disable/alter triggers; these triggers are not a substitute for least-privilege ownership/grants or API authorization.

### Dependency order

The reviewed dependency graph is `01 → 02 → 03 → 04`, with `02 → 05`. A straightforward application order is **01, 02, 03, 04, 05**. Draft 05 could follow draft 02, but applying it last simplifies a single review sequence. No migration ledger is established by the project docs; filenames do not prove application. Baseline/ledger ownership must be decided before any future production migration history is recorded.

### Syntax, constraints, indexes and transaction assessment

- Static source review found the intended PostgreSQL constructs: `DO`/PL/pgSQL preflight blocks, `to_regclass`/catalog inspection, `GENERATED BY DEFAULT AS IDENTITY`, partial unique indexes, composite FKs, JSONB checks, PL/pgSQL trigger functions, row triggers, statement-level truncate triggers, and transaction boundaries.
- PostgreSQL 18 documents `TRUNCATE` as a trigger event and supports statement-level triggers for it; it also supports the `FOR SHARE` row locking clauses used by drafts 03–04. These documentation matches do **not** parse or execute these files.
- No known syntax defect was established by this source review; SQL parser validation is **NOT TESTED**, and PostgreSQL execution/rollback is **NOT TESTED**. A parser would not establish live prerequisite compatibility or trigger/concurrency behavior.
- Composite foreign keys consistently include `college_id` for Coursework-to-TeacherAssignment, assignment-to-membership, submission-to-assignment/Student, revision-to-submission, and audit event-to-assignment/actor-membership relationships. Draft 01's Student link also ties Student, user membership and College. Referenced key order is explicitly preflighted in the drafts.
- Referencing-side indexes are present in key order for composite FKs; separate College-first indexes support list queries. Partial unique indexes enforce one active link per Student and one active link per user/College.
- `ON DELETE RESTRICT` preserves linked Coursework/history. There is no destructive downgrade script. Recovery should be forward-repair after catalog inspection; a restore is only appropriate for a disposable rehearsal and must be separately rehearsed. Do not drop tables/triggers to retry.
- Draft transaction wrappers provide transactional intent, but failure, interruption, commit ambiguity, migration locks, lock duration and transactional behavior remain untested on PostgreSQL. Each failed/ambiguous attempt must stop for catalog inspection; never blindly rerun or stamp a revision.
- Triggers enforce record-state invariants for ordinary application roles, not a complete security boundary. Least-privilege grants/ownership and API role checks remain required.

### Application-level concurrency obligations

The SQL triggers only lock the assignment row at submission header/revision insertion. The documented service must use one consistent order: published assignment `FOR SHARE`; active verified account link `FOR SHARE`; active enrollment `FOR SHARE`; create/find logical submission by its unique key; lock submission `FOR UPDATE`; resolve idempotency and append the revision. Assignment archive/deadline changes, link revocation and enrollment deactivation must follow compatible ordering. Competing first submissions, retry idempotency, archive-vs-submit and deadline-vs-submit must be tested on PostgreSQL; SQLite tests cannot prove these semantics. PostgreSQL documents that row locks block conflicting updates until transaction end and that deadlocks can occur, so the complete application lock order—not only trigger fragments—must be rehearsed.

## 3. NotificationEvent schema reconciliation proposal

### Confirmed source mismatch

- `backend/app/models.py` `NotificationEvent` (around lines 816–844) declares `college_id` nullable with a College FK; `UNIQUE (id, college_id)`; a composite `(student_id, college_id) → students(id, college_id)` FK; indexes for `(user_id, created_at)` and `(college_id, created_at)`; `delivery_status`, `read_at`, `created_at`, and `sent_at`.
- `database/migrations/20261103_add_notification_events_postgresql.sql` creates `notification_events` with `id`, `user_id`, `student_id`, channel/recipient/content/status/idempotency/read/timestamps, but no `college_id`, College FK, composite Student/College FK/key, or College index. `CREATE TABLE IF NOT EXISTS` does not reconcile columns when the table already exists; the migration does not include post-create catalog assertions for this ORM shape.
- `backend/app/schemas/tenant_workspace.py` exposes an Admin read-only event item with event type, channel, title/message, `record_status`, read/created/sent timestamps. The event list in `backend/app/api/tenant_workspace.py` filters by ORM `college_id`; with a table lacking that column, it cannot satisfy the query. This report makes no live-schema claim.
- `backend/app/api/notifications.py` uses raw SQL for `history`/`mine` and mark-read. The router remains mounted behind `legacy_business_dependencies` with OpenAPI exclusion. It has no College filter; it must not be enabled as the new tenant notification contract.
- Existing attendance absence event creation in `backend/app/api/attendance_sessions.py` is a separate producer. It checks for notification/guardian tables and queues a notification event, but its user resolution uses Student/User email equality and its insert does not supply `college_id`. Do not reuse it for Coursework recipients or assume it is a verified Student account link. Any change to that attendance path needs separate scope review.

There is an additional integrity detail: because ORM `NotificationEvent.college_id` is nullable, the composite `(student_id, college_id)` FK by itself does not reject a row with a non-NULL `student_id` and NULL `college_id` under PostgreSQL's default `MATCH SIMPLE` behavior. A reviewed future schema must define how legacy unattributed events are preserved while new College-scoped student events are required to carry College attribution (for example, an explicitly evaluated `CHECK`/constraint rollout). PostgreSQL documents that any NULL component under `MATCH SIMPLE` exempts the composite FK from requiring a match; see [`CREATE TABLE`, foreign-key match behavior](https://www.postgresql.org/docs/18/sql-createtable.html). The current ORM comment says same-College attribution but no check expresses this non-NULL coupling.

### Safe reconciliation path (proposal only)

1. Do not edit or rerun the historical `20261103` migration as a repair. First determine through a separately approved, read-only rehearsal/target catalog review whether it was applied and which objects exist. Current phase did not connect.
2. Prepare a new forward-only, versioned reconciliation migration after the target's migration-history policy is approved. Preflight exact relation/column/constraint/index state and fail closed on unexpected/partial definitions.
3. Add nullable `college_id INTEGER` with a restrictive College FK, the ORM-required ordered unique `(id, college_id)`, the composite Student/College FK, and College/time index. Add the relevant user/College membership integrity only after reviewing the notification recipient contract and existing nullable/global events.
4. Preserve historical rows with unknown College attribution as `college_id IS NULL`; do not infer ownership from student email, user email, names, or guardian fields. Tenant queries exclude NULL. Any stricter invariant for newly created Student/College events must account for retained NULL historical rows (for example a reviewed `NOT VALID` constraint followed by an explicit data-resolution policy); do not silently backfill.
5. Reconcile producer behavior with explicit account identity: assignment publication recipients must come from active College-linked Student accounts and active enrollments; submission recipients from the authenticated Teacher's verified profile binding. Do not map identities by email. The existing Teacher model has no `user_id` FK; current source often equates Teacher/User by email. The Coursework schema drafts do not define a Teacher account-link relation. An explicit, approved Teacher identity binding or a separately verified stable identity invariant is a prerequisite.
6. Define notification state dimensions separately: event persisted; visible in the in-app inbox after commit; external delivery attempted; provider-confirmed delivery with provider receipt/time; read timestamp. Do not set provider-confirmed/sent based only on queueing. Preserve idempotency per event/recipient. Deadline reminders require an approved scheduler/worker and a non-duplicate event key; none was established here.
7. Add role/College-scoped inbox and `mark-as-read` APIs only after the schema and principal bindings are verified. Reads must filter by authenticated `user_id` and selected `college_id`, active membership, and recipient role; updates must match both notification identifier and recipient principal/College. College Admin monitoring remains a separate privileged, College-filtered API.

The exact field/constraint migration shape and treatment of existing NULL/unknown rows require review against an authorized rehearsal catalog before implementation. No reconciliation SQL was created or applied here.

## 4. Backend API implementation plan (not implemented)

Keep the existing `/assignments` router unchanged: it is Teacher-Class-Subject mapping, not coursework.

| Capability | Proposed endpoint family | Authorization and transaction contract |
|---|---|---|
| Teacher draft create/list/detail/edit | New `/tenant/coursework/assignments` routes | Authenticated Teacher, active selected College membership, explicit Teacher-profile binding, active/effective `TeacherAssignment` matching College/Class/Subject; drafts only for that mapping. Server derives College, creator and mapping scope. Foreign identifiers return sanitized 404.
| Teacher publish | `POST /tenant/coursework/assignments/{id}/publish` | Authorized assigned Teacher only; transition + audit event in one transaction; published contents/mapping become immutable.
| Student published list/detail/history | `GET /tenant/coursework/assignments`, `GET /tenant/coursework/assignments/{id}`, revision history route | Authenticated Student with active account, active same-College Student membership, explicit verified `student_account_links` record, and active class enrollment; exclude NULL College rows and unpublished/foreign assignments.
| Student submit/resubmit | `POST /tenant/coursework/assignments/{id}/submissions` | One transaction using the rehearsed global lock order. Ignore client College, submitted time and late flag. DB trigger/server assigns time and late status. Unique logical submission; immutable revision per idempotency key. Equal-content retry can return same revision; key reused with different content returns 409.
| College Admin monitor | `GET /tenant/coursework/admin/assignments`, detail and submissions | Active College Admin membership; resolve College from tenant context on every request. Read-only filters for Teacher/Class/Subject/status and derived submission/pending counts; never create/edit Teacher-owned content.
| Audit actions | `POST .../{id}/deadline-extension`, `POST .../{id}/archive` | Role and assignment scope enforced; non-empty reason; audit event and mutation atomic. Archive blocks future submission. Deadline only extends.
| Student account link | Separate reviewed College Admin link/revoke route | Only explicit identity-verification procedure, no personal-field matching; actor membership role/status and verifier evidence policy checked, immutable audit history retained. Keep disabled until that policy is approved.

These endpoints remain absent/unregistered until the five drafts are reviewed, applied only in an authorized disposable rehearsal, and concurrency/security tests pass. No API code was added in this report phase.

## 5. Notification API plan (not implemented)

- `GET /tenant/notifications`: recipient-only list, user+College filtered, with unread/read timestamps and pagination.
- `PATCH /tenant/notifications/{id}/read`: idempotently set `read_at` only when notification belongs to authenticated recipient and selected College; return sanitized 404 otherwise.
- Publication/submission event creation belongs in the same database transaction as the business event or via a transactional outbox. Enforce an idempotency key per recipient/event so retries do not duplicate alerts.
- Deadline reminders require an approved periodic worker, a well-defined timezone/deadline policy, dedupe key, retry/backoff, and audit fields. No scheduler/provider configuration is assumed.
- Email/SMS are optional delivery channels. Store attempt and provider-confirmed outcomes separately; a queued row is not sent/delivered. Never report delivery without provider confirmation.
- Admin monitoring endpoints are distinct from personal notification inboxes; Admin visibility must not grant access to a user's personal notification history beyond the reviewed monitoring contract.

## 6. Required next steps and validation status

1. **BLOCKED:** Obtain/prepare and explicitly identify an existing disposable PostgreSQL rehearsal target and restore source; separately authorize its use. Do not create or connect to the existing application database.
2. **BLOCKED:** Have the five SQL drafts independently syntax-checked and executed in order on that disposable PostgreSQL target, with catalog assertions after each revision, plus rollback/failure and concurrency rehearsal.
3. **BLOCKED:** Approve migration-ledger/baseline strategy; explicit Student identity-verification evidence/retention/revocation; and an explicit Teacher-to-User binding strategy.
4. **BLOCKED:** Prepare a separate notification migration reconciliation without rewriting historical migration truth; preserve unattributable old rows as UNKNOWN and validate provider state semantics.
5. **NOT IMPLEMENTED:** Add ORM/schema/service/API code and isolated tests only after the schema contract and identity policies are approved. Keep routes absent/default-denied until then.
6. **NOT IMPLEMENTED:** Add real UI API integration and role-specific notifications only after route enablement, contract tests and PostgreSQL verification.

No Coursework or notification backend tests, database tests, migrations, or browser tests were run for this review. No source/migration file was modified. PostgreSQL syntax, trigger execution, FK behavior, rollback, isolation and concurrency are **NOT TESTED**.

## PostgreSQL 18 documentation consulted

- [`CREATE TRIGGER`](https://www.postgresql.org/docs/18/sql-createtrigger.html) documents `TRUNCATE` as an event and statement-level trigger form.
- [Trigger behavior overview](https://www.postgresql.org/docs/18/trigger-definition.html) describes row and statement trigger firing.
- [Explicit locking, including `FOR SHARE`](https://www.postgresql.org/docs/18/explicit-locking.html) documents row-lock conflict behavior and lock release at transaction end.
- [Data consistency checks at application level](https://www.postgresql.org/docs/18/applevel-consistency.html) emphasizes locking when application invariants depend on rows remaining unchanged during a transaction.

Documentation is reference evidence only; it is not a parser or execution test of the draft SQL.
