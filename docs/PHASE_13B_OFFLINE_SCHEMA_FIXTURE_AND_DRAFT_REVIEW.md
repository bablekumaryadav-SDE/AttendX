# Phase 13B — Offline Schema Fixture Preparation & Migration Draft Finalization

**Date:** 2026-11-09
**Status:** PASS for offline fixture generation and static draft review. PostgreSQL compatibility, live-schema compatibility, and migration execution remain **NOT TESTED**. The v2 migration remains **DRAFT / NOT APPLIED**.

## Files prepared

- `database/fixtures/phase13b_tenant_users_schema.sql` — generated, zero-row PostgreSQL fixture containing only `public.users(id)`.
- `backend/scripts/generate_tenant_user_schema_fixture.py` — deterministic offline generator, draft-FK checks, and `--check` validation. It imports the actual `app.models.User` definition while substituting a minimal in-memory `app.database` module/Base; it creates no engine, changes no environment variables, and opens no database connection.
- `backend/tests/test_tenant_user_schema_fixture.py` — focused database-free generation/validation tests.
- `docs/PHASE_13B_OFFLINE_SCHEMA_FIXTURE_AND_DRAFT_REVIEW.md` — this review.
- Updated `docs/TEST_RESULTS.md` and `docs/FINAL_ACCEPTANCE_REPORT.md`.

The v2 draft and `backend/app/models.py` were not changed.

## Fixture and `users(id)` validation

The generator takes the type and primary-key flag from `User.__table__.c.id`, requires SQLAlchemy `Integer` and `primary_key=True`, and compiles a minimal `public.users` table with the PostgreSQL dialect. It sets `autoincrement=False` because sequence behavior is not needed to validate a referenced key; the resulting SQL column is explicitly `INTEGER NOT NULL` with `PRIMARY KEY (id)`. PostgreSQL creates the key's backing unique index as part of the primary-key constraint. The fixture does not add `ix_users_id`, a redundant non-unique index.

Fixture contents:

```sql
CREATE TABLE public.users (
    id INTEGER NOT NULL,
    PRIMARY KEY (id)
);
```

The fixture intentionally omits User's `name`, `email`, `hashed_password`, `role`, `is_active`, and `created_at` columns and the email uniqueness rule: none is required by the tenant migration's FK dependency. It has no inserts, records, credentials, or production data. It creates no database table in Phase 13B; only the reviewable SQL file is written.

The tenant draft contains four `users(id)` FKs. Each FK field is `INTEGER`: `user_id` is non-null and `ON DELETE RESTRICT`; the three nullable actor IDs use `ON DELETE SET NULL`. PostgreSQL requires `users.id` to have the same compatible integer type and a primary-key or unique constraint; a non-unique index alone would not satisfy the reference. The other parent is `colleges(id)`, created first by the tenant draft as `SERIAL PRIMARY KEY`; `college_id` is `INTEGER NOT NULL ON DELETE RESTRICT`.

**Limit:** this fixture demonstrates only the integer FK target and key mechanics. It does not model the complete User table, actual PostgreSQL migration history, namespace/search-path state, extensions, or any unknown legacy schema. It cannot establish production or application schema compatibility. The empty Phase 11 databases remain unsuitable as legacy baselines.

## v2 index decisions

| Index/object | Finding and decision |
|---|---|
| `ix_colleges_id` | Redundant non-unique index on `colleges(id)`; `PRIMARY KEY (id)` already creates a unique B-tree index covering the same lookup. **Decision: retain in unchanged v2** as an explicit mirror of current SQLAlchemy `index=True` metadata for this draft. Accept the extra storage/write cost; remove only with a separately reviewed ORM/schema change. |
| `ix_college_memberships_id` | Redundant non-unique index on `college_memberships(id)` for the same reason. **Decision: retain in unchanged v2** for the same metadata-parity reason and accepted cost. |
| `ix_colleges_slug` | Unique index on `slug`; **not redundant**. It enforces the ORM's unique slug rule and aligns with `unique=True,index=True`. It replaces v1's table unique constraint plus separate duplicate non-unique slug index. |
| `uq_college_memberships_user_college` | Unique constraint on `(user_id,college_id)`; **not redundant** with either status index. It enforces one membership row per user/College pair regardless of status. |
| `ix_college_memberships_user_status` | Supports lookups/filtering by user and status. Not equivalent to the pair-unique index because it includes status and supports the membership status query. |
| `ix_college_memberships_college_status` | Supports lookups/filtering by College and status; no PK/unique index has this key order. |

The two duplicate ID indexes are intentionally kept in the existing draft; this decision does not alter v2 or its semantics. An accepted cost remains. No index was created in a database.

## v2 CHECK-constraint decisions

| Constraint / expression | Effect and decision |
|---|---|
| `ck_colleges_slug_format`: `slug ~ '^[a-z0-9_-]{1,80}$'` | Allows only canonical lowercase ASCII letters, digits, underscore, and hyphen, 1–80 characters. The ORM validator strips and lowercases input; direct SQL must submit canonical values. **Decision: retain** as database enforcement of canonical slug format. |
| `ck_colleges_official_name`: `length(btrim(official_name)) > 0` | Rejects empty or whitespace-only official names. ORM validation strips and rejects blank input; `VARCHAR(200)` enforces the maximum. The check does not force raw SQL values to be trimmed. **Decision: retain** as the database nonblank guard. |
| `ck_colleges_status` | Limits status to `pending`, `active`, `suspended`, or `archived`; represented by ORM `CheckConstraint`. Retain. |
| `ck_college_memberships_role` | Limits membership role to `college_admin`, `teacher`, or `student`. It intentionally excludes `super_admin` and global `admin`; represented by ORM `CheckConstraint`. Retain. |
| `ck_college_memberships_status` | Limits status to `pending`, `active`, `suspended`, or `revoked`; represented by ORM `CheckConstraint`. Retain. |

No model or migration source was changed to implement these review decisions. No role promotion or new College/Admin behavior is implied.

## Upgrade, downgrade, and remaining assumptions

- `users` must already exist in the intended schema; draft references are unqualified and depend on `search_path`. The fixture explicitly creates `public.users`, so a future isolated rehearsal must set/verify the intended search path.
- Creation order is `colleges` then `college_memberships`; the latter depends on both `users` and `colleges`.
- The draft wraps DDL in `BEGIN`/`COMMIT`, but uses plain `CREATE TABLE` and `CREATE INDEX`, not idempotent guards. Verify target absence/catalog state before any future apply; never blindly rerun after partial execution.
- The commented downgrade order is `DROP college_memberships` then `DROP colleges`. It does not delete `users`, but it destroys any memberships and College rows placed in those tables. It is only appropriate on an explicitly approved disposable target after confirming no needed rows; prefer restoring a verified pre-change backup to a new database.
- The zero-row baseline has no users, Colleges, or memberships. No default College is created. No `User.role` is altered. `super_admin` remains separate from legacy `admin` and from College membership roles.
- Legacy ownership remains **UNKNOWN**. No existing business rows are assigned a College. This foundation does not add tenant keys or cross-College query constraints to legacy business data; it does not provide full tenant isolation.
- PostgreSQL server parser/execution, live target schema, exact database owner/privileges, lock behavior, restore-based rollback, and application behavior against PostgreSQL remain **NOT TESTED**.

## Validation results

Focused offline suite: **6 tests passed, 0 failed, 0 skipped**. One initial assertion failure was a test bug: it treated the fixture header's explanatory “no INSERT statements” comment as an SQL insert. The assertion was corrected to inspect SQL after removing line comments; the complete rerun passed. This was not a schema or migration assertion failure.

The reproducibility `--check` passed. No PostgreSQL connection (including the isolated test server), database/table modification, migration, backup/restore, role change, production access, environment-variable change, install, build, cache clear, or Git operation that changes history was performed.

Exact commands and outcomes are in `TEST_RESULTS.md`.

## Next phase and approval gates

Proposed next phase: **Phase 14 — Approval-Gated Disposable Tenant DDL Rehearsal**. Before asking for execution approval, finalize the exact database/backup/restore names and provide the already reviewed fixture. Any future run must stop unless a fresh read-only identity check confirms PostgreSQL 18.6, system identifier `7704647215459077108`, the exact D: cluster, loopback `127.0.0.1`, port `55432`, expected role, and a new target name that is absent.

The following each change state and require separate explicit approval of the exact operation before execution:

1. Create the new disposable database (proposed name: `attendx_tenant_migration_verify_20261109`) owned by `attendx_test_role`.
2. Apply the zero-row `public.users(id)` fixture in that database.
3. Create a protected pre-migration backup outside the repository; if restore is in scope, create a second uniquely named disposable restore database and restore only to that new target.
4. Apply `DRAFT_20261105_add_tenant_foundation_postgresql_v2.sql` to the named disposable target.
5. Run catalog verification queries (read-only) and, if needed, restore-based rollback in a separate new database. Manual reverse `DROP TABLE` rollback is destructive and requires its own explicit approval.

Never target `attendx_integration_test`, `attendx_restore_verify_20261109_133428`, the C: PostgreSQL service, port 5432, a production database, or any target whose identity is uncertain. Phase 13B grants no database-operation approval.
