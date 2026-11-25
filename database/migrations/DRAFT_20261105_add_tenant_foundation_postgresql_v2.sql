-- STATUS: DRAFT / NOT APPLIED
-- Static-hardening revision of DRAFT_20261105_add_tenant_foundation_postgresql.sql.
-- Preserves tenant tables, statuses, FKs, checks, and uniqueness semantics.
-- Explicitly verifies the required public.users(id INTEGER PRIMARY KEY) parent
-- before DDL and schema-qualifies all objects to avoid search_path ambiguity.
-- Omits redundant non-unique indexes on SERIAL/INTEGER primary keys.
-- Does not create rows, alter legacy tables, or assign legacy ownership.
-- Never execute until reviewed and rehearsed on a verified disposable target.

BEGIN;

DO $tenant_users_preflight$
DECLARE
    users_id_attnum SMALLINT;
BEGIN
    IF to_regclass('public.users') IS NULL THEN
        RAISE EXCEPTION 'Tenant foundation requires public.users(id INTEGER PRIMARY KEY); table is absent';
    END IF;

    SELECT attribute.attnum
      INTO users_id_attnum
      FROM pg_attribute AS attribute
     WHERE attribute.attrelid = 'public.users'::regclass
       AND attribute.attname = 'id'
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped;

    IF users_id_attnum IS NULL OR NOT EXISTS (
        SELECT 1
          FROM information_schema.columns AS column_info
         WHERE column_info.table_schema = 'public'
           AND column_info.table_name = 'users'
           AND column_info.column_name = 'id'
           AND column_info.data_type = 'integer'
           AND column_info.is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'Tenant foundation requires public.users.id to be INTEGER NOT NULL';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint AS constraint_info
         WHERE constraint_info.conrelid = 'public.users'::regclass
           AND constraint_info.contype = 'p'
           AND constraint_info.conkey = ARRAY[users_id_attnum]::SMALLINT[]
    ) THEN
        RAISE EXCEPTION 'Tenant foundation requires public.users(id) to be the primary key';
    END IF;
END;
$tenant_users_preflight$;

CREATE TABLE public.colleges (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(80) NOT NULL,
    official_name VARCHAR(200) NOT NULL,
    display_name VARCHAR(120),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_colleges_slug_format CHECK (slug ~ '^[a-z0-9_-]{1,80}$'),
    CONSTRAINT ck_colleges_official_name CHECK (length(btrim(official_name)) > 0),
    CONSTRAINT ck_colleges_status CHECK (status IN ('pending', 'active', 'suspended', 'archived'))
);

CREATE UNIQUE INDEX ix_colleges_slug ON public.colleges (slug);

CREATE TABLE public.college_memberships (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    college_id INTEGER NOT NULL REFERENCES public.colleges(id) ON DELETE RESTRICT,
    role VARCHAR(30) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_by_user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    activated_by_user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    revoked_by_user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    activated_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    status_reason VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_college_memberships_user_college UNIQUE (user_id, college_id),
    -- Required as the exact referenced key for account_invitations' composite FK.
    CONSTRAINT uq_college_memberships_id_user_college UNIQUE (id, user_id, college_id),
    CONSTRAINT ck_college_memberships_role CHECK (role IN ('college_admin', 'teacher', 'student')),
    CONSTRAINT ck_college_memberships_status CHECK (status IN ('pending', 'active', 'suspended', 'revoked'))
);

CREATE INDEX ix_college_memberships_user_status ON public.college_memberships (user_id, status);
CREATE INDEX ix_college_memberships_college_status ON public.college_memberships (college_id, status);

COMMIT;

-- ROLLBACK PLAN (reviewed operator action; not executed automatically):
-- Only after verifying the exact target, and only if these new tables contain
-- no required data, execute in a separately reviewed transaction:
-- BEGIN;
-- DROP TABLE public.college_memberships;
-- DROP TABLE public.colleges;
-- COMMIT;
