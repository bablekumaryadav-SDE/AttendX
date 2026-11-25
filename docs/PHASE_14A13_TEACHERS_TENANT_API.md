# Phase 14A.13 â€” Read-only Tenant-scoped Teachers API

**Date:** 2026-11-10
**Status:** Implemented; backend and frontend automated checks passed. PostgreSQL ownership schema and PostgreSQL behavior remain NOT TESTED. Credential rotation Aâ€“E remains BLOCKED / NOT APPROVED.

## Ownership and identity decision

`Teacher` is a College-owned business profile only when its nullable `teachers.college_id` is non-NULL and matches the requester's verified tenant context. The current SQLAlchemy model declares that nullable College FK and composite `(id, college_id)` key. The Phase 14A.8 ownership migration is still DRAFT / NOT APPLIED; consequently, deployed schema compatibility is unknown. This API fails closed with sanitized 503 when tenant or Teacher ownership schema is absent. NULL ownership remains UNKNOWN and is excluded from lists or concealed by the same 404 used for foreign and missing profiles.

`User` is a global login identity. There is no `Teacher.user_id` FK. Legacy code has used email matching, but this API does not join or match `User` records and does not use `User.role` for authorization. A global User can hold separate active CollegeMembership rows; each request still resolves one College and reads Teacher rows only for that College. The existing globally unique Teacher email and employee ID constraints are legacy model constraints, not tenant authorization, and this API does not expose either field. Duplicate/shared global account identity is not treated as evidence of Teacher ownership or copied into a College profile.

The route returns only `id`, `name`, `department`, `is_active`, and `created_at`. It returns no email, employee ID, User ID, global role, password/hash, token, or linked assignment/attendance information. `Teacher` has no business parent to read besides its College. The route queries no linked TeacherAssignment, Subject, Class, Attendance, or User rows; the tenant context resolver verifies an active College. Composite same-College constraints for Teacher child records exist in ORM metadata and the unapplied ownership draft, but PostgreSQL enforcement is NOT TESTED. Since these endpoints do not read child records, no child relationship is used to expand the response.

## Authorization and routes

Both endpoints require authentication and `resolve_tenant_context` on every request. Permitted membership roles are `college_admin`, `teacher`, and `student`. The optional `college_id` is a selector only: the resolver verifies an active membership and active College, rejects foreign selectors, returns 409 when a user has multiple memberships but omits selection, and denies Super Admin/global-role-only access. List queries filter `Teacher.college_id == context.college_id` and order by ID. Detail lookup is constrained to both the requested ID and resolved College.

| Method/path | Result | Details |
|---|---|---|
| `GET /teachers/` | Enabled | Selected active College's non-NULL Teacher profiles only |
| `GET /teachers/{teacher_id}` | Enabled | Same-College detail; foreign, UNKNOWN, and missing IDs share sanitized 404 |
| `POST /teachers/` | BLOCKED | Legacy router default-deny gate, sanitized 503 |
| `PUT /teachers/{teacher_id}` | BLOCKED | Legacy router default-deny gate, sanitized 503 |
| `DELETE /teachers/{teacher_id}` | BLOCKED | Legacy router default-deny gate, sanitized 503 |
| `POST /teachers/{teacher_id}/activate` | BLOCKED | Legacy router default-deny gate, sanitized 503 |
| `GET /teachers/{teacher_id}/assignments` | BLOCKED | Legacy router default-deny gate, sanitized 503 |

Only the dedicated GET router is mounted before the legacy Teacher router. No broad exemption was added; all other unreviewed legacy business APIs remain behind the Phase 14A.7 fail-closed gate. No Teacher or global User writes are available in the Teachers frontend or Teacher service.

## Frontend

The Teachers page is a read-only directory. It takes `activeCollegeId` from AuthContext and passes it explicitly for list and detail requests. The service validates selection before dispatch and has only GET Teacher methods. The page clears old list/detail state on selection changes, invalidates older asynchronous responses, and presents safe 401, 403, 404, 409, and 503 messages. It does not read localStorage for authorization, show email/employee ID, infer membership, or silently select a College. Admin dashboard Teacher counts also pass the explicit AuthContext selection.

## Validation evidence and limits

- Backend tenant suite: **88 passed, 0 failed, 0 skipped** using synthetic SQLite, in-process FastAPI requests, and static tests. New behavior tests cover authenticated membership enforcement, global-role-only denial, suspended membership/College, College filtering, NULL and foreign detail concealment, multi-membership selection, cross-College visibility for a global User with multiple memberships, response field minimization, missing ownership schema, and blocked write/assignment/other legacy routes.
- Frontend serial Node suite: **51 passed, 0 failed, 0 skipped** across 10 `.test.mjs` files. New tests exercise Axios service functions using a mocked adapter to verify explicit College selectors, GET-only methods, and no dispatch without a selected College. Error handling is checked; UI state/request invalidation and absence of write controls are inspected through source assertions. No browser rendering was performed.
- Vite production build: **PASS**, 1,935 modules transformed. Non-fatal warnings remain for ignored `use client` directives and a minified chunk above 500 kB. Initial sandbox attempt failed with `spawn EPERM`; the same build succeeded in the approved elevated execution context. No dependency was installed or cache cleared.
- Python AST syntax checks and `git diff --check`: PASS. Scoped trailing-whitespace scan: PASS for Phase 14A.13 files.
- SQLite and mock-service checks do not establish PostgreSQL syntax, FK behavior, deployed schema presence, migration or lock behavior, or production readiness. No browser UI test was run.

## Legacy data and remaining blockers

No default College, ownership backfill, user-role promotion, or legacy data assignment was made. Existing teacher records with NULL ownership remain UNKNOWN; the API will hide them. Manual ownership reconciliation remains a future requirement. The tenant ownership migration must be separately reviewed and approved before deployment; the API cannot serve until the deployed schema contains the required ownership structures. PostgreSQL rehearsal and browser rendering remain untested. Credential rotation Aâ€“E remains BLOCKED / NOT APPROVED.

No PostgreSQL, database, credential, DPAPI, Windows service, cluster, ACL, port, or application database-configuration operation occurred.
