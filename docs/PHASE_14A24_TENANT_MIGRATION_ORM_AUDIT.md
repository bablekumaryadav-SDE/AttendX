# Phase 14A.24 — Tenant Migration and ORM Consistency Audit

**Date:** 2026-11-10
**Status:** PASS WITH DESIGN RISKS; migration remains DRAFT / NOT APPLIED
**Scope:** Read-only comparison of `DRAFT_20261109_add_tenant_ownership_v1.sql`, ORM metadata, tenant helpers/callers, static tests, and existing migration planning docs. No SQL was executed and no database was contacted.

## Summary

The ownership draft statically matches the ORM's twelve nullable ownership columns, their integer types, College references, same-College composite references, parent composite unique keys, tenant indexes, and declared delete actions. The migration also preserves the documented `public.users(id INTEGER NOT NULL PRIMARY KEY)` prerequisite through its foundation dependency; the Phase 13B fixture models only that empty parent key.

No migration or model changes were made. This is not PostgreSQL parser or execution validation. Review uncovered two design/readiness issues that remain unresolved: the draft is only applicable to a compatible existing schema, not an empty database; and notification Student deletion has an ownership-semantic consequence described below. In addition, `bind_new_record_to_context` currently has no production business-write caller, so ORM ownership columns being nullable does not by itself make any future write path tenant-safe.

## Model-to-migration comparison

| ORM model/table | Ownership column | Draft counterpart | Parent/same-College relationships | Index / uniqueness | Ownership classification |
|---|---|---|---|---|---|
| `Student` / `students` | `college_id INTEGER NULL` | `ADD COLUMN ... INTEGER`; `fk_students_college` → `public.colleges(id) ON DELETE RESTRICT` | Parent composite key `(id, college_id)` named `uq_students_id_college` | `ix_students_college_id (college_id,id)`; unique `(id,college_id)` | New records can be assigned only after a future verified context write path; existing NULL ownership remains UNKNOWN; current read API excludes NULL |
| `Teacher` / `teachers` | `INTEGER NULL` | Matching College FK, RESTRICT | `uq_teachers_id_college` | `ix_teachers_college_id`; matching unique pair | Same as Student |
| `Subject` / `subjects` | `INTEGER NULL` | Matching College FK, RESTRICT | `uq_subjects_id_college` | `ix_subjects_college_id`; matching unique pair | Same as Student |
| `Class` / `classes` | `INTEGER NULL` | Matching College FK, RESTRICT | `uq_classes_id_college` | `ix_classes_college_id`; matching unique pair | Same as Student |
| `TeacherAssignment` / `teacher_assignments` | `INTEGER NULL` | Matching College FK, RESTRICT | `(teacher_id,college_id)`, `(subject_id,college_id)`, `(class_id,college_id)` composite FKs, all RESTRICT | `uq_teacher_assignments_id_college`; `ix_teacher_assignments_college_active` | Requires verified ownership of Teacher, Subject, and Class parents; existing NULL remains UNKNOWN |
| `StudentClassAssignment` / `student_class_assignments` | `INTEGER NULL` | Matching College FK, RESTRICT | Student and Class composite FKs, RESTRICT | `uq_student_class_assignments_id_college`; `ix_student_class_assignments_college_active` | Requires verified Student and Class parents; existing NULL remains UNKNOWN |
| `Attendance` / `attendance` | `INTEGER NULL` | Matching College FK, RESTRICT | Student and Teacher composite FKs, RESTRICT | `uq_attendance_id_college`; `ix_attendance_college_date` | Requires verified Student and Teacher parent ownership; existing NULL remains UNKNOWN |
| `AttendanceRecord` / `attendance_records` | `INTEGER NULL` | Matching College FK, RESTRICT | Student, Teacher, Subject, Class composite FKs, RESTRICT | `uq_attendance_records_id_college`; `ix_attendance_records_college_date` | Requires all four verified parent owners; existing NULL remains UNKNOWN |
| `AttendanceSession` / `attendance_sessions` | `INTEGER NULL` | Matching College FK, RESTRICT | Teacher, Subject, Class composite FKs, RESTRICT | `uq_attendance_sessions_id_college`; `ix_attendance_sessions_college_status_start` | Requires verified parent ownership; includes sensitive session data and is not safe to expose outside its gated API |
| `AttendanceEvent` / `attendance_events` | `INTEGER NULL` | Matching College FK, RESTRICT | Session and Student composite FKs, RESTRICT | `uq_attendance_events_id_college`; two College-leading query indexes | Requires verified Session and Student owners; sensitive evidence remains gated |
| `NotificationEvent` / `notification_events` | `INTEGER NULL` | Matching College FK, RESTRICT | `(student_id,college_id)` composite FK with `ON DELETE SET NULL` | `uq_notification_events_id_college`; `ix_notification_events_college_created` | Requires verified Student owner for student-linked event; existing account/global and legacy events stay unassigned |
| `AttendanceAuditLog` / `attendance_audit_logs` | `INTEGER NULL` | Matching College FK, RESTRICT | No business parent composite FK in the draft | `uq_attendance_audit_logs_id_college`; `ix_attendance_audit_logs_college_created` | Requires verified event context to assign; platform/system and legacy audit rows remain UNKNOWN/global and not tenant-exposed |

All twelve ownership columns are nullable, unqualified only in ORM metadata (which resolves the College model table), and explicitly `public` in SQL. ORM single-column ownership FKs do not declare explicit names; SQL gives them stable names `fk_<table>_college`. This is naming drift, not a target/behavior mismatch, but database naming conventions should be chosen before migration freeze. The 17 composite FK declarations and their referenced column order match ORM metadata. Their names also match. Their referenced parent `(id,college_id)` unique constraints are present in both ORM and SQL. All owner FK types are integer.

The draft adds 12 `(id,college_id)` unique constraints and 12 direct College FKs, plus 17 composite FKs. It adds 13 College-leading indexes matching the ownership-related ORM indexes. Other pre-existing single-column indexes and business unique constraints are not added by this ownership-only migration; this draft does not reconcile existing global uniqueness such as Student identifiers or Subject code. No mismatch was inferred for those unchanged constraints.

### College and membership foundation

`College` and `CollegeMembership` are created by the prerequisite `DRAFT_20261105_add_tenant_foundation_postgresql_v2.sql`, not by this ownership draft. The foundation creates College before memberships, requires the existing `public.users(id)` as `INTEGER NOT NULL PRIMARY KEY`, and aligns membership FK targets, role/status checks, unique `(user_id,college_id)`, indexes and delete actions with ORM metadata. The ownership draft preflights `colleges` and every business table it alters, checks simple `id` primary keys and INTEGER reference columns, and does not create its prerequisites.

| Concern | Audit result |
|---|---|
| Existing user parent | Foundation draft requires `public.users(id INTEGER NOT NULL PRIMARY KEY)`; Phase 13B fixture has only this zero-row shape. It is not a copy of legacy user data/schema. |
| Empty database applicability | **Not applicable / incompatible:** ownership draft requires Colleges and twelve existing business tables/columns. The ownership migration cannot build a complete schema from empty. A separately prepared compatible baseline is required. |
| Existing legacy schema | Preflight checks required tables, absence of `college_id`, simple `id` PKs, and INTEGER relationship columns. It does not establish semantic correctness or inspect production catalogs/data; actual compatibility remains UNKNOWN until an approved isolated rehearsal. |
| Transaction/failure behavior | `BEGIN`/`COMMIT` and preflight before first `ALTER TABLE` are present. PostgreSQL DDL transaction rollback is assumed by the draft, not exercised here. Ordinary index creation/ALTERs may hold locks; there is no explicit lock/statement timeout or lock-duration evidence. |
| Idempotency | Not repeatable: existing `college_id` causes preflight failure and named constraints/indexes use plain CREATE. After interruption or uncertain result, inspect catalogs and reconcile; do not rerun blindly. |
| `NOT VALID` constraints | Draft intent is to add constraints without scanning/rejecting every legacy row immediately. They do not assign ownership. PostgreSQL runtime enforcement/validation behavior was not tested here. |
| Downgrade | Comments specify manual reverse only after confirming all ownership values NULL and no dependent tenant data. Dropping non-NULL `college_id` values destroys tenant ownership data. The downgrade is intentionally not executable SQL and has no automated rollback. |

## Ownership helper and write-path readiness

`resolve_college_record` fails closed if the model lacks `college_id`, scopes ID and College together, and maps NULL/foreign/missing to the same 404. `require_same_college` rejects absent or differently owned parents. `reject_college_payload` prevents caller-supplied ownership; `bind_new_record_to_context` binds a new instance to resolved context only after validation. In this repository, `bind_new_record_to_context` is defined and covered by unit tests but has **no production business-write caller**. No business creation route in this audit demonstrates a complete end-to-end context-bound create flow. The profile PATCH only updates College `display_name` and is not a business ownership write.

| Model group | Safe ownership rule for future writes | Current legacy rows | API readiness |
|---|---|---|---|
| Student, Teacher, Subject, Class | Assign only from an authenticated, active membership context; reject client `college_id` | NULL means UNKNOWN; no backfill | Existing read-only routes filter owner; no tenant business writes enabled |
| TeacherAssignment, StudentClassAssignment | Verify each referenced teacher/student/class/subject belongs to the resolved College, then bind assignment | NULL remains UNKNOWN; parent relationship history may be unverified | Not safe to create until all parent checks exist in a reviewed write path |
| Attendance, AttendanceRecord | Verify all same-College entities and applicable assignment/enrollment links before write | NULL/inconsistent legacy relationships remain UNKNOWN | Read-only queries exclude missing/inconsistent parent chains; writes gated |
| AttendanceSession, AttendanceEvent | Verify same-College teacher/subject/class and session/student; protect QR/biometric evidence | NULL remains UNKNOWN | Not safe for tenant exposure until write and sensitive-data policy are separately reviewed |
| NotificationEvent | Verify event/recipient ownership and explicit platform-vs-College scope | NULL remains global/legacy/UNKNOWN | No enabled tenant notification route; destructive SET NULL semantics need resolution |
| AttendanceAuditLog | Bind only from verified event context; retain platform/system events without inferred College | NULL remains system/platform/legacy/UNKNOWN | No enabled tenant audit route |
| `StudentGuardian` | Ownership is inherited through verified Student; no direct `college_id` column | Student ownership may be UNKNOWN | Not tenant-safe where Student owner is unknown; no direct migration ownership field |
| `StudentIdCounter` | Current model has no College field; tenant-local identifier semantics require separate decision | Existing counter is global by year | Not tenant-safe for College-local numbering; excluded from this migration |

No default College, ownership backfill, membership creation, global-role promotion, or draft change was made.

## Findings / proposed corrections

1. **Naming consistency — low impact / safe to defer:** ORM direct College FKs are unnamed while SQL names them `fk_<table>_college`. This does not change referential behavior. Proposed: choose and encode a naming convention in metadata or migration before freezing the schema; no correction made in this audit.
2. **Notification deletion semantics — design risk:** Both ORM and draft declare the composite `(student_id,college_id)` FK with `ON DELETE SET NULL`. PostgreSQL's default action applies to referencing columns in that FK; deleting a referenced Student can therefore clear both the student reference and tenant owner. That converts a previously College-owned notification into NULL/UNKNOWN ownership and may make it invisible to tenant-scoped queries. The model also has a separate Student FK with `SET NULL`, and the College FK is `RESTRICT`. Proposed minimal decision: either use `RESTRICT` for the composite student relationship, or explicitly design a selective nulling rule that preserves `college_id` and represent it consistently in SQL and ORM. Requires schema/design approval; unchanged and untested.
3. **Creation path readiness — blocker before enabling writes:** `bind_new_record_to_context` has no production business-write caller. Any future write route must perform context validation, parent checks where applicable, payload rejection, and transaction handling before persistence. No route was added.
4. **Baseline limitation:** The ownership draft is additive to an existing schema and cannot be applied to the empty Phase 11 databases or an otherwise empty schema. It needs a compatible pre-existing baseline and separate approved disposable target.
5. **Locking and failure rehearsal:** No PostgreSQL parser or server validation, lock-duration measurement, interruption/rollback rehearsal, or catalog verification was performed. Keep execution blocked pending explicit approval and isolated PostgreSQL rehearsal.

## Validation

All commands ran from `backend` using the existing parent project virtual environment. The dotenv opt-out and explicit synthetic URL were set for test/import commands:

```powershell
$env:ATTENDX_SKIP_DOTENV='1'
$env:ATTENDX_TEST_SQLALCHEMY_URL='sqlite://'
..\.venv\Scripts\python.exe -m unittest tests.test_tenant_ownership_migration_static tests.test_tenant_migration_static -v
..\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_tenant*.py'
..\.venv\Scripts\python.exe -c "import ast, pathlib; files=[pathlib.Path('app/models.py'),pathlib.Path('app/tenant_context.py'),pathlib.Path('app/tenant_ownership.py'),pathlib.Path('app/membership_service.py'),*pathlib.Path('app/api').glob('tenant_*.py'),pathlib.Path('tests/test_tenant_ownership_migration_static.py'),pathlib.Path('tests/test_tenant_migration_static.py')]; [ast.parse(p.read_text(encoding='utf-8-sig'),filename=str(p)) for p in files]; print('AST PASS',len(files),'files')"
..\.venv\Scripts\python.exe -c "import importlib.util; print({n:importlib.util.find_spec(n) is not None for n in ('pglast','pg_query','sqlglot','sqlparse')})"
```

- Focused static migration contracts: **11 passed, 0 failed**.
- Complete tenant suite: **125 passed, 0 failed**. Synthetic SQLite and static file contracts only.
- Python AST: **PASS**, 14 relevant model/helper/tenant-router/test files parsed.
- SQL parser availability: **NOT TESTED**; no `pglast`, `pg_query`, `sqlglot`, or `sqlparse` installed. No parser was installed.
- PostgreSQL syntax/execution/catalog/locking: **NOT TESTED**. SQLAlchemy metadata inspection and SQLite tests are not PostgreSQL proof.
- `git diff --check`: **PASS**, Git printed pre-existing LF-to-CRLF working-copy advisories for unrelated files.
- Scoped whitespace scan: **PASS**, four Phase 14A.24 files.
- Frontend tests/build: **NOT RUN**; no frontend files changed.

An initial test attempt with the global Python failed to import missing FastAPI/SQLAlchemy (environmental, no assertions ran). The backend-local venv had an incompatible Starlette TestClient requiring missing `httpx2`; no package installation was attempted. The successful runs used the existing parent project venv and emitted Starlette/httpx and SQLite datetime deprecation warnings, not assertion failures.

## Worktree and safety

Git status before this phase contained extensive unrelated modified and untracked files, including prior Phase 14A.23 work and backups. Phase 14A.24 changed only this report, `docs/TEST_RESULTS.md`, and `docs/FINAL_ACCEPTANCE_REPORT.md`; no migration, ORM, helper, route, test, or frontend source was altered. No PostgreSQL/database connection, SQL execution, migration, credential/DPAPI/secret access, `.env` inspection, service/cluster/port/ACL/firewall operation, dependency install, commit, push, or destructive Git operation occurred.

Tenant migration: **DRAFT / NOT APPLIED**. Credential rotation A–E: **BLOCKED / NOT APPROVED**. Production API endpoint: **UNKNOWN**. PostgreSQL compatibility: **NOT TESTED**. Production readiness: **NOT CLAIMED**.
