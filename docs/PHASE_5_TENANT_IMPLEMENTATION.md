# Phase 5 — Tenant Foundation Implementation

**Status:** Code-level foundation **IMPLEMENTED**. PostgreSQL schema **DRAFT / NOT APPLIED**. Full tenant isolation and production readiness **NOT IMPLEMENTED**.

## Delivered

- Added `College` ORM entity with stable unique slug, official/display names, four lifecycle states and timestamps. No sample, default or real College is inserted.
- Added `CollegeMembership` ORM entity with explicit role/status, user/College FKs, pair uniqueness, lifecycle actor/time/reason fields and indexes. `User.role` remains unchanged.
- Added `resolve_tenant_context`, which reloads an active user from the database and requires exactly one selected active membership and active College. A client College ID selects only among that user's memberships. Missing/inactive membership, suspended College, role mismatch, ambiguous context and Super Admin platform role fail closed.
- Added an example scoped College read and internal membership create/activate/revoke services. No public enrollment/invitation API was exposed. Membership actions record actor/time; college admins can manage only teacher/student memberships in their own active College. Super Admin lifecycle actions are explicitly platform operations and do not confer tenant data access.
- Added isolated SQLite tests for model validation/constraints, lifecycle, active/inactive memberships, ambiguous selection, tenant spoofing, role boundaries, Super Admin/legacy Admin separation and scoped reads.
- Added an additive PostgreSQL DDL draft. It creates only new tables and indexes, inserts no College, changes no legacy records, and is clearly marked **DRAFT / NOT APPLIED**.

## Legacy preservation

Existing login and business routers were left unchanged. No legacy user is automatically converted to a membership. No record receives an inferred College ID. Attendance, face, GPS, QR and guardian data were not edited. The future unassigned-row process is documented in `LEGACY_UNASSIGNED_DATA_POLICY.md`.

The Super Admin role remains distinct from existing global `admin`: it does not inherit existing `/admin-*` access or gain a College context. The legacy `admin` role alone does not authorize tenant membership operations. An active explicit college membership is required.

## Verification

| Check | Status | Result |
|---|---|---|
| Tenant foundation tests | PASS | 12 isolated SQLite tests; full backend suite includes all 12. |
| Existing backend regression | PASS | 80 tests passed, 0 failures/errors; final rerun 11.103 seconds. Includes existing authentication and attendance tests. |
| Frontend serial suite | PASS | 28 passed, 0 failed/skipped; no frontend tenant implementation added. |
| PostgreSQL DDL compatibility | NOT TESTED | PostgreSQL unavailable; SQLite does not prove PostgreSQL compatibility. |
| Cross-tenant API isolation across legacy routers | NOT IMPLEMENTED | Legacy routers remain unchanged and are not tenant-scoped. |
| Migration and production DB operations | NOT RUN | No DB connection, migration, backfill or write. |

Exact successful commands and source syntax checks are in `TEST_RESULTS.md`.

## Blockers and next work

Legacy ownership remains **UNKNOWN**. PostgreSQL disposable test environment and restore rehearsal remain **BLOCKED / NOT TESTED**. Before using the draft: review against the actual PostgreSQL schema, verify restore into a disposable target, run draft DDL and rollback only there under separate authorization, then add tenant-aware repository/API scoping and PostgreSQL cross-tenant tests. Do not claim full isolation or production readiness from these model/service tests.
