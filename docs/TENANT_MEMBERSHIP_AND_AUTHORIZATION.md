# Tenant Membership and Authorization

**Status: IMPLEMENTED foundation; legacy business routers remain NOT TENANT-SCOPED.**

## Membership lifecycle service

`backend/app/membership_service.py` provides internal, transaction-scoped grant operations; it does not expose registration, invitation, or membership HTTP routes.

- A verified database `super_admin` can create a **pending** initial `college_admin` membership. This platform operation does not grant the actor college access.
- A caller with an active `college_admin` membership may create pending `teacher` or `student` memberships only in that same active College.
- Platform or in-college authority is rechecked against database state; caller-supplied role claims are not sufficient.
- Activation is explicit and records actor/time. A College Admin can activate teacher/student membership in the same active College; platform Super Admin may perform the explicit provisioning operation.
- Revocation requires a reason and records actor/time; College Admins can revoke teacher/student memberships in their own College. Platform Super Admin has a separate explicit platform lifecycle operation.
- Existing pair membership, even revoked, is not duplicated. Lifecycle services flush but leave transaction commit/rollback to their caller.

## Request context

`backend/app/tenant_context.py` resolves a frozen `TenantContext` only from an authenticated user ID plus an active membership and active College. A requested College ID selects among the caller's memberships; it never proves permission. No membership returns 403; multiple memberships with no selection returns 409; missing/inactive membership, inactive College, role mismatch, or Super Admin role without a College membership fails closed.

`get_tenant_college` is a minimal scoped read example that takes only the resolved context. New business routes must query using `context.college_id`, scope writes and reads by tenant, and validate same-tenant parent links. Existing routers are intentionally unchanged until records have verified ownership and endpoint-by-endpoint tenant scoping is implemented.

## Role boundaries

`super_admin` remains a platform authority and is explicitly denied by the College context resolver. The legacy `admin` role remains unchanged and does not itself confer tenant access. A user may use college operations only when a separate, active, authorized membership exists; its membership role determines the operation.

## Limits

No platform audit-event table, HTTP management workflow, invite acceptance, email verification, tenant query filtering across business APIs, or PostgreSQL RLS is implemented. This is an authorization foundation, not full tenant isolation or production readiness.
