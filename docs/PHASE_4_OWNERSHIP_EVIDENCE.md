# Phase 4 — Legacy Ownership Evidence and PostgreSQL Test Environment

## Scope and outcome

This phase reviewed the checked-in ORM and SQL migration definitions, documented the current ownership evidence gap, prepared a blank evidence template, and added an isolated reconciliation preview that accepts only explicit synthetic or exported JSON input. No database connection, row query, migration, account creation, role change, backup, restore, or production readiness assessment was performed.

The repository contains no verified legacy institution identity or record-level ownership evidence. Therefore ownership of every existing record and the number of represented institutions remain **UNKNOWN**. This is a hard blocker to tenant backfill and migration.

## Schema evidence inventory

The inventory below is based on source definitions only. “Declared relationship” means a modeled/SQL foreign key; other associations are conventions and are not proof of valid data.

| Entity | Source-defined keys and relationships | Tenant evidence |
|---|---|---|
| `users` | Integer PK; no profile FK. Email is globally unique; role is a global string. | No institution key. Super Admin is a distinct role; existing college Admin APIs continue to require `admin`. |
| `students` | Integer PK; student code, email, and roll number have global uniqueness. No user FK is declared. | No institution key. Some API paths associate by email, which is not ownership evidence. |
| `teachers` | Integer PK; email and employee ID have global uniqueness. No user FK is declared. | No institution key. Some API paths associate by email. |
| `student_id_counters` | Year-based PK/counter. | No tenant dimension. |
| `classes` | Integer PK; GIS coordinates and geofence settings are stored on this entity. | No institution key. GIS is not a separate ownership entity. |
| `subjects` | Integer PK; subject code is globally unique. | No institution key. |
| `teacher_assignments` | Integer PK; teacher, subject, and class IDs are plain columns without declared FKs in the current model. | Implied links only; no institution key. |
| `student_class_assignments` | Integer PK; declared FKs to students and classes. Current migration adds a partial uniqueness rule for an active student assignment. | No institution key. |
| `attendance` | Integer PK; student and teacher IDs are plain columns. | Implied links only; no institution key. |
| `attendance_records` | Integer PK; student, teacher, subject, and class IDs are plain columns. | Implied links only; no institution key. |
| `attendance_sessions` | Added by migration; FKs to teacher, subject, and class; stores QR/session secret, expiry, and location snapshot. | No institution key. QR state is part of sessions; there is no separate QR entity. |
| `attendance_events` | Added by migration; FKs to session and student; unique session/student pair. | No institution key. |
| `attendance_audit_logs` | Added by migration; user FK with set-null behavior; entity type/ID are polymorphic values, not an FK. | No institution key. |
| `face_embeddings` | Integer PK; unique student FK with cascade delete; global image hash uniqueness; stores image bytes and embedding data. | No institution key. Sensitive biometric data requires a separately reviewed tenant and consent design. |
| `student_guardians` | Added by migration; student PK/FK with cascade delete; one guardian contact per student. No Guardian user entity is defined. | No institution key. |
| `notification_events` | Integer PK; nullable user/student FKs with set-null behavior; globally unique idempotency key. | No institution key. |
| Reports/analytics | Derived from current records; no separate report model found in the inspected schema. | Tenant scoping must follow all source entities once designed. |

The entity names accepted by the preview utility are allowlisted in `backend/scripts/reconciliation_preview.py`. That list does not constitute data inventory or evidence that production has only these tables; operators must reconcile it against the actual reviewed database catalog before use.

## Ownership evidence handling

Use [the blank legacy ownership template](LEGACY_COLLEGE_OWNERSHIP_TEMPLATE.md). It requires official institution identity, reproducible source IDs, evidence provenance, relationship closure, conflict/orphan handling, and independent review. Do not use email domain, local configuration, current admin status, row names, or a presumed single college as evidence. Keep sensitive extracts outside Git and omit credentials, face data, and unnecessary personal information.

The reconciliation preview is database-free. It validates integer source IDs, allowlisted entity names, parent references, opaque evidence/institution references, duplicate IDs, missing/orphan parent references, unmapped records, and conflicting/cross-parent proposals. It emits only allowlisted IDs/references and findings. Every proposal remains `UNAPPROVED` or `CONFLICT`; the report always says `ownership_assignments_applied: false`. It cannot connect to the application or approve/backfill ownership. Its tests use synthetic data only.

## PostgreSQL environment readiness

Local inspection found a PostgreSQL URL configured in `backend/.env`; only non-secret connection-shape facts were inspected. It appears loopback/local, but it is not verified as disposable and was not used. No explicit dedicated test URL was present in that file. PostgreSQL client/server utilities (`psql`, `pg_dump`, `pg_restore`, `initdb`, `pg_ctl`, `createdb`) and Docker were unavailable on PATH. No isolated test cluster or restore rehearsal is verified.

Follow [the isolated PostgreSQL test setup guide](POSTGRESQL_TEST_ENVIRONMENT_SETUP.md) and [the backup/restore rehearsal guide](POSTGRESQL_BACKUP_RESTORE_REHEARSAL.md) before any future database-backed test. The existing local URL must not be assumed safe. Never point test setup or migration work at it without independently identifying and approving the target.

## Readiness decision

The migration gate is **BLOCKED**. Official institution identity, record-level ownership evidence, source row/orphan/conflict counts, test PostgreSQL setup, and backup/restore rehearsal are all unverified. The draft migration readiness gates are in [the checklist](TENANT_MIGRATION_READINESS_CHECKLIST.md). No production readiness claim is made.
