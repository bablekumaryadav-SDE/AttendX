# Legacy Route Compatibility

**Status:** Existing legacy behavior preserved in the Phase 6 pilot. These routes remain **NOT TENANT-SCOPED**.

## Unchanged route families

The Phase 6 change adds only `/tenant/pilot/college-profile` GET and PATCH and registers its separate router. Existing route handlers and dependencies were not converted to membership authorization. They continue to use the legacy active-user and global-role checks as previously implemented.

| Route family | Existing behavior retained | Tenant status |
|---|---|---|
| `/auth/login`, `/auth/me` | Shared email/password login; current DB role returned. | Legacy identity flow; no membership required. |
| `/students` and student attendance routes | Existing profile, attendance and student APIs. | Unscoped legacy behavior. |
| `/teachers`, `/teacher-dashboard` | Existing teacher profile/dashboard APIs. | Unscoped legacy behavior. |
| `/classes`, `/subjects`, `/assignments` | Existing academic structure and assignment endpoints. | Legacy role checks only; unscoped. |
| `/attendance`, `/attendance-records`, attendance session/QR routes | Existing attendance, QR/session, duplicate, and geofence behavior. | Unscoped legacy behavior. |
| `/admin-dashboard`, analytics/reports | Existing exact global `admin` checks and existing report access. | Not CollegeMembership-scoped. |
| Face registration/status routes | Existing face registration and access behavior. | Unscoped legacy behavior. |
| Guardian contact and notifications routes | Existing student guardian/notification behavior. | Not CollegeMembership-scoped. |
| `/tenant/pilot/college-profile` | New GET and PATCH pilot endpoints only. | Membership-scoped as described in `PHASE_6_TENANT_API_PILOT.md`. |

An unassigned legacy `admin` can still log in and use the existing legacy Admin dashboard, but cannot use the tenant pilot without an explicit active membership. A `super_admin` does not inherit the legacy `/admin-dashboard` authorization. Global `teacher` and `student` semantics were not changed.

This compatibility statement is not a security approval for SaaS use of legacy endpoints. Before broader multi-tenant launch, each listed data-bearing route must gain server-side membership-derived context and tenant predicates, and cross-college negative tests. Existing routes remain blocked from a full multi-tenant security claim.
