# Phase 6 — Tenant-Aware API Pilot

**Status:** Pilot **IMPLEMENTED** and isolated SQLite API tests **PASS**. This is not full tenant isolation or production readiness.

## Selected workflow

The pilot is a tenant-scoped College profile read/update: `GET` and `PATCH /tenant/pilot/college-profile`. It was selected because it uses the new `College` and `CollegeMembership` entities directly, demonstrates an authorized read and a real persisted write, and does not touch legacy attendance, QR, GPS, face, guardian, student or teacher data.

The GET operation permits active membership roles `college_admin`, `teacher`, and `student`; PATCH permits only `college_admin`. The route derives `TenantContext` from the authenticated active database user and an active membership in an active College. Optional `college_id` query selection only works for a College that is already an active membership of the caller. Profile queries use only `context.college_id`; request bodies reject extra fields such as `college_id` or `status`.

An absent tenant schema returns a sanitized `503 Tenant pilot schema is unavailable` response. The draft schema has not been applied anywhere in this phase; a database without the College tables cannot use this pilot until a separately reviewed and approved migration is applied to its intended target.

## Cross-college denial

College A cannot select College B unless it also holds an active B membership. The API tests verify a denied cross-college GET, a denied PATCH, and that College B's stored display name stays unchanged after the denied write. A user with multiple active memberships must select one; an omitted selection returns 409. Inactive memberships, suspended Colleges, missing memberships, unauthorized roles, unauthenticated callers, and Super Admin platform principals are denied.

## Frontend

No pilot UI was added. The route is a backend capability and the backend test suite exercises it with signed bearer tokens and synthetic database rows; frontend guards are not relied on for authorization.

## Legacy compatibility and limits

All pre-existing business routers remain unchanged and unscoped. The pilot does not make them tenant-safe. Unassigned legacy Admin login continues to work and retains existing Admin API behavior; the same unassigned user is denied the pilot due to no explicit membership. Super Admin remains denied both College context and legacy Admin API access.

## Database and acceptance limits

The PostgreSQL draft remains **DRAFT / NOT APPLIED**. No PostgreSQL connection, migration, backfill, real College row, role conversion, production record write, build, dependency installation, or cache clear was performed. The full suite used isolated SQLite only; PostgreSQL compatibility is **NOT TESTED**. Legacy ownership remains **UNKNOWN**.

Detailed cases and results: `TENANT_PILOT_SECURITY_TESTS.md`; exact commands and regression limits: `TEST_RESULTS.md`.
