# Phase 13A — Migration Prerequisite Resolution

**Date:** 2026-11-09
**Scope:** Read-only prerequisite investigation. **No database, cluster, service, application configuration, or migration file was modified.**

## 1. Cluster runtime findings

| Check | Status | Finding |
|---|---|---|
| Exact data directory | PASS | `D:\AttendX\PostgreSQL-Test\cluster`; `PG_VERSION` is `18`. PostgreSQL binary reports **18.6**. |
| System identifier | PASS | `pg_controldata` reports `7704647215459077108`, consistent with Phase 10/11 records. |
| `pg_controldata` state | PASS (interpreted) | It reports `in production`. This control-file state is not, by itself, proof of a currently running server. It was corroborated by process, PID, `pg_ctl`, log, and TCP evidence below. |
| Target `postmaster.pid` | PASS | Present; PID `2452`, data directory `D:/AttendX/PostgreSQL-Test/cluster`, port `55432`, listen address `127.0.0.1`, state `ready`. The PID is live. |
| PostgreSQL process command line | PASS | Read-only process inventory identifies PID `2452` as `postgres.exe -D D:/AttendX/PostgreSQL-Test/cluster -h 127.0.0.1 -p 55432`. Its child processes include the checkpointer and other workers. No second PostgreSQL postmaster command line references this D: directory. |
| `pg_ctl status` | PASS (elevated read-only check) | A non-elevated call reported “no server running”; a subsequent elevated read-only call reported `server is running (PID: 2452)` and printed the exact D: data directory and loopback/55432 arguments. The initial false negative is consistent with the restricted process-visibility context; the elevated result agrees with the live process and PID file. |
| TCP endpoint | PASS | `Test-NetConnection 127.0.0.1:55432` returned `True`. Elevated listener enumeration identified `127.0.0.1:55432` with owner PID `2452` in one query. Other listener queries returned no rows, so this API was inconsistent; the process, `pg_ctl`, and successful TCP probe corroborate the endpoint. No SQL connection was made. |
| PostgreSQL log | PASS | `server.log` records startup at `2026-11-09 13:21:41 IST`, listening on `127.0.0.1:55432`, and “ready to accept connections”; later checkpoint records show the server operating. No shutdown record follows those entries. The log contains earlier failed verification-query errors from prior work; those do not indicate a current identity mismatch. |
| Target configuration | PASS | `postgresql.conf` has no active explicit `port` or `listen_addresses` values; `postgresql.auto.conf` has no overrides. `postmaster.opts` and the live process command line show startup overrides `-h 127.0.0.1 -p 55432`. |
| Existing Windows service | PASS (unchanged); listener NOT CONFIRMED | `postgresql-x64-18` remains Running/Automatic; `sc qc` reports its original `C:\Program Files\PostgreSQL\18\data` service data directory and `NT AUTHORITY\NetworkService`. Service PID is `5140`; its postmaster process is PID `7628`, distinct from the test postmaster PID `2452`. Listener enumeration did not confirm port 5432: `netstat` showed `0.0.0.0:5432 CLOSED` for PID 7628 and `Get-NetTCPConnection -State Listen` returned no row. No TCP probe or database connection was sent to port 5432. No service operation or configuration change occurred. |
| Other cluster users / open handles | PARTIAL | PostgreSQL process inventory shows the target postmaster and its workers; no second PostgreSQL server references this directory. `openfiles /query` could not enumerate handles because Windows “maintain objects list” is disabled and access was denied. Non-PostgreSQL processes holding unrelated file handles therefore were not exhaustively ruled out. |

**Runtime conclusion: the isolated test PostgreSQL server is RUNNING** as PID 2452 on the loopback endpoint `127.0.0.1:55432`. The initial non-elevated `pg_ctl` result was a process-visibility false negative. The service cluster on C: is a distinct process tree. The isolated endpoint's live database identity (database owner/catalog) was not re-queried in Phase 13A; there was no SQL connection. Any future database-changing operation still requires fresh identity and target-absence checks immediately beforehand.

The server remains running because this phase expressly prohibited start/stop/signal operations.

## 2. Tenant migration schema compatibility checklist

### Referenced legacy `users` table

- The model is `User` with `__tablename__ = "users"`.
- `id` is SQLAlchemy `Integer`, `primary_key=True`, `index=True`; PostgreSQL ORM compilation emits `id SERIAL NOT NULL` and `PRIMARY KEY (id)`. `SERIAL` is an integer column with sequence/default behavior; the FK needs a compatible PostgreSQL `INTEGER` (`int4`) target.
- PostgreSQL requires the referenced `users.id` to be backed by a primary-key or unique constraint. A non-unique index alone is insufficient.
- The tenant draft uses unqualified references to `users(id)` four times: `user_id`, `created_by_user_id`, `activated_by_user_id`, and `revoked_by_user_id`. The actual schema/search path must resolve `users` to the intended table (proposed baseline: `public.users`).
- Actor columns are nullable and use `ON DELETE SET NULL`; membership `user_id` is non-null and uses `ON DELETE RESTRICT`.
- The remaining User model columns are `name VARCHAR(100) NOT NULL`, `email VARCHAR(150) NOT NULL`, `hashed_password VARCHAR(255) NOT NULL`, `role VARCHAR(50) NOT NULL`, `is_active BOOLEAN NOT NULL`, and nullable `created_at TIMESTAMPTZ DEFAULT now()`. `ix_users_email` is unique; `ix_users_id` is a non-unique secondary index. Only `users.id` and its unique/PK guarantee are required by the tenant migration's FKs. No user rows are required to create these constraints.

### New `colleges` table

- `id SERIAL PRIMARY KEY`; slug `VARCHAR(80) NOT NULL`; official name `VARCHAR(200) NOT NULL`; display name `VARCHAR(120) NULL`.
- Status `VARCHAR(20) NOT NULL DEFAULT 'pending'`, checked against `pending`, `active`, `suspended`, `archived`.
- `created_at` and `updated_at` are non-null `TIMESTAMPTZ DEFAULT now()`.
- Draft-only checks enforce lowercase slug format and nonblank trimmed official name. Slug uniqueness is represented as a unique index in v2; v1 has a unique constraint plus a redundant non-unique slug index.
- v2 also creates `ix_colleges_id`, redundant in lookup capability with the primary-key index. Review whether to remove the model `index=True` and corresponding draft index.

### New `college_memberships` table

- `id SERIAL PRIMARY KEY`; `user_id INTEGER NOT NULL` FK to `users(id)` `ON DELETE RESTRICT`; `college_id INTEGER NOT NULL` FK to `colleges(id)` `ON DELETE RESTRICT`.
- `role VARCHAR(30) NOT NULL`, limited to `college_admin`, `teacher`, and `student`; this does not include `super_admin` or global `admin`.
- `status VARCHAR(20) NOT NULL DEFAULT 'pending'`, limited to `pending`, `active`, `suspended`, `revoked`.
- Nullable actor FKs (`created_by_user_id`, `activated_by_user_id`, `revoked_by_user_id`) target `users(id)` with `ON DELETE SET NULL`.
- Nullable `activated_at`/`revoked_at`/`status_reason`; required `created_at`/`updated_at TIMESTAMPTZ DEFAULT now()`.
- Unique `(user_id, college_id)`; indexes on `(user_id,status)` and `(college_id,status)`. v2's `ix_college_memberships_id` duplicates primary-key lookup capability and should be reviewed.

No existing legacy row is required to be assigned. Membership tables can be created empty after the correct `users` parent exists. Neither draft creates a College or membership row.

## 3. Sanitized schema preparation options

**Recommended for a mechanics-only rehearsal:** generate a small, synthetic PostgreSQL schema-only baseline offline from the existing `User.__table__` metadata using SQLAlchemy's PostgreSQL dialect, review its SQL, and apply it only to a separately approved disposable database. The rendered table uses the model's `INTEGER`/`SERIAL` primary key and columns; the DDL compiler command is recorded in `TEST_RESULTS.md`. Include only the `users` table/indexes needed by the tenant draft, with no `INSERT`, password hash, email, or other user data. This validates the draft's FK dependency and type mechanics without production access or data copying.

This synthetic baseline is **not** evidence of compatibility with the real legacy PostgreSQL schema. Differences in real schema namespace, ID type, constraints, extensions, or migration history remain unknown. Do not use an empty Phase 11 backup/restore as the baseline: it contains no `users` table. A schema-only export from a non-production environment could be considered only if an owner confirms it contains no real user data and its source/identity is independently verified. Production/application DB access remains prohibited.

No fixture file was generated or applied in Phase 13A; this is a proposed method only.

## 4. Migration safety review

| Requirement | Status | Finding |
|---|---|---|
| FK ordering | PASS (static) | `colleges` must be created before `college_memberships`; `users` must already exist. Actor/user FKs and College FK point to matching integer keys. |
| Upgrade behavior | DRAFT | Both scripts wrap additive table/index creation in a transaction. They use plain `CREATE`, not idempotent guards; target absence and catalog preflight are required. |
| Downgrade/rollback | DRAFT | Commented manual drop order is child `college_memberships`, then parent `colleges`. It destroys any tenant rows and must not run unless disposable target and empty tables are verified. Prefer restore to a fresh target from a verified pre-change backup. |
| College ownership | NOT APPLICABLE to this foundation DDL | No legacy business records receive a College ID; no ownership is inferred or backfilled. |
| Unknown ownership | BLOCKED | Remains UNKNOWN. No default College or automatic assignment is safe or included. |
| Super Admin separation | PASS (static design) | Global `User.role` is untouched; `super_admin` is excluded from membership role checks and gets no implicit legacy Admin or College Admin grant. |
| Default College / automatic promotion | PASS | Neither draft inserts a College or changes/promotes any user role. |
| Cross-college isolation | NOT IMPLEMENTED | This is a foundation-only schema. Legacy business tables/routes remain unscoped; membership tables do not enforce same-College ownership on those records. |
| Idempotency drift / duplicate indexes | DRAFT / REVIEW REQUIRED | v1/v2 differ in slug index representation; v2 adds redundant ID indexes. Finalize before any apply. |
| Live schema compatibility / PostgreSQL execution | NOT TESTED | No database query, migration parse by server, apply, or rollback was run. |

## 5. Exact future operations requiring separate approval

The proposed target remains **new disposable database `attendx_tenant_migration_verify_20261109`**, owned by `attendx_test_role`, on the isolated cluster `D:\AttendX\PostgreSQL-Test\cluster` at `127.0.0.1:55432`. Keep the source `attendx_integration_test`, restore `attendx_restore_verify_20261109_133428`, the C: service cluster, and port 5432 untouched.

Before requesting approval to apply the tenant DDL, prepare and independently review the synthetic, zero-row `public.users` baseline from the ORM, or provide a sanitized non-production schema baseline; then propose these exact operations:

1. Fresh read-only identity query: version 18.6, system identifier, data directory, loopback address, port 55432, logged-in role, and database name; verify target DB absence and baseline schema. Stop on mismatch.
2. Create the named disposable database owned by `attendx_test_role`; load only the approved, zero-row schema-only fixture and verify `public.users.id` is `INTEGER` with PK/unique key. Record schema/catalog inventory.
3. Take and verify a protected pre-migration backup outside the repository; if included in approval, restore to a second new disposable verification DB without overwriting any existing database.
4. After resolving v2 index/check drift and receiving explicit approval, apply only the tenant foundation draft. Expected data changes: zero; no College, membership, user, role, or ownership rows inserted or changed.
5. Verify columns, types, defaults, PK/unique/check/FK definitions, and index definitions. Roll back only by restoring the verified backup to a fresh database; manual reverse DDL requires its own explicit authorization and proof the two tenant tables contain no required rows.

The creation of a database, fixture application, backup/restore, and migration execution all modify database state and require separate explicit approval for the finalized exact plan. Phase 13A provides no such approval and performs none of these operations.

## Phase 13A outcome

Read-only prerequisite investigation completed. The test postmaster is running at the expected isolated path and loopback port; PostgreSQL role/database catalog identity was not re-queried. No database object was created, deleted, or modified; no migration, backup, restore, production access, application URL change, dependency install, Git commit, or push occurred. Continue only after resolving the remaining baseline and migration-draft review items and obtaining separate approval for the exact database operations.
