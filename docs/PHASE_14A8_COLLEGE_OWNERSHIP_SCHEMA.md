# Phase 14A.8 — College Ownership Schema & Tenant API Implementation Readiness

**Date:** 2026-11-09
**Status:** ORM/service foundation and PostgreSQL DRAFT prepared; migration **NOT APPLIED**. Phase 14A.7 legacy API gate remains active. SQLite/static validation is not PostgreSQL validation.

## Ownership model and entity matrix

The ownership key is an explicit `college_id`, never global `User.role`. A nullable ownership value means **UNKNOWN legacy ownership** and is excluded by ownership services. New tenant API code must resolve `TenantContext` using `resolve_tenant_context`, set College on new rows from that verified context, and filter every access. No migration or application code assigns College ownership to existing rows.

| Entity | Ownership classification | Parent/child and chosen design | Sensitive/user-specific data | Current API usage |
|---|---|---|---|---|
| `users` / `User` | Global identity | Remains global. College access is via explicit `CollegeMembership`; global role is not tenant authorization. | Credentials, contact and role data | `/auth/*`, membership service; not a College-owned record |
| `colleges` / `College` | Tenant root | Parent of memberships and directly owned entities. Delete restricted while tenant records refer to it. | Institution names/status | `/tenant/pilot/college-profile`; platform lifecycle service |
| `college_memberships` | User-to-College authorization relation | FKs to global User and College; unique `(user_id,college_id)`. Does not imply ownership of legacy rows. | Role, status and actor audit | Internal membership lifecycle service; no legacy router owns membership |
| `students` / `Student` | Direct College-owned | Nullable direct `college_id`; composite `(id,college_id)` key supports same-College child references. | Student identity and attendance | `/students/*`, `/attendance/student/*`, `/face/me/*`, attendance, dashboard, analytics, guardian, notification paths |
| `teachers` / `Teacher` | Direct College-owned | Nullable direct `college_id`; composite key parent for assignments, sessions, and attendance. | Staff identity | `/teachers/*`, assignments, sessions, attendance records, dashboards and analytics |
| `classes` / `Class` | Direct College-owned | Nullable direct `college_id`; composite parent for assignments, student enrollment, sessions and records. | Schedule/location and GPS/geofence data | `/classes/*`, assignments, student enrollment, sessions, attendance, analytics |
| `subjects` / `Subject` | Direct College-owned | Nullable direct `college_id`; composite parent for assignments, sessions and attendance records. Existing global unique `code` remains unchanged pending a separate uniqueness decision. | Academic catalog | `/subjects/*`, assignments, sessions, attendance and analytics |
| `teacher_assignments` / `TeacherAssignment` | College-owned dependent association | Direct nullable `college_id`; composite FKs to same-College Teacher, Subject and Class. | Teaching load/schedule | `/assignments/*`, `/teachers/{id}/assignments`, teacher dashboards |
| `student_class_assignments` / `StudentClassAssignment` | College-owned dependent association | Direct nullable `college_id`; composite FKs to same-College Student and Class; existing scalar FKs retained. | Enrollment history | Student class-assignment and student-attendance paths |
| legacy `attendance` / `Attendance` | Direct College-owned event | Direct nullable `college_id`; same-College Student and Teacher composite FKs. | Attendance status/history | `/attendance/*` |
| `attendance_records` / `AttendanceRecord` | Direct College-owned event | Direct nullable `college_id`; same-College Student, Teacher, Subject and Class composite FKs. | Student attendance and remarks | `/attendance-records/*`, dashboards and analytics |
| `attendance_sessions` / `AttendanceSession` | Direct College-owned event container | Direct nullable `college_id`; same-College Teacher, Subject, Class. | QR secret, GPS/geofence and schedule | `/attendance/sessions*`, student attendance and analytics (currently raw SQL in handlers) |
| `attendance_events` / `AttendanceEvent` | College-owned dependent evidence | Direct nullable `college_id`; composite FKs to same-College Session and Student. Unique session/student retained. | QR/face method, GPS, device hash and verification evidence | Session and student attendance handlers (currently raw SQL) |
| `face_embeddings` / `FaceEmbedding` | Derived from Student | No second `college_id`; reach only through the owned Student and scoped student ID. | Highly sensitive image and biometric embedding | `/face/me/*`, `/students/{id}/face`, student attendance |
| `student_guardians` / `StudentGuardian` | Derived from Student | One-to-one Student FK; no duplicated ownership key. Scope through Student. | Guardian identity, phone and notification preferences | `/students/{id}/guardian`, attendance notification workflow |
| `notification_events` / `NotificationEvent` | Account-global or College-associated | Optional direct `college_id`; events tied to a Student use composite same-College FK. NULL remains global/legacy/unknown. Existing user-account scoping is not sufficient for tenant APIs. | Contact/recipient, message and read state | `/notifications/*` (currently gated) |
| `attendance_audit_logs` / `AttendanceAuditLog` | Platform audit, optionally tenant-tagged | Optional direct College FK for a verified tenant event; generic entity ID remains polymorphic, so no fake entity FK. Historical NULL remains unclassified. | Actor/action and JSON metadata | Internal `log_audit`; no public read API |
| `student_id_counters` / `StudentIdCounter` | Global sequence state | Remains global because student-code generation is currently global and uniqueness is global. Revisit only if identifier rules become tenant-specific. | No personal content | Student creation service |

### Existing global uniqueness preserved

Student email/roll/student code, Teacher email/employee ID, Subject code, notification idempotency key and other existing global unique rules are not relaxed in this phase. Some may be too restrictive for future multi-College catalogs, but changing those semantics requires a separate duplicate analysis and explicit design. The ownership draft does not silently alter them.

## Relationship and constraint design

- Directly owned mapped entities carry nullable `college_id INTEGER REFERENCES colleges(id) ON DELETE RESTRICT`. Nullable is required to preserve pre-existing rows without guessing. It is not permission to expose a NULL row.
- Composite unique keys `(id,college_id)` are added to direct parents because PostgreSQL composite foreign keys require a unique target for the complete key. College-first indexes support actual tenant list/status/date reads; primary-key indexes are not repeated by the new ownership draft.
- `TeacherAssignment` must match Teacher, Subject and Class College. `StudentClassAssignment` must match Student and Class. Sessions must match Teacher, Subject and Class. Attendance records must match Student, Teacher, Subject and Class. Attendance events must match Session and Student. A tenant-associated notification with a Student must match that Student's College.
- Composite FKs use nullable ownership so legacy rows with NULL remain stored and unassigned. The Phase 14A.7 API gate stays in force; future write services must reject NULL ownership and require all parents to match the verified context. The DRAFT uses `NOT VALID` FKs to avoid reinterpreting old rows; PostgreSQL behavior still needs a controlled version-specific rehearsal.
- `FaceEmbedding` and `StudentGuardian` inherit ownership through Student and do not duplicate it. Their lookups/deletes must first resolve a Student within context. College deletion is RESTRICT; existing Student-to-face cascade and guardian cascade are retained through the Student relationship. Other business links use RESTRICT to preserve evidence.
- Account-only notifications and platform audit entries may remain NULL/global. A tenant notification or audit writer must explicitly supply the resolved context College; no code infers it from a user role, email, entity ID, or student ID.
- API inputs must not accept ownership changes. `reject_college_payload` rejects a raw mapping containing `college_id`; future request schemas must also reject extra `college_id` fields (`extra='forbid'`) because Pydantic may discard unknown fields before service validation. New records use `bind_new_record_to_context` only after context resolution.

## Migration draft and prerequisites

Draft: `database/migrations/DRAFT_20261109_add_tenant_ownership_v1.sql` (depends on tenant foundation v2). It is a separate additive draft and has not been executed.

Before any separately approved rehearsal, a fresh disposable PostgreSQL target must have the reviewed v2 tenant foundation, a verified pre-migration backup, and all thirteen expected public tables: colleges, students, teachers, subjects, classes, teacher_assignments, student_class_assignments, attendance, attendance_records, attendance_sessions, attendance_events, notification_events, and attendance_audit_logs. The SQL preflight verifies exact single-column `id` primary keys, required integer relationship columns, and that no target `college_id` already exists. It raises before ALTER statements if a prerequisite is absent or the draft appears partially applied. PostgreSQL must separately verify every declared type, constraint target, `NOT VALID` behavior, lock, transaction rollback and downgrade.

The upgrade adds nullable columns only; it inserts no row, assigns no default College, updates no value, promotes no role, and creates no membership. Comments preserve the `NULL = UNKNOWN` rule. Composite same-College constraints and query indexes are added after those columns and parent unique keys. If actual legacy tables are missing or their key/type layout differs, the preflight blocks. Do not run this draft against an empty Phase 11 database or production.

Downgrade is manual only. It must not run automatically. Before a separately approved reverse, verify every new `college_id` is NULL and no tenant data depends on the keys; then remove child columns/constraints before parent columns. Any non-NULL ownership value makes this rollback destructive. No downgrade was tested.

### Migration limitations / unresolved choices

1. All expected table names and types in the real legacy PostgreSQL schema are unknown; this is based on existing SQL migrations, raw SQL handlers and ORM metadata.
2. `notification_events` and session/event tables are optional in some prior installations; this draft intentionally fails when absent rather than partially enabling tenant APIs. A staged per-domain migration may be preferable after real schema discovery.
3. `college_id` stays nullable in storage to preserve unknown rows. Services/API gates prevent exposure, but database clients with write privileges can still insert NULL unless a future trigger/check policy is separately designed. Do not remove the application gate based on DDL alone.
4. Parent composite unique constraints are logically redundant with integer primary keys but are required targets for composite same-College FKs. Their lock/index cost requires PostgreSQL rehearsal.
5. Global uniqueness for student/teacher identifiers and subject codes may not match future independent-college catalogs. This phase preserves current behavior rather than changing existing uniqueness semantics.
6. Audit logs are generic and cannot get a trustworthy College through polymorphic `entity_id`; tenant code must pass context explicitly. Historical logs remain NULL/global.

## Reusable service foundation and API rollout plan

`backend/app/tenant_ownership.py` provides:

- `resolve_college_record`: filters by both record ID and verified College; missing, foreign, and NULL ownership all return sanitized 404. Unsupported model types fail with sanitized 503.
- `require_same_college`: validates all resolved parent/child objects share the context College; missing/unassigned/mismatched objects return the same 404.
- `reject_college_payload`: rejects raw payload mappings attempting to supply `college_id`.
- `bind_new_record_to_context`: only binds an unsaved record to the already-resolved context and rejects ownership input. It never binds an existing row.

These helpers do not authenticate or resolve a context themselves. Callers must use existing `resolve_tenant_context` with route-specific allowed membership roles; `User.role` is not a substitute. All legacy routers remain behind the Phase 14A.7 authenticated 503 gate. The helpers are not yet wired into business endpoints; no unscoped endpoint has been exposed.

**Smallest next API domain:** read-only College subject catalog (`GET /subjects/` and `GET /subjects/{subject_id}`). Subject listing/detail has no required child write workflow, can be filtered by `college_id`, and can require an active membership role for read. It is a contained first pilot after schema deployment. All legacy Subject rows remain NULL/hidden until separately reconciled; the catalog should initially return only newly and explicitly owned rows. Existing `code` global uniqueness remains a documented limitation. Do not remove the gate for this domain until queries use `resolve_tenant_context` and `resolve_college_record`, Super Admin/legacy Admin separation is tested, and missing tenant schema returns a safe 503.

Subsequent domains should proceed in dependency order: classes/subjects, teachers and assignments, students/enrollments, sessions/events/records, then aggregate dashboards/analytics/notifications. Parent ownership must be verified on every write and nested query; every aggregate must filter tenant ID at the base and joins.

## Legacy data and user behavior

- Existing rows in all ownership-bearing tables remain unchanged and NULL/UNKNOWN after the draft. No College, user, or membership rows are created.
- NULL/unknown Student, Teacher, Class, Subject, Assignment, Session, Event, Attendance, Record, Notification or Audit ownership is not visible from tenant APIs. Cross-College and unknown records return sanitized not-found behavior from the service helpers.
- Manual reconciliation is a future owner-reviewed process using trustworthy external evidence, dual review and auditable decisions. No automatic mapping from current global Admin, email domain, class/department, numeric ID, or relationships is valid evidence by itself.
- Phase 14A.7's legacy endpoints stay unavailable (authenticated 503). The frontend currently calls many of them; no College selector was added. Existing flows remain intentionally unavailable until domain APIs have a stable tenant request contract and separate frontend work.
- Super Admin remains separate from College membership and legacy Admin. Membership grants are explicit and lifecycle-managed.

## Validation and status

Tenant-focused tests use synthetic SQLite with foreign-key enforcement plus static SQL inspection and the local FastAPI test app. They cover model ownership metadata, same-College composite FK rejection, NULL/foreign record concealment, payload tampering, context binding, prerequisite/draft shape, and the legacy gate. Results and exact commands are in `docs/TEST_RESULTS.md`.

**NOT TESTED:** PostgreSQL parsing/application, actual legacy schema, `NOT VALID` FK/catalog behavior, upgrade/downgrade, locking, transaction rollback, query plans, all tenant API handlers, frontend adaptation, and production readiness. No database or PostgreSQL operation took place.

Credential rotation A–E remains **BLOCKED / NOT APPROVED**. No PostgreSQL, database, credential, DPAPI, service, cluster, ACL, or port was accessed or operated.
