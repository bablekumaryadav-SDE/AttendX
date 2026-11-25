# College Registration PostgreSQL Migration Plan

**Status:** migration drafts remain **DRAFT / NOT APPLIED**. No PostgreSQL connection, SQL execution, backup, migration, or registration request was performed for this review.

## Source-level registration path

The public form submits its controlled fields to `POST /college-registration/applications` through `frontend/src/services/collegeRegistration.js`. The FastAPI router accepts `CollegeRegistrationCreate`, checks for an existing User and duplicate active application, then stores a pending `CollegeRegistrationApplication` and returns HTTP 201 with an application reference only after commit. Field names and response fields match in the current frontend and backend source. Duplicate conflicts map to 409; storage errors map to a sanitized 503. Source code does not establish the precise cause of the earlier live 422 because its validation location/message was not supplied.

Given the earlier user-supplied relation inventory, which omitted `colleges`, `college_memberships`, and `college_registration_applications`, missing prerequisites are a plausible explanation for 42P01. The log did not name the relation or correlate it to a specific request, and no live catalog was inspected. The exact live cause therefore remains **UNKNOWN**.

## Migration review and correction

| Draft | Source contents / prerequisites | Safety and compatibility notes |
|---|---|---|
| `database/migrations/DRAFT_20261105_add_tenant_foundation_postgresql_v2.sql` | Requires `public.users(id INTEGER NOT NULL PRIMARY KEY)`. Creates `public.colleges`, `public.college_memberships`, checks, unique constraints and indexes. | Foundation is additive and does not backfill or create rows. It now creates `uq_college_memberships_id_user_college UNIQUE (id, user_id, college_id)` to match ORM metadata and support the later composite invitation FK. It is not safe to run if either target table already exists; the transaction should fail rather than be treated as a rerunnable script. Do not apply foundation v1 and v2 together. |
| `database/migrations/DRAFT_20261110_add_college_status_history.sql` | Requires users and colleges. Adds nullable profile columns and creates `college_status_history`, its checks and index. | Preflight now rejects any pre-existing profile column unless it is nullable `VARCHAR` of the exact declared length. This prevents `ADD COLUMN IF NOT EXISTS` from silently accepting an incompatible column. Existing history table/index/constraint collisions still fail; inspect partial schemas rather than retrying blindly. |
| `database/migrations/DRAFT_20261110_add_college_registration_workflow.sql` | Requires users, colleges, memberships. Creates application and review tables, constraints and indexes. | Transactional, but not rerunnable where target relations/indexes already exist. It does not provision rows. Application/admin email partial unique indexes enforce non-rejected uniqueness. |
| `database/migrations/DRAFT_20261112_account_activation_invitations.sql` | Requires tenant foundation plus Student/Teacher schema. Creates invitation table with composite membership FK. | It now verifies that the foundation's named unique key exists with exact `(id,user_id,college_id)` column order and no longer attempts to add that key a second time. Not part of the minimum College registration migration sequence. |

All draft files use schema-qualified `public` object names and `BEGIN`/`COMMIT`. Static review found no persistent trigger/function creation in these three College registration drafts. Transaction framing reduces partial DDL persistence on statement failure in PostgreSQL, but is not a substitute for preflight, backup, or rehearsal. The rollback comments are operator proposals and may delete newly accumulated application, review, membership, College, or history data; they are not routine rollback commands.

## Proposed sequence — approval required before execution

1. **Identify target and migration state read-only.** Verify database/server identity, schema/search path, PostgreSQL version, migration history if any, exact relations and definitions, and that the target is the explicitly selected local development database. Confirm no production target. The supplied inventory is historical evidence, not a substitute for this preflight.
2. **Check the legacy parent.** Verify `public.users.id` is exactly `INTEGER NOT NULL PRIMARY KEY`; verify the columns and uniqueness relied upon by current User lookups (including `email`). Compare all existing relation definitions to ORM and drafts. If anything conflicts or is partially present, stop and design a reconciliation migration; do not run these drafts over it.
3. **Select one foundation only.** On a verified compatible schema with `users` but without tenant foundation relations, review and rehearse `DRAFT_20261105_add_tenant_foundation_postgresql_v2.sql`. Never also apply foundation v1. Verify colleges/memberships constraints and the new composite unique key after rehearsal.
4. **Apply College profile/history draft after separate approval.** Run `DRAFT_20261110_add_college_status_history.sql` only after foundation is verified. It must precede code paths that select the complete College profile model or write status-history events.
5. **Apply registration/review draft after separate approval.** Run `DRAFT_20261110_add_college_registration_workflow.sql` after users, colleges, and memberships are verified. This supplies the application/review persistence required by public submissions and platform review.
6. **Keep activation separate.** The account-invitation draft additionally depends on student/teacher registration schema. It is not needed to persist a pending College application; review and approve it as a separate future change.

Each operation requires a verified backup and restore rehearsal on an isolated disposable database, a reviewed migration plan, and explicit approval. Do not create default Colleges, memberships, user rows, or legacy ownership assignments. Existing ownership remains unknown until separately reconciled.

## Preflight and post-migration verification checklist

Before execution, capture server/database identity and catalog-only evidence for: `public.users` primary key type/nullability; all pre-existing tenant/registration relations; any conflicting profile columns; constraints, indexes and sequences; and current data counts without exposing personal values. Ensure the target is not production and that the backup can be restored into an isolated database. Confirm concurrent writers are quiesced for DDL.

After an approved rehearsal, verify relation/column metadata, primary and foreign keys (including composite key order), check/unique constraints, partial indexes, sequence ownership, and transaction outcome. Verify no rows were inserted or backfilled by these DDL scripts. Then test synthetic registration persistence, duplicate conflict, pending application listing and detail through the application against the isolated rehearsal database. A successful SQLite test is not PostgreSQL compatibility evidence.

## Failure and rollback limits

- A preflight mismatch, existing target relation, conflicting column, unexpected constraint, or failed statement means stop. Do not improvise `IF NOT EXISTS`, drop, rename, or manual repairs.
- The drafts are not generally idempotent. Their transactional DDL is expected to roll back on statement error, but that behavior has not been executed here. Inspect the catalog after any failed attempt before deciding next steps.
- Do not automatically downgrade. The documented downgrade operations destroy tenant or registration data. Prefer a verified isolated restore/rehearsal or a separately reviewed forward repair; any production rollback/data-loss decision requires explicit authorization.

## Validation status

- Source contract and draft checks: static tests passed as recorded in `docs/TEST_RESULTS.md`.
- PostgreSQL parser/DDL execution, live schema compatibility, migration state, registration persistence, and Super Admin list behavior against PostgreSQL: **NOT TESTED**.
- Production endpoint and database identity: **UNKNOWN**.
- No migration was applied; no PostgreSQL or database operation occurred.

## Runtime error diagnosis boundary

The new registration log stage is one of `existing_user_lookup`, `duplicate_application_lookup`, `application_insert_commit`, or `application_refresh`. If SQLSTATE is `42P01`, PostgreSQL/driver structured `schema_name` and `table_name` are logged only when present and safe. They are not guaranteed; PostgreSQL documents that object-name fields are available only for some errors and full coverage is limited to class 23: https://www.postgresql.org/docs/18/errcodes-appendix.html . A missing structured field stays `unknown`; no relation name is parsed from message text.

The owner must verify, using read-only catalog inspection, target identity/search path, relation presence in public and any conflicting same-named schemas, `public.users.id` definition, relevant columns/constraints/indexes/FKs, and migration history. No connection was attempted in this phase because no safe credential-supply mechanism was available without reading `.env` or credential material.

## Owner-run read-only catalog commands

Run these yourself in a terminal with the same database role the backend uses, entering the password only at the hidden `psql` prompt. Do not send or paste the password or connection string. If the role cannot be established without reading `.env`, stop and use your approved secret manager. PowerShell command:

```powershell
psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d attendx -W
```

The following statements are read-only catalog/identity queries; none reads business rows:

```sql
SELECT current_database() AS database_name,
       current_user AS database_role,
       current_schema() AS current_schema,
       current_setting('search_path') AS search_path,
       current_setting('server_version') AS server_version;

WITH expected(relname) AS (VALUES
    ('users'), ('colleges'), ('college_memberships'),
    ('college_registration_applications'), ('college_registration_reviews'),
    ('college_status_history')
)
SELECT expected.relname AS expected_relation,
       namespace.nspname AS schema_name,
       relation.relkind,
       CASE WHEN relation.oid IS NULL THEN false
            ELSE pg_table_is_visible(relation.oid) END AS visible_on_search_path
  FROM expected
  LEFT JOIN pg_class AS relation ON relation.relname = expected.relname
       AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
  LEFT JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
 ORDER BY expected.relname, namespace.nspname;

SELECT table_schema, table_name, column_name, data_type,
       character_maximum_length, is_nullable
  FROM information_schema.columns
 WHERE table_name IN ('users', 'colleges', 'college_memberships',
       'college_registration_applications', 'college_registration_reviews',
       'college_status_history')
 ORDER BY table_schema, table_name, ordinal_position;

SELECT namespace.nspname AS schema_name,
       relation.relname AS table_name,
       constraint_info.conname,
       constraint_info.contype,
       pg_get_constraintdef(constraint_info.oid, true) AS definition
  FROM pg_constraint AS constraint_info
  JOIN pg_class AS relation ON relation.oid = constraint_info.conrelid
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
 WHERE relation.relname IN ('users', 'colleges', 'college_memberships',
       'college_registration_applications', 'college_registration_reviews',
       'college_status_history')
 ORDER BY namespace.nspname, relation.relname, constraint_info.conname;

SELECT schemaname, tablename, indexname, indexdef
  FROM pg_indexes
 WHERE tablename IN ('users', 'colleges', 'college_memberships',
       'college_registration_applications', 'college_registration_reviews',
       'college_status_history')
 ORDER BY schemaname, tablename, indexname;

SELECT schemaname, tablename
  FROM pg_tables
 WHERE schemaname = 'public'
   AND (tablename ILIKE '%alembic%' OR tablename ILIKE '%migration%'
        OR tablename ILIKE '%schema_version%')
 ORDER BY tablename;
```

The relation lookup intentionally shows same-named relations across schemas. ORM models do not explicitly set a schema, so compare `visible_on_search_path` for the actual backend role; a `public` table not visible to that role can also fail an unqualified ORM query. The ledger query lists candidate names only. Do not query business rows.
