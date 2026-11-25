# Phase 14A.6 — Tenant Migration Static Hardening & Readiness

**Date:** 2026-11-09
**Status:** Static readiness improved; migration remains **DRAFT / NOT APPLIED**. No PostgreSQL connection or operation occurred.

## Scope and preservation

Reviewed the College and CollegeMembership models, tenant context and membership lifecycle service, mounted API routers and pilot, tenant tests, v2 draft, fixture/generator, and Phase 12/13A/13B/14A records. Existing user modifications and untracked files were preserved. The Phase 14A.5 credential-recovery status remains **BLOCKED / NOT APPROVED**; this work did not interact with credentials or DPAPI.

## Migration review and static hardening

| Area | Status | Finding |
|---|---|---|
| Dependency order and FK types | PASS (static) | `public.colleges` precedes `public.college_memberships`; all user FK columns are PostgreSQL `INTEGER`, and target the qualified `public.users(id)`. The referenced user key must be INTEGER, NOT NULL and the sole-column primary key. |
| Prerequisite behavior | PASS (static checks only) | v2 now runs a `DO` preflight inside its transaction before DDL. It raises a descriptive exception if `public.users` is absent or `id` does not meet the expected type/nullability/PK requirements. Server execution/rollback behavior is **NOT TESTED**. |
| Keys and uniqueness | PASS (metadata/static) | Both new IDs are primary keys; college slug remains unique; a user/College membership pair is unique independent of status. Check constraints limit supported roles and lifecycle statuses. |
| Secondary indexes | PASS (metadata/static) | Removed redundant non-unique indexes on primary-key IDs from the two tenant ORM models and v2 SQL. Retained the unique slug index and the two membership status lookup indexes. This is a reviewed physical-index change; uniqueness semantics are unchanged. |
| Upgrade/downgrade | PASS (static structure only) | Upgrade is explicitly transactional; manual rollback order drops memberships before colleges. Downgrade is destructive if rows exist and is not automated, tested, or authorized. |
| Idempotency | BLOCKED / intentional | Plain CREATE statements are not repeat-safe. Require fresh target absence/catalog inspection; never rerun blindly after a partial or uncertain apply. |
| Legacy compatibility | BLOCKED | Only the synthetic `public.users(id INTEGER NOT NULL PRIMARY KEY)` fixture is represented. Full legacy schema, migration history, and PostgreSQL catalog state are unknown. |
| Data/ownership effects | PASS (static) | Draft creates empty tenant tables only. No default College, user rows, legacy ownership assignment/backfill, or role promotion is present. Existing business tables/data are untouched. Ownership of existing legacy records remains **UNKNOWN** pending manual evidence-based reconciliation. |
| PostgreSQL syntax, locks, execution and rollback | NOT TESTED | No PostgreSQL parser/server was used. Transactional DDL, `DO` block behavior, lock acquisition/duration, catalog results and rollback remain to be tested on a separately approved disposable PostgreSQL target. SQLite tests do not establish PostgreSQL compatibility. |

The fixture remains intentionally synthetic and zero-row. It tests only the FK parent mechanics; it is not a snapshot of the legacy schema. The offline generator now validates the schema-qualified user FK declarations.

## Route-by-route authorization status

Only the `/tenant/pilot/college-profile` GET/PATCH routes currently adopt `resolve_tenant_context`. The college selector cannot grant access; membership and active college are resolved from persisted rows, then the read/write targets are constrained by `context.college_id`. GET allows active `college_admin`, `teacher`, or `student` memberships; PATCH allows only active `college_admin`. API tests exercise cross-college denial and write isolation. This pilot does not establish tenant isolation for other routers.

| Mounted route group | Existing auth/authorization pattern | Active CollegeMembership required? | College-scoped access established? | Status |
|---|---|---:|---:|---|
| `/tenant/pilot/college-profile` GET | authenticated user + active membership/active college; explicit selector required for ambiguous multi-membership | Yes | Yes, for the pilot College profile read | PASS for pilot behavior tests |
| `/tenant/pilot/college-profile` PATCH | same, plus membership role `college_admin` | Yes | Yes, for the pilot College profile write | PASS for pilot behavior tests |
| `/auth/login`, `/auth/me` | credential login / authenticated account | No | Not applicable; account identity endpoints | Legacy/account scoped |
| `/students/*`, `/students/{id}/guardians*`, `/teachers/*` | predominantly legacy global `get_current_admin` | No | No College filter established | NOT TENANT-SAFE |
| `/attendance/*`, `/attendance/sessions*`, `/attendance-records/*` | legacy authenticated user / teacher dependencies and record-level checks | No | No College filter established | NOT TENANT-SAFE |
| `/student-attendance/*`, `/face/me/*` | authenticated account/student and session/self checks | No | No College filter established | Account/session scoped only; NOT TENANT-SAFE |
| `/subjects/*`, `/classes/*`, `/assignments/*` | legacy authenticated user/global admin checks | No | No College filter established | NOT TENANT-SAFE |
| `/`, `/health` | public status endpoints | No | Not applicable | Public/system endpoints |
| `/dashboard*`, `/admin-dashboard*`, `/teacher-dashboard*`, `/analytics/*` | authenticated account/global role or teacher checks | No | No College filter established | NOT TENANT-SAFE |
| `/notifications/*` | authenticated account; notification ownership by user | No | User scoped, not College scoped | NOT TENANT-SAFE |

This table is based on `main.py` router mounts and current dependency/query inspection. Per-user/per-record checks can still provide useful authorization; they do not constitute tenant membership enforcement or cross-College isolation. Legacy Admin remains a separate global role. Super Admin does not inherit College Admin or legacy Admin authorization through tenant context. No claim is made that all legacy routes have been behaviorally tested.

## Tests and static checks

Executed from `backend`:

```powershell
..\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_tenant_*" -v
..\.venv\Scripts\python.exe scripts\generate_tenant_user_schema_fixture.py --check
```

Results: **37 tests passed, 0 failed, 0 skipped** across tenant API pilot (12), tenant foundation/membership (12), migration static contracts (7), and fixture tests (6). These use synthetic in-memory SQLite/static file assertions, not PostgreSQL. The fixture checker passed. One existing Starlette/httpx deprecation warning was emitted; it did not fail tests.

Python syntax checks: **PASS**, AST parsed the four changed Python files (`models.py`, fixture generator, foundation tests, and new migration static tests) with no bytecode output. `git diff --check`: **PASS**, exit code 0 (Git emitted the existing README LF-to-CRLF working-copy warning). Trailing-whitespace scan: **PASS**, eight scoped files, zero findings. Frontend tests: **NOT RUN** because no tenant frontend files were changed.

## Exact blockers before a PostgreSQL rehearsal

1. Keep credential rotation A–E **BLOCKED / NOT APPROVED**. Independently resolve administrator access/custody under the separate Phase 14A.5 gates; none were touched here.
2. Obtain separate explicit approval for a disposable database operation. Do not use the Phase 11 source/restore DB or production.
3. Establish a sanitized and compatible baseline. The synthetic fixture validates only `users(id)` mechanics, not the actual legacy schema or application readiness.
4. On the approved target only, fresh-check cluster/database identity, absence of the tenant tables, owner/privileges, schema namespace and expected `users(id)` PK/type before applying the DRAFT.
5. Review the final SQL in PostgreSQL 18, execute only after approval, verify catalog constraints/indexes and zero data changes, and rehearse rollback only under separate approval. Measure/assess locks and failure recovery.
6. Tenant-wide rollout remains blocked: legacy business tables/routes have no College ownership enforcement, unknown ownership needs manual reconciliation, and no automatic assignment/default College/promotion is permitted.

No PostgreSQL process, connection, port, database, migration, credential, DPAPI file, service, or application configuration was accessed or operated.
