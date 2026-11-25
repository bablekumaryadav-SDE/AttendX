# Tenant Model Design

**Status: IMPLEMENTED in ORM source; PostgreSQL schema DRAFT / NOT APPLIED.**

## College

`College` maps to additive table `colleges` and uses the existing integer primary-key and timestamp conventions. It contains unique normalized `slug`, verified `official_name`, optional `display_name`, status (`pending`, `active`, `suspended`, `archived`), and created/updated timestamps. Construction or application startup does not insert a College. No real institution or default tenant is included.

## CollegeMembership

`CollegeMembership` maps to `college_memberships` with FKs to `users` and `colleges`, separate `role` and `status`, lifecycle timestamps/actor references, and reason metadata. Supported roles are `college_admin`, `teacher`, and `student`; states are `pending`, `active`, `suspended`, and `revoked`. A unique `(user_id, college_id)` constraint prevents duplicate memberships, including duplicate active ones. Revoked rows remain as the lifecycle record; the pair is not silently recreated. Reactivation/reinvite policy needs an explicit future decision.

The existing `User.role` and login behavior are unchanged. An `admin` account is not turned into a membership. `super_admin` remains a platform role and gains no college context by default.

Membership actor and lifecycle fields provide basic traceability, not an immutable security audit log. A later platform audit-event design must retain before/after state, reason, actor and timestamp under access controls.

## Database draft

`database/migrations/DRAFT_20261105_add_tenant_foundation_postgresql.sql` creates only the two new tables, indexes and constraints. It contains no inserts and does not alter legacy tables. It is explicitly **DRAFT / NOT APPLIED** and must be reviewed/rehearsed on isolated PostgreSQL before use. SQLite tests do not establish PostgreSQL compatibility.
