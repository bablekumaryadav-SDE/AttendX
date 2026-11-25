# Tenant Authorization Design

**Status: PROPOSED DESIGN ONLY. Tenant context and tenant isolation are not implemented.**

## Role distinction

| Principal | Scope | Intended authority | Current state |
|---|---|---|---|
| `super_admin` | AttendX platform | Explicit platform operations such as college review, suspension, subscription administration and platform audit. No implicit student/biometric/attendance access. | Shared login and `/platform` landing exist; no platform management APIs. Explicitly denied by legacy Admin APIs. |
| `admin` | Existing legacy single-college app | Existing legacy Admin operations until a reviewed migration. Do not silently rename or reinterpret this DB value. | `get_current_admin` requires exact `admin`; data currently has no tenant binding. |
| `college_admin` | One verified college membership (future permission name; not a current role value) | College-scoped user, academic structure, attendance policy, reports and settings. | Not implemented. Do not auto-convert legacy `admin`. |
| `teacher` | Verified college membership plus assigned classes/subjects | Assigned academic and attendance operations only. | Current role exists but no tenant membership scope. |
| `student` | Verified college membership plus own profile/enrollment | Own timetable, attendance, profile and notifications. | Current role exists but no tenant membership scope. |

### Permission matrix (target)

Legend: **Allow** only through a dedicated backend dependency/repository check. **Deny** by default.

| Operation family | Super Admin | Legacy `admin` | Future `college_admin` | Teacher | Student |
|---|---|---|---|---|---|
| Review/approve/suspend colleges | Allow with platform permission + audit | Deny | Deny | Deny | Deny |
| Manage platform admins/subscription plans | Allow with platform permission + audit | Deny | Deny | Deny | Deny |
| Read platform-wide operational aggregates | Allow minimized aggregate permission | Deny | Deny | Deny | Deny |
| Read student roster / manage academic records | Deny by default; time-limited audited support grant only if explicitly approved | Existing legacy behavior only; not tenant-safe for SaaS | Allow within active college | Assigned roster only | Own record only |
| Manage teacher/student accounts and college settings | Deny by default; no inheritance | Existing legacy behavior only | Allow within active college | Deny | Deny |
| Create/manage attendance sessions | Deny by default; platform scope is not classroom scope | Existing legacy behavior only | Allow within college | Assigned class/subject only | Deny |
| Submit attendance | Deny | Deny | Deny | Authorized manual action only | Own eligible enrollment only |
| Read attendance reports | Platform aggregate only with explicit permission; no raw sensitive detail by default | Existing legacy behavior only | College-scoped | Assigned scope | Own scope |
| Read face templates/raw images or precise student GPS | Deny by default | Existing legacy APIs only; sensitive access needs separate review | No default access; purpose-bound role only if approved | Deny | Own registration status only; raw templates never returned |
| Read guardian contacts / send notifications | Deny by default | Existing legacy behavior only | Verified relationship + college scope | Deny | Own verified relationship settings only |
| Read audit events | Platform audit permission, redacted | Legacy scope only | College events only | Own relevant events only | Own relevant events only |

Current legacy endpoints are not yet tenant-safe. The matrix describes the intended target, not current permissions or a grant to access legacy data.

## Tenant-context resolution

1. Validate JWT signature/expiry and load the active user from the database. Treat role claims in JWTs as informational only; current code already reloads the current DB role.
2. For a college-scoped request, resolve one active `college_membership` for the authenticated user. A tenant selector (route value or selected membership ID) may choose among the caller’s memberships, but the backend must find an active membership belonging to that user and an active college before constructing context.
3. Build an immutable request-scoped context containing `user_id`, `college_id`, `membership_id`, membership role, college status and permission set. Do not use a raw client `college_id` value as proof.
4. Requests with no membership, revoked membership, suspended college, mismatched role, ambiguous membership selection or stale session fail closed.
5. Platform endpoints use a separate `PlatformPrincipal` and explicit platform permission dependencies. Do not synthesize a college context for `super_admin` or route platform principals through legacy `get_current_admin`.
6. Every repository/API query includes the context `college_id`. Reads, updates and deletes constrain by both record ID and tenant ID. Creates derive `college_id` from context, never request payload.
7. Every child-parent relationship validates same-college ownership (prefer composite FKs plus explicit query checks). Return a consistent 404/403 policy that does not disclose another tenant's record existence.
8. Background jobs, report exports, file/object keys, audit events and notification events receive a typed context or explicit tenant key and revalidate it. Raw SQL must include tenant predicates; an ORM filter alone is not sufficient.

Do not trust a JWT tenant claim without current membership/college status validation. Do not allow selecting arbitrary tenant with a header and then checking only the resource ID. If database Row Level Security is later considered, it is defense-in-depth only: transaction-local tenant settings must be reliably cleared on pooled connections, and raw/admin operations need separate review.

## IDOR and cross-tenant safeguards

- Scope `SELECT`, `UPDATE`, `DELETE`, aggregates and counts by tenant; update/delete predicates include `(id, college_id)`.
- Use composite FKs so an assignment/session/event cannot pair a student from college A with a class/session from college B.
- Resolve QR session first and verify token/session/context college binding before replay, enrollment, GPS or attendance writes. Preserve expiry, HMAC and DB uniqueness checks.
- Resolve classroom geofence from the same college-owned class/session; no cross-college coordinate lookup.
- Face endpoints derive student from authenticated membership, and biometrics join through that same tenant; no client student ID overrides.
- Guardian relationships must be verified, active and same-tenant before notification enqueue; provider delivery records inherit event tenant.
- Reports and exports apply tenant scope to every joined source and remove secrets, biometric data and unnecessary location detail.
- Super Admin access to a college for support, if later required, needs a named permission, reason, time limit, audit record and minimum data. It never follows automatically from `super_admin` role.

## Negative test plan (NOT RUN; implementation absent)

Use two colleges A/B in an isolated PostgreSQL test DB and create unrelated users/data with non-overlapping and intentionally colliding local IDs where possible.

| Test ID | Attempt | Expected |
|---|---|---|
| TEN-CTX-01 | No membership calls a college route | Deny; no context is constructed. |
| TEN-CTX-02 | User selects a membership belonging to another user | Deny without exposing that college. |
| TEN-CTX-03 | Revoked membership or suspended college uses an old JWT | Deny after DB status reload. |
| TEN-CTX-04 | Multi-member user selects an unlinked college ID/header | Deny; valid membership selector succeeds only for that user's active membership. |
| TEN-IDOR-01 | College A requests B's student/class/subject ID | 404/403; no data leaked. |
| TEN-IDOR-02 | A updates/deletes B's record by ID | Zero rows modified and denial; audit safe attempt where policy requires. |
| TEN-REL-01 | Create A enrollment/assignment/session with B parent ID | Composite FK/API validation rejects transaction. |
| TEN-ATT-01 | A student submits B QR token/session ID | Deny before attendance write; preserve replay/duplicate protections. |
| TEN-ATT-02 | Cross-tenant concurrent duplicate submission | At most one valid same-tenant event; foreign tenant attempt never inserts. |
| TEN-GIS-01 | Use B classroom coordinates in an A session | Deny; geofence uses same-tenant classroom/session. |
| TEN-FACE-01 | A student queries/registers B biometric reference | Deny; no image/template disclosure or write. |
| TEN-GUARD-01 | B guardian relationship is used for A student notification | Deny and do not enqueue. |
| TEN-REPORT-01 | A filters report by B identifiers or export path | No B rows/counts/metadata in response/export. |
| TEN-JOB-01 | Background job retries with missing/stale tenant context | Fail closed/idempotently; never process across tenants. |
| TEN-ROLE-01 | `super_admin` calls legacy `/admin-*` route | Deny unless an individual platform permission is explicitly designed and tested; current expected outcome is denial. |

These tests cannot be meaningfully passed until tenant membership and scoped repository logic exist. Do not build mock “tenant isolation” tests around front-end filtering.
