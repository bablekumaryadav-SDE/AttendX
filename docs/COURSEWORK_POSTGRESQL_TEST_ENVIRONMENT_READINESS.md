# Coursework PostgreSQL Test Environment Readiness

**Status: BLOCKED — DOCUMENTED ISOLATED CLUSTER EXISTS, BUT NO CURRENT TEST LISTENER OR SAFE COURSEWORK BASELINE**
**Review date:** 2026-11-14

## Scope and safety

This is a read-only environment and design review. PostgreSQL/catalog access, SQL execution, migrations, service/container changes, credentials, `.env`, and DPAPI contents were not accessed. The DPAPI file was not opened or read. Existing working-tree changes were preserved. No Coursework API or fixture was created.

## Environment availability

| Item | Finding | Evidence and limitation |
|---|---|---|
| PostgreSQL installation | **AVAILABLE: PostgreSQL 18.6 binaries** | `C:\Program Files\PostgreSQL\18\bin\postgres.exe` and `psql.exe` exist; file metadata reports version 18.6. No binary was executed. |
| Existing PostgreSQL service | **RUNNING, NOT THE TEST TARGET** | Read-only service status shows `postgresql-x64-18` Running. Existing documentation associates this service with the C: cluster. No service was changed and no database identity was queried. Do not repurpose it. |
| Isolated test cluster | **DOCUMENTED, FILES PRESENT, NOT CURRENTLY LISTENING** | Historical approval records PostgreSQL 18.6 at `D:\AttendX\PostgreSQL-Test\cluster`, system identifier `7704647215459077108`, loopback `127.0.0.1:55432`, with `attendx_integration_test` and `attendx_restore_verify_20261109_133428`. Directory, `PG_VERSION`, and `global\pg_control` exist. Current read-only listener check found zero listeners on 55432. No database connection was made, so current cluster/server/database identity and role state are **NOT REVERIFIED**. |
| Test credentials | **BLOCKED / NOT ACCESSED** | Historic reports record credentials in `D:\AttendX\PostgreSQL-Test\credentials.dpapi`; this task did not access it. The separate credential-recovery record marks that custody/access unresolved. Do not decrypt or reuse the file until the credential gate is resolved and separately approved. |
| Docker/container runtime | **NOT AVAILABLE ON PATH** | `docker`, `podman`, and `nerdctl` were not found; the usual Docker executable path was absent. No runtime was started or inspected beyond executable availability. |
| Sanitized schema baseline | **NOT AVAILABLE / NOT VERIFIED** | The documented Phase 11 rehearsal backup is 1,167 bytes and restores an empty database with zero user relations; it cannot satisfy Coursework migration prerequisites. A repository backup named `database/backups/attendx_pre_effective_dates_20261112_144945.dump` exists (metadata: 3,998,646 bytes), but its contents and sanitization were not inspected; treat it as unverified and do not restore it. No Coursework-compatible sanitized schema snapshot was identified. |
| Restore/recovery procedure | **DOCUMENTED, NOT CURRENTLY REHEARSED FOR COURSEWORK** | `docs/POSTGRESQL_BACKUP_RESTORE_REHEARSAL.md` documents isolated dump/restore, identity gates, failure stop conditions, and no `--clean`/`--create`. Phase 11 documents a successful restore of an empty DB. Neither proves a Coursework baseline restore or Coursework migration recovery. |

### Correction to the prior report

The prior statement that no documented isolated PostgreSQL target exists was too broad. Phase 10/11 documents a previously configured and verified D: test cluster and an empty-database restore. It is **not currently ready for Coursework rehearsal**: the latest read-only check found no listener on 55432, the credentials are not available for use under the current custody gate, and there is no verified sanitized tenant-schema baseline. This correction is based on project records and filesystem/listener metadata only, not a database connection.

## Safe owner setup/recovery checklist

The repository contains an earlier proposed cluster identity at `127.0.0.1:55432` and a dedicated test database/role. Do not start that cluster or access its credentials as part of this task. The owner must first choose and separately authorize one of these paths:

1. **Recover the documented isolated D: target** under the credential-recovery process, without reading or reusing the old DPAPI material unless that process explicitly establishes safe custody; or
2. **Prepare a fresh isolated PostgreSQL 18 cluster** in a new, empty, owner-selected data directory, bound only to loopback on a port distinct from 5432 and 55432. This entails a separately approved cluster/service-process operation and is not authorized here.

For either path, the owner should:

1. Provision credentials in a protected secret store and a dedicated non-superuser test role. Never put URLs/passwords into repository files, shell history, command arguments, or logs.
2. Keep migration ownership separate from the API runtime role. Use a migration principal for reviewed DDL; use a runtime role that is not superuser, database/schema owner, table owner, trigger manager, or holder of DDL/TRUNCATE privileges. Grant only reviewed runtime operations.
3. Produce a **sanitized schema baseline** from an approved schema definition, not an unreviewed production dump. It must contain the exact tenant foundation tables/keys referenced by draft 01 (`users`, `colleges`, `college_memberships`, `students`) and the assignment/class/subject/teacher relationships required by draft 02, with only synthetic identities/rows. No biometric, guardian, live student, or production credential data should be included. NULL legacy ownership stays unknown; do not backfill it.
4. Rehearse baseline restoration into a newly named empty test database. Verify the endpoint, cluster data directory/system identifier, database, schema, role, privileges, and expected tables before and after restore. Preserve the original dump; do not use `--clean`/`--create`.
5. Before each migration, record explicit target identity and compare expected prerequisites/constraints with the restored baseline. Apply one draft at a time in order 01→02→03→04→05 only after separate migration approval. Stop on any error or ambiguous result and inspect catalog state before a forward-repair decision; do not blindly rerun or drop objects.
6. After each revision, verify constraints, index key order, trigger/function definitions, privileges, and checksums/catalog signatures. Then rehearse cross-College denial, identity linking, idempotency, submit/archive/deadline concurrency, rollback/failure recovery, and restore the pre-change state into a **new** verification target.

These are future operator actions, not commands authorized or executed here.

## Identity-linking design

### Authenticated principal and College

- Resolve `user_id` only from the validated authentication principal, never from a request-body user identifier.
- On every request, require an active CollegeMembership for the selected College and correct membership role, an active User account, and an active College. `User.role` alone grants no tenant access; Super Admin receives no implicit College access.
- Derive the College from the authenticated membership context. Ignore/reject caller-supplied College overrides; foreign object IDs return a sanitized 404.

### Student binding

- Use the drafted `student_account_links` relation only after review/application. It records an explicit Student/User/College association, verifier and revocation history.
- The current Student model has no `user_id` FK. Do not match by email, name, phone, or roll number. College Admin must use an approved identity verification procedure and explicitly bind the authenticated user to the existing Student profile. The evidence method/retention policy must be approved; do not store identity documents in Coursework records.
- At every Student Coursework request require: active account, active Student CollegeMembership, active verified account link in the same College, active Student profile, and active same-College StudentClassAssignment for the assignment's class. Server derives the Student profile; clients cannot choose another `student_id`.
- Revoked links and inactive memberships/enrollment deny new submissions immediately. Keep history but do not backfill historical links.

### Teacher binding and mapping

- The Teacher ORM model has no `user_id` FK or explicit account-link table in the five Coursework drafts. Existing code commonly resolves Teacher/User by email; that is not proof of identity and must not be copied into Coursework authorization.
- Add a separately reviewed explicit `teacher_account_links` relation (or approved equivalent) tying `user_id`, `teacher_id`, and `college_id`, with immutable verifier/time and one-way revocation audit; composite FKs should enforce the same College. Role/status checks still belong in the service because FKs do not encode active membership role.
- For newly created Teacher accounts, bind the inserted Teacher and User IDs directly inside the authorized creation transaction; do not rediscover the relationship by email. For existing rows, require explicit identity verification and audit. No automatic matching/backfill.
- A Teacher request must resolve the Teacher profile from that verified binding, then verify active Teacher membership and active account. For create/edit/publish/monitor operations, require a matching active/effective TeacherAssignment for the same Teacher, Class, Subject, and College. Validate its date interval on every request; client-supplied IDs never override the mapping or tenant.

### College Admin controls

College Admin creates Coursework on behalf of an explicitly chosen authorized Teacher mapping only if the approved contract permits it; the current requested ownership model says Teachers author assignments, so College Admin APIs remain monitoring-only. Admin audit actions (such as archive/deadline extension if permitted by the approved contract) require active College Admin membership, same-College object, reason, and atomic audit+state change.

## NotificationEvent reconciliation proposal

### Source mismatch

- `NotificationEvent` ORM declares nullable `college_id`, College FK, `(id,college_id)` unique key, composite `(student_id,college_id)` FK, and College/user indexes.
- `database/migrations/20261103_add_notification_events_postgresql.sql` lacks `college_id`, its College FK/key/composite Student FK, and the College index. Its `CREATE TABLE IF NOT EXISTS` is not a reconciliation operation for an already existing partial table.
- ORM `college_id` is nullable. Under default PostgreSQL `MATCH SIMPLE`, a row with `student_id` present and `college_id` NULL bypasses the composite FK check. A separate, reviewed rule is needed for new College-scoped events while preserving old unattributed records.
- Legacy `/notifications` routes are default-denied; `/tenant/notification-events` is College Admin read-only monitoring, not the personal inbox/mark-read contract. Existing absence notifications are separate and currently do not set `college_id`; do not change that attendance flow in this phase.

### Safe forward design

1. Do not edit/re-run the historical migration as a repair. After a separately approved rehearsal catalog review, prepare a new forward-only reconciliation migration with exact preflight checks for partial table state.
2. Add nullable College attribution and restrictive College FK, ORM-required unique/composite constraints and supporting indexes. Preserve old rows with NULL College as **UNKNOWN** and exclude them from tenant APIs; never infer/backfill College from personal fields.
3. Define how new scoped events must have non-NULL `college_id` and matching Student ownership. Evaluate a staged constraint strategy against retained null-attribution rows; do not apply a simple validated check that would fail on old records or silently rewrite them.
4. Review the recipient integrity contract: user/College membership consistency, Student link, and Teacher binding must be checked in the application transaction. Preserve global/unscoped legacy events as NULL College and keep them outside tenant inboxes.
5. Model notification states separately: event persisted; in-app visible after commit; external attempt; provider-confirmed delivery (with provider receipt/time); read timestamp. Never translate “queued” into “sent.” Use a transactional outbox and idempotency per recipient/event if external delivery is later approved.

## API implementation gate

No APIs were implemented in this task. After migration rehearsal and identity design approval:

- Teacher Coursework endpoints should resolve the Teacher through explicit binding and filter each query by active mapping and College; create drafts, publish, set deadlines/instructions, and read submissions under role-specific authorization.
- Student endpoints should list only published assignments for currently active verified links/enrollments, accept text submissions with server-owned time/late state, and return immutable revision history.
- College Admin endpoints should be read-only monitoring across their College, with filters by Teacher/Class/Subject/status and derived pending progress; no Teacher assignment creation/editing.
- Notifications should use recipient-specific `GET /tenant/notifications` and idempotent mark-read, filtered by authenticated user and College on every call. Assignment publication and submission events should be inserted atomically with the business event. Deadline reminders require a separately reviewed scheduler/worker. External channels require provider-confirmed delivery evidence.
- Keep the legacy `/assignments` mapping router and default-deny `/notifications` routes unchanged.

## Actions and checks performed

- Read-only: `git status --short --untracked-files=no`; service status; executable availability; file existence/metadata for the isolated cluster markers and backup; listener metadata for port 55432; selected project documentation.
- Current observations: PostgreSQL service remains Running; PostgreSQL 18.6 binary metadata available; isolated cluster directory/marker files exist; no listener on port 55432; Docker/Podman/nerdctl not on PATH; historical 1,167-byte rehearsal backup exists; repository dump metadata exists but sanitation is unknown.
- Not performed: database connections/catalog queries, SQL, migrations, startup/shutdown, service/container changes, credential/DPAPI access, restore, application tests, Coursework API implementation, or data changes.
- No tests were run during the initial environment inventory. The subsequent static-only migration test is recorded in the addendum below. Browser and PostgreSQL application behavior remain **NOT TESTED**.

## Decision

**A suitable Coursework rehearsal environment is not currently ready.** There is a historically verified isolated PostgreSQL 18.6 cluster and empty backup, but it is stopped/not listening on the documented port, credentials remain behind a separate unresolved custody/recovery gate, and no sanitized tenant-schema baseline was verified. Owner must resolve those gates and provide explicit authorization for the exact isolated target and migration rehearsal before Coursework APIs can be implemented/enabled safely.

## Safe source preparation addendum — 2026-11-14

While the rehearsal remains blocked, a forward-only notification schema reconciliation was prepared as `database/migrations/DRAFT_20261114_06_notification_events_college_scope.sql`. It is explicitly **DRAFT / NOT APPLIED** and fail-closes unless the base notification table and tenant prerequisite keys exist, the target column/objects are absent, and there are no pre-existing `coursework_` event types requiring attribution review. It adds nullable College attribution without backfilling historical rows, restrictive College and composite Student/College FKs, ORM-aligned uniqueness/indexes, and a `NOT VALID` check requiring College attribution for new/updated Coursework event rows. The ORM now declares the same Coursework-event check. No migration was executed.

`backend/tests/test_notification_events_college_scope_migration_static.py` adds static-only source checks. A passing result proves only the checked text contract; it does not validate PostgreSQL parsing, catalog state, or migration behavior. No notification APIs or identity-link APIs were added/enabled. The unresolved explicit Teacher/User binding remains a blocker to Teacher Coursework authorization.

Validation run: `..\.venv\Scripts\python.exe tests\test_notification_events_college_scope_migration_static.py` from `backend` — **4 passed, 0 failed**. The first run exposed a static-test phrase mismatch; the test expectation was aligned with the draft's error text and the focused rerun passed. No PostgreSQL parser or database test was run.
