# Tenant Migration SQL Review

**Static review status: PASS WITH DOCUMENTED DRIFT. PostgreSQL execution: NOT TESTED.** The original draft remains unchanged and marked **DRAFT / NOT APPLIED**. A separate v2 draft was prepared to align the College slug index form and model primary-key indexes; it is also **DRAFT / NOT APPLIED**.

## Static review method

Reviewed `DRAFT_20261105_add_tenant_foundation_postgresql.sql`, current `College`/`CollegeMembership` SQLAlchemy metadata, and rendered the two ORM tables/indexes using SQLAlchemy's PostgreSQL dialect compiler. No PostgreSQL server was contacted and the SQL file was not executed or passed to a PostgreSQL parser.

## Structure and constraints

| Area | Finding |
|---|---|
| Creation order | `colleges` precedes `college_memberships`; internal College FK ordering is correct. `users(id)` must already exist in the target schema. |
| Keys / types | Integer ORM PKs compile as PostgreSQL `SERIAL`; `TIMESTAMPTZ` matches timezone-aware ORM timestamps. |
| Foreign keys | Membership `user_id` and `college_id` are NOT NULL and RESTRICT deletion, matching ORM FKs. Optional created/activated/revoked actor FKs use SET NULL, matching ORM. |
| Membership uniqueness | `(user_id, college_id)` unique constraint matches ORM and prevents more than one row for a pair, regardless of status. |
| Status constraints/defaults | College and membership status/role checks/defaults match ORM values. No College or membership rows are inserted. |
| College slug index drift | Original draft has named unique constraint `uq_colleges_slug` plus a separate non-unique `ix_colleges_slug`; ORM metadata compiles a single unique index named `ix_colleges_slug`. Both enforce uniqueness, but the object form differs and the draft creates a redundant index. v2 uses a unique index matching ORM metadata. |
| Primary-key indexes | ORM `index=True` emits secondary `ix_colleges_id` and `ix_college_memberships_id` indexes in addition to PK indexes. Original draft omits these redundant indexes. v2 includes them to mirror current metadata. They increase write/storage cost but do not alter data semantics. |
| Extra database checks | Original draft checks slug format and nonblank official name. The ORM validators enforce equivalent inputs for ORM writes, but these checks are not declared in SQLAlchemy table metadata. The DDL therefore additionally protects direct SQL writes; SQLite metadata tests do not exercise them. v2 preserves these checks. |
| `updated_at` | ORM `onupdate=func.now()` is applied by SQLAlchemy ORM updates; DDL only provides insert default and no server trigger. Direct SQL updates will not automatically advance it. No app code should use raw SQL update for this field without setting it. |
| Transaction / idempotency | `BEGIN`/`COMMIT` is atomic when executed as one PostgreSQL session. `CREATE TABLE`/`CREATE INDEX` statements are intentionally not idempotent; a rerun against existing objects fails and rolls back. This must be a one-time execution on a verified blank target. |
| Rollback | Commented rollback drops the two new tables and is destructive to membership/College rows. It is only appropriate on a verified disposable copy with no needed rows; no rollback was run. |
| Schema/search path | DDL is unqualified and assumes the intended schema is selected in `search_path`; `users` must resolve to the correct existing table. This cannot be verified without safe target identity. |

## v2 revision

`DRAFT_20261105_add_tenant_foundation_postgresql_v2.sql` is separate; the original draft was not overwritten. v2 preserves both tables, checks, statuses, FKs, nullability, defaults, pair uniqueness, transaction, and rollback plan. It changes the College slug uniqueness representation to the ORM's unique index and adds ORM-emitted PK indexes. No tenant rows, default College, legacy columns, or data backfill are included.

The added ID indexes are redundant with PostgreSQL PK indexes; they are included only to match current SQLAlchemy metadata. Before application, reviewers should decide whether to remove `index=True` from the new model PK columns and corresponding indexes from any final draft. Do not edit/apply either draft without separate review/authorization.

## Candidate selection

For a future **isolated, disposable-only rehearsal**, v2 is the preferred current candidate because its College slug unique-index form and explicit ID indexes match the rendered SQLAlchemy PostgreSQL metadata more closely. The original remains preserved as historical v1. This is not approval to apply v2. Both require target-schema/search-path confirmation, server validation, backup/restore success, review of the additional DB-only checks and redundant PK indexes, and separate authorization. Neither is a production candidate.

## Decision

Static structure is internally consistent for the intended empty schema with an existing `users(id)` table, but PostgreSQL syntax, server version behavior, target schema, extensions/search path, actual FK target, transaction, constraints and rollback are **NOT TESTED**. Migration rehearsal remains **BLOCKED** until a separate disposable DB is identified and backup/restore passes. Neither draft is production-ready or approved to apply.

Static compiler command (PowerShell, from `backend`; this compiles DDL only and opens no connection):

```powershell
$env:DATABASE_URL='sqlite://'
$env:SECRET_KEY=('phase7-static-review-' + ('k' * 40))
$env:ALGORITHM='HS256'
.\..\.venv\Scripts\python.exe -c "from sqlalchemy.schema import CreateTable,CreateIndex; from sqlalchemy.dialects import postgresql; from app.models import College,CollegeMembership; d=postgresql.dialect(); print(CreateTable(College.__table__).compile(dialect=d)); [print(CreateIndex(i).compile(dialect=d)) for i in College.__table__.indexes]; print(CreateTable(CollegeMembership.__table__).compile(dialect=d)); [print(CreateIndex(i).compile(dialect=d)) for i in CollegeMembership.__table__.indexes]"
```
