# Phase 14A.25 — Tenant Schema Risk Resolution Design

**Date:** 2026-11-10
**Status:** DESIGN COMPLETE WITH BLOCKERS; tenant schema remains DRAFT / NOT APPLIED
**Scope:** Static source and documentation review only. No database was contacted, no SQL was executed, and no schema or application write route was changed.

## Scope, evidence and limits

Reviewed the Phase 14A.24 audit and its cited model/migration comparison, tenant planning and acceptance reports, the Phase 14A.25 V6 continuation request, and the source inventory listed below. `backend/create_admin.py` was explicitly excluded from inspection: it was not opened, executed, copied, printed, or modified in this continuation. A prior report's statements about that file are historical and were not reverified here. No credential or secret was inspected. No `.env`, DPAPI, database configuration value, PostgreSQL process, service, cluster, or port was accessed.

Source reviewed: `backend/app/models.py`; `backend/app/services/student_module.py`; `backend/app/services/attendance_core.py`; `backend/app/membership_service.py`; `backend/app/tenant_ownership.py`; `backend/app/tenant_context.py`; `backend/app/tenant_api_gate.py`; `backend/app/main.py`; API files `students.py`, `teachers.py`, `classes.py`, `subjects.py`, `assignments.py`, `attendance.py`, `attendance_records.py`, `attendance_sessions.py`, `guardians.py`, `notifications.py`, `tenant_pilot.py`, plus the registered tenant routers; `backend/create_tables.py`; tests `test_admin_crud_isolated.py`, `test_tenant_ownership_isolated.py`, `test_tenant_ownership_migration_static.py`, and `test_tenant_migration_static.py`; the tenant foundation/ownership drafts and historical SQL migration files cited below; and Phase 12–14A.24 design, test and acceptance documentation. No SQL parser was run and no SQL was executed.

### 1. Notification composite-FK deletion behavior

The ORM and ownership draft define `(student_id, college_id) -> students(id, college_id)` with `ON DELETE SET NULL`. A composite referential action applies to the referencing columns of that constraint; absent a selective column list, deletion can null **both** `student_id` and `college_id`. The separate `student_id -> students.id ON DELETE SET NULL` FK does not preserve College attribution. The independent College FK is `RESTRICT`, but it cannot prevent the composite action from clearing `college_id` first. Thus a previously attributed notification can become NULL/UNKNOWN and leave tenant-scoped visibility while its historical event remains.

Current legacy student deletion is soft deactivation (`is_active = false`), so it does not invoke physical FK deletion. This is compatible with retention while all actual deletion paths remain soft. However, a future hard-delete path would trigger the risk. The absence notification enqueue SQL in `attendance_sessions.py` does not supply `college_id`; under the ownership schema such rows remain NULL/UNKNOWN. Do not infer tenant ownership from a Student ID. Notifications routes remain behind default deny, and current notification tests do not prove PostgreSQL composite-delete behavior.

| Option | Integrity and retention | Tenant isolation / compatibility | Migration and rollback impact |
|---|---|---|---|
| Composite `RESTRICT` or `NO ACTION`, with soft student deactivation | Prevents hard deletion while linked notifications exist; preserves event and reference | Keeps College attribution; fits current soft-deactivation behavior | Constraint-only change; hard deletes become intentionally blocked. Downgrade restores the risky action; requires reviewed schema change and PG test |
| Keep `SET NULL`, enforce soft deletion | Current ordinary deactivation retains FK and College | Safe only while all code paths prohibit physical deletion; schema still permits future attribution loss | No schema change, but requires a demonstrable hard-delete prohibition and regression tests; operational policy alone is weaker |
| Retain immutable notification snapshot and remove live Student FK | Event can persist after student deletion; snapshot can preserve College and relevant display/audit context | Can retain tenant attribution, but requires explicit tenant field and careful response/query isolation; privacy/data-minimization policy needed | Redesign and data migration; rollback may not recover deleted source linkage |
| Selectively null only `student_id` or use a separate optional link table | May retain `college_id` while allowing Student deletion | Potentially preserves tenant filtering; exact PostgreSQL/ORM support and semantics need version-specific review | Candidate only; parser/PG integration evidence and ORM representation required before choosing |

**Recommendation (design only):** use composite `RESTRICT`/`NO ACTION` and retain soft deactivation as the supported lifecycle unless a product/privacy decision requires hard deletion. Do not implement until the constraint semantics and deletion policy are separately approved and tested on PostgreSQL. Keep NULL events excluded from tenant reads.

### 2. Tenant-safe write integration

`bind_new_record_to_context` is implemented and unit-tested, but no production business-write caller was found. The helper alone does not validate the authorization context, parent ownership, request payload, business invariants, or transaction boundary. The default-deny gate remains the controlling protection for legacy write routes. The College profile PATCH is the only currently enabled tenant write and is restricted to `display_name`; it is not a business-record creation path.

| Model / write path | Ownership assignment and required parents | Existing source path / current status | Readiness |
|---|---|---|---|
| College profile | Resolved active College context; allowlisted `display_name` only | `tenant_pilot.py`; explicit tenant pilot PATCH | Enabled narrowly; not a business-row write |
| Student | Bind from active College context; reject payload College; validate user/account relationship and uniqueness | Legacy `POST /students/`, gated; creates User and Student, uses global code generator | NOT READY |
| Teacher / User | Bind Teacher from context; define safe account provisioning and prevent global-role promotion | Legacy `POST /teachers/`, gated; creates User + Teacher | NOT READY |
| Class | Bind context; validate any academic parent/configuration in same College | Legacy `POST /classes/`, gated; omits College | NOT READY |
| Subject | Bind context; validate relevant academic parent in same College | Legacy `POST /subjects/`, gated; omits College | NOT READY |
| TeacherAssignment | Bind context; Teacher, Subject and Class must each resolve to same College | Legacy assignment create, gated; parent status checks do not establish tenant equality | NOT READY |
| StudentClassAssignment | Bind context; Student and Class same College; define active/session semantics | Legacy class-assignment endpoint, gated | NOT READY |
| Attendance | Bind context; Student and Teacher same College, plus assignment policy | Legacy attendance create, gated; no tenant binding | NOT READY |
| AttendanceRecord | Bind context; Student, Teacher, Subject, Class and applicable assignment/enrollment relationships same College | Legacy record create, gated; relationships are not atomically tenant-validated | NOT READY |
| AttendanceSession | Bind context; Teacher, Subject, Class and matching assignment same College | Legacy raw-SQL session create, gated; no College context | NOT READY |
| AttendanceEvent | Inherit College from verified Session; Student same College; protect QR/face evidence | Legacy session event writes, gated | NOT READY |
| FaceEmbedding | Inherit only from verified Student; additionally consent, retention and access policy | Face registration route gated | NOT READY |
| StudentGuardian | Inherit verified Student ownership; validate guardian identity/relationship and one-to-one policy | Legacy guardian API gated | NOT READY |
| NotificationEvent | Explicit College scope from verified event/recipient; account/global events remain NULL | Absence enqueue omits College; notifications gated | NOT READY; deletion semantics unresolved |
| AttendanceAuditLog | Set College only from verified tenant operation; system/platform events remain NULL | Existing helper defaults College absent; legacy callers do not supply tenant context | NOT READY |

There are no automatic College or membership creation paths to authorize. No legacy ownership, enrollment, or role is promoted by this review. Before enabling any business write, require a per-route transaction design, caller-context binding, parent validation, payload allowlist, conflict behavior, authorization negative tests, and default-deny inventory review.

### 3. StudentIdCounter ownership

`StudentIdCounter` is global by year (`year` primary key and `last_number`). `next_student_code` generates `ATX-{year}-{number:04d}` and uses a PostgreSQL advisory transaction lock keyed by year with insert-on-conflict and row update behavior. Student create calls this generator. Student `student_code`, `email`, and `roll_number` have global uniqueness in current model metadata. No dedicated counter tests were found in the inspected set; the CRUD test that reaches legacy class creation currently fails earlier because the gate intentionally blocks that route. No counter behavior was executed against PostgreSQL.

| Design | Benefits | Risks / compatibility | Migration and concurrency |
|---|---|---|---|
| Global year counter | Preserves current globally unique code format and simple lookup | One shared sequence/hotspot; college cannot infer from code; does not meet college-local roll-number requirement | Smallest compatibility impact; existing advisory-lock strategy serializes per year; still needs PG concurrency test |
| College-scoped counter | Reduces cross-college coupling; aligns identifiers to institution | Same visible `ATX-year-number` format can collide under existing global unique constraint; requires College namespace or changed uniqueness and legacy collision audit | New College dimension and unique key; concurrency lock must include College; existing numbers cannot be reassigned automatically |
| College + academic-session counter | Matches academic enrollment cycles and tenant semantics | Requires session identity/lifecycle, rollover rules, display format, duplicate policy and historical continuity decisions | Most schema/product work; lock key must include College/session; old records require explicit mapping, never inferred |

**Recommendation (defer decision):** preserve the global generator until product and identity policy is approved. If identifiers are College-local, design a stable collision-free identifier and explicit College + academic-session scope, including migration treatment of existing global identifiers and uniqueness constraints. V6 college-scoped roll numbers remain unimplemented. Do not alter counters or existing codes in this phase.

### 4. Installation paths and migration ordering

The repository has standalone SQL scripts and no central Alembic/version ledger identified. Historical migrations `20261101_add_session_face_attendance.sql`, `20261101_allow_session_close_method.sql`, `20261103_add_notification_events_postgresql.sql` (and SQLite companion), `20261104_add_classroom_gis_location_postgresql.sql`, and `20261105_add_student_guardians_postgresql.sql` assume pre-existing core application tables. The tenant foundation v2 draft creates Colleges/memberships and assumes `public.users(id INTEGER NOT NULL PRIMARY KEY)`. The ownership draft requires College plus twelve compatible business tables and relationships, and refuses existing `college_id`; it does not create a fresh application schema. Phase 13B's fixture supplies only a zero-row `users(id INTEGER NOT NULL PRIMARY KEY)` prerequisite and is not a complete legacy schema.

`backend/create_tables.py` calls SQLAlchemy `Base.metadata.create_all(bind=engine)`. It is a schema creation convenience, not an ordered/versioned migration runner and does not reconcile partially applied legacy SQL. It was inspected but not executed. It is not evidence of a supported fresh-install procedure. Avoid treating this helper as a migration baseline or applying ownership overlay to ORM-created schema where ownership columns already exist.

| Starting state | Safe design path (not execution authorization) | Status / stop condition |
|---|---|---|
| A. Existing compatible legacy schema | First establish schema version/catalog compatibility under separate approval. Reconcile historical SQL migration state using a reviewed ledger/manifest; apply missing prerequisite migrations in dependency order on a disposable copy; then foundation v2, then ownership draft only after ownership mapping and all prerequisites are approved. Capture/verify backup and compare schema/data invariants. | Actual schema and migration state UNKNOWN. No ledger; do not blindly replay scripts. Ownership remains UNKNOWN; mapping needed before ownership DDL. |
| B. Fresh empty database | Define and review a canonical baseline migration set that builds the full core schema and tracks versions; validate its ORM parity and install test, then layer tenant foundation and ownership only under an explicit plan. Decide bootstrap/admin and initial College/member creation separately. | No supported, verified canonical baseline found. `create_tables.py` alone is insufficient evidence. Fresh install support NOT ESTABLISHED. |
| C. Partial/incompatible schema | Stop automatic migration. Produce a catalog-only compatibility report after separate authorization; reconcile drift and partial effects manually into a new reviewed forward migration/repair plan; take a verified backup before any approved repair. | Do not use `IF NOT EXISTS` as proof of equivalence. Ownership draft is non-repeatable; no auto-repair or downgrade. Exact state UNKNOWN. |

**Ordering prerequisite:** core baseline and legacy SQL history → verify compatibility → tenant foundation v2 → separately approved ownership mapping/ownership migration. This is a proposed dependency shape, not a verified executable sequence; historical migrations and ownership draft have not been run together. PostgreSQL syntax, DDL locks, transaction rollback and interrupted-run recovery remain NOT TESTED.

### 5. Schema-freeze decision matrix

| Finding | Evidence | Risk | Recommended approach | Approval / phase | Verification required | Blocks |
|---|---|---|---|---|---|---|
| Notification FK can null tenant owner | ORM and draft use composite SET NULL; enqueue lacks explicit College | Historical events lose tenant attribution | Prefer RESTRICT/NO ACTION plus soft deactivation; or approve snapshot/link redesign | Schema/product approval before schema freeze | PostgreSQL delete behavior, ORM parity and retention tests | Schema freeze; tenant notification writes; migration rehearsal |
| No tenant-safe business create path | Context bind helper has no production caller; legacy writes gated and omit ownership | NULL or cross-College child creation | Implement per-route tenant transaction path after model rules | Separate feature/security approval | Negative tests and PG constraint rehearsal | Tenant-write enablement; migration rehearsal for writes |
| Counter scope undecided | Global-by-year generator + global unique identifiers | Collision or retroactive code change if scope changes | Keep current global until product identifier policy; design scoped form if required | Product/schema approval | Concurrency and migration collision analysis | Schema freeze for identifiers; tenant student creation |
| No canonical fresh-install/ledger process | Standalone migrations assume core tables; create_tables isn't a versioned baseline | Drift, order errors, unsafe reruns | Define versioned baseline/ledger and supported upgrade paths | Architecture approval before migration execution | Empty install, legacy upgrade, partial-state rehearsal | Schema freeze; PostgreSQL rehearsal; production migration |
| Legacy ownership is unknown | Nullable `college_id`; no approved mapping | Misattribution and data disclosure | Preserve NULL as UNKNOWN; require manual evidence-based reconciliation | Data-owner approval | Reproducible mapping review and row/key reconciliation | Ownership migration and production migration |
| ORM direct College FK names differ from SQL | Phase 14A.24 audit identified unnamed ORM vs named SQL FK | Introspection/naming drift | Choose stable constraint naming convention before freeze | Schema-review approval | Metadata vs PostgreSQL catalog comparison | Schema freeze |

**Readiness:** Schema freeze **BLOCKED** by notification deletion policy, identifier semantics, FK naming decision and absent canonical migration ledger/baseline. Tenant business writes **BLOCKED**; only the narrow College-profile PATCH remains enabled. PostgreSQL migration rehearsal **BLOCKED** until isolated administrator access and cluster recovery gates are resolved, plus a compatible disposable schema and backup plan. Production migration **BLOCKED** pending explicit ownership mapping, verified rehearsal, migration governance, rollback and production authorization. Credential rotation A–E remains **BLOCKED / NOT APPROVED**.

### V6 requirement alignment (24 areas)

Statuses are current source/documentation assessment, not runtime or product acceptance.

| # | Requirement area | Status | Alignment / remaining gap |
|---:|---|---|---|
| 1 | Preserve existing AttendX stack/site | PARTIAL | Existing React/Vite and FastAPI app retained; full V6 workflows and current browser acceptance not established. |
| 2 | Central web/API/database architecture | PARTIAL | One web/API architecture exists; deployment topology and production endpoint remain UNKNOWN. |
| 3 | PostgreSQL schema and migrations | BLOCKED | Standalone SQL, no central version ledger; tenant ownership draft NOT APPLIED; no PostgreSQL validation. |
| 4 | Super Admin, College Admin, Teacher, Student roles | PARTIAL | Tenant membership roles and separation are represented; full platform/College Admin workflows remain incomplete. |
| 5 | Super Admin bootstrap | BLOCKED / NOT TESTED | `backend/create_admin.py` explicitly excluded; no account or current script behavior verified in this phase. |
| 6 | College registration/review/approval | MISSING | No complete tenant onboarding/review workflow established. |
| 7 | College Admin invitation/activation | MISSING | No verified invitation/activation lifecycle. |
| 8 | Multi-College ownership/isolation | PARTIAL | Tenant context, gates and read APIs exist; migration draft unapplied and NULL ownership stays unknown. |
| 9 | Legacy ownership reconciliation | BLOCKED | Requires evidence-based manual mapping; no auto-assignment. |
| 10 | Role-based API authorization | PARTIAL | Membership context and default-deny gate present; no claim for unreviewed routes. |
| 11 | Role-specific dashboards | PARTIAL | Tenant and legacy pages coexist; full role workflows and platform APIs incomplete. |
| 12 | Teacher/student/guardian management | PARTIAL | Legacy creation exists but gated; guardian model/workflow is limited; no tenant-safe business writes. |
| 13 | Academic structure/timetable | PARTIAL | Classes, subjects and assignments exist; complete session/timetable model/workflow absent. |
| 14 | QR attendance | PARTIAL | Legacy session flow exists but write routes remain gated; tenant-safe write path not implemented. |
| 15 | GPS/GIS | PARTIAL | GIS code/tests exist; tenant write/production device validation absent. |
| 16 | Face verification | PARTIAL | Face pipeline and camera lifecycle tests exist; liveness, retention, consent and production validation remain gaps. |
| 17 | Attendance finalization/correction | PARTIAL | Legacy mechanisms exist; complete tenant policy/correction workflow not established. |
| 18 | Guardian notifications | PARTIAL | In-app event mechanisms exist; College attribution/deletion semantics and delivery are unresolved. |
| 19 | Reports/analytics | PARTIAL | Tenant summaries exist; broader reports/legacy analytics remain gated. |
| 20 | Security/privacy | NEEDS IMPROVEMENT | Default deny and membership controls exist; credentials blocked, privacy/security and production review outstanding. |
| 21 | Password recovery/MFA | MISSING | No complete verified recovery/MFA feature evidenced. |
| 22 | Public website/legal content | PARTIAL | Existing site retained; registration/legal and content acceptance incomplete. |
| 23 | Native Android | MISSING | No Android project in inspected paths; not tested on device. |
| 24 | Subscription, backup, deployment, performance and testing | PARTIAL / BLOCKED | Some scaffolding and historic backup drill exist; no production deployment/load validation; PostgreSQL and release gates remain. |

## Validation and exact outcomes

Commands from `backend` (PowerShell):

```powershell
$env:ATTENDX_SKIP_DOTENV='1'
$env:ATTENDX_TEST_SQLALCHEMY_URL='sqlite://'
..\.venv\Scripts\python.exe -m unittest tests.test_admin_crud_isolated tests.test_tenant_ownership_isolated tests.test_tenant_ownership_migration_static tests.test_tenant_migration_static -v
..\.venv\Scripts\python.exe -m unittest tests.test_tenant_ownership_isolated tests.test_tenant_ownership_migration_static tests.test_tenant_migration_static -q
..\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_tenant*.py'
```

- **FAIL (assertions; not environmental):** First mixed run, 21 tests: 19 passed, 2 failed. Both failures are stale `test_admin_crud_isolated` assertions expecting legacy `POST /classes/` to return operational create/update results; the default-deny gate correctly returns 503. These failures do not show a tenant-authorization defect and were not “fixed” by weakening the gate.
- **PASS:** Focused ownership/foundation static and synthetic tests rerun separately: 19 tests, 0 failures.
- **PASS:** Complete backend tenant suite: 125 tests, 0 failures, synthetic SQLite/static tests. This is not PostgreSQL compatibility evidence.
- **NOT TESTED:** PostgreSQL parser, database, migration, lock behavior, frontend/browser, real identity/ownership data. No SQL parser was invoked.

No code, migration or ORM changes were made. The two CRUD test failures remain visible and should be corrected in their own regression-test maintenance task, preserving the gate expectation.
