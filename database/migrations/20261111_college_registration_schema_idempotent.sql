-- AttendX College registration schema, consolidated idempotent application.
-- Derived from the reviewed tenant foundation v2, College status-history,
-- and College registration workflow drafts. The source drafts remain intact.
-- Adds schema only. It does not create rows, assign legacy ownership, or
-- change existing users, attendance, academic, or biometric data.
--
-- Apply only to the verified local attendx database after a verified backup.

BEGIN;

DO $schema_preflight$
DECLARE
    target_table_count INTEGER;
    users_id_attnum SMALLINT;
BEGIN
    IF current_database() <> 'attendx'
       OR current_user <> 'postgres'
       OR inet_server_addr()::text <> '127.0.0.1/32'
       OR inet_server_port() <> 5432
       OR (SELECT system_identifier::text FROM pg_control_system()) <> '7677118039977112008' THEN
        RAISE EXCEPTION 'Refusing to apply College registration schema outside the verified local attendx cluster';
    END IF;

    SELECT count(*)
      INTO target_table_count
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relkind IN ('r', 'p')
       AND relation.relname = ANY (ARRAY[
           'colleges',
           'college_memberships',
           'college_status_history',
           'college_registration_applications',
           'college_registration_reviews'
       ]);

    IF target_table_count NOT IN (0, 5) THEN
        RAISE EXCEPTION 'Refusing partial College registration schema: expected zero or all five target tables';
    END IF;

    IF to_regclass('public.users') IS NULL THEN
        RAISE EXCEPTION 'College registration schema requires public.users';
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
        RAISE EXCEPTION 'College registration schema requires public.users.id INTEGER NOT NULL';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint AS constraint_info
         WHERE constraint_info.conrelid = 'public.users'::regclass
           AND constraint_info.contype = 'p'
           AND constraint_info.conkey = ARRAY[users_id_attnum]::SMALLINT[]
    ) THEN
        RAISE EXCEPTION 'College registration schema requires public.users(id) primary key';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns AS column_info
         WHERE column_info.table_schema = 'public'
           AND column_info.table_name = 'users'
           AND column_info.column_name = 'email'
           AND column_info.data_type = 'character varying'
           AND column_info.character_maximum_length = 150
           AND column_info.is_nullable = 'NO'
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_index AS index_info
         WHERE index_info.indrelid = 'public.users'::regclass
           AND index_info.indisunique
           AND index_info.indpred IS NULL
           AND (
               SELECT array_agg(attribute.attname ORDER BY key_column.ordinality)
                 FROM unnest(index_info.indkey) WITH ORDINALITY AS key_column(attnum, ordinality)
                 JOIN pg_attribute AS attribute
                   ON attribute.attrelid = index_info.indrelid
                  AND attribute.attnum = key_column.attnum
                WHERE key_column.ordinality <= index_info.indnkeyatts
           ) = ARRAY['email']::name[]
    ) THEN
        RAISE EXCEPTION 'College registration schema requires public.users.email VARCHAR(150) NOT NULL UNIQUE';
    END IF;

    IF target_table_count = 5 AND (
        to_regclass('public.colleges') IS NULL
        OR to_regclass('public.college_memberships') IS NULL
        OR to_regclass('public.college_status_history') IS NULL
        OR to_regclass('public.college_registration_applications') IS NULL
        OR to_regclass('public.college_registration_reviews') IS NULL
    ) THEN
        RAISE EXCEPTION 'College registration target relations are not ordinary public tables';
    END IF;

    -- If a prior partial/manual install left incompatible profile fields,
    -- stop before ALTER TABLE IF NOT EXISTS could silently accept them.
    IF to_regclass('public.colleges') IS NOT NULL AND EXISTS (
        SELECT 1
          FROM (VALUES
              ('college_type', 80), ('address', 255), ('city', 100),
              ('state', 100), ('postal_code', 20), ('country', 80),
              ('official_email', 254), ('contact_number', 20), ('website', 2048)
          ) AS expected(column_name, character_limit)
          JOIN information_schema.columns AS actual
            ON actual.table_schema = 'public'
           AND actual.table_name = 'colleges'
           AND actual.column_name = expected.column_name
         WHERE actual.data_type <> 'character varying'
            OR actual.character_maximum_length <> expected.character_limit
            OR actual.is_nullable <> 'YES'
    ) THEN
        RAISE EXCEPTION 'Existing public.colleges profile column conflicts with the registration schema';
    END IF;
END;
$schema_preflight$;

CREATE TABLE IF NOT EXISTS public.colleges (
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

CREATE UNIQUE INDEX IF NOT EXISTS ix_colleges_slug
    ON public.colleges (slug);

CREATE TABLE IF NOT EXISTS public.college_memberships (
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
    CONSTRAINT uq_college_memberships_id_user_college UNIQUE (id, user_id, college_id),
    CONSTRAINT ck_college_memberships_role CHECK (role IN ('college_admin', 'teacher', 'student')),
    CONSTRAINT ck_college_memberships_status CHECK (status IN ('pending', 'active', 'suspended', 'revoked'))
);

CREATE INDEX IF NOT EXISTS ix_college_memberships_user_status
    ON public.college_memberships (user_id, status);
CREATE INDEX IF NOT EXISTS ix_college_memberships_college_status
    ON public.college_memberships (college_id, status);

ALTER TABLE public.colleges ADD COLUMN IF NOT EXISTS college_type VARCHAR(80);
ALTER TABLE public.colleges ADD COLUMN IF NOT EXISTS address VARCHAR(255);
ALTER TABLE public.colleges ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE public.colleges ADD COLUMN IF NOT EXISTS state VARCHAR(100);
ALTER TABLE public.colleges ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20);
ALTER TABLE public.colleges ADD COLUMN IF NOT EXISTS country VARCHAR(80);
ALTER TABLE public.colleges ADD COLUMN IF NOT EXISTS official_email VARCHAR(254);
ALTER TABLE public.colleges ADD COLUMN IF NOT EXISTS contact_number VARCHAR(20);
ALTER TABLE public.colleges ADD COLUMN IF NOT EXISTS website VARCHAR(2048);

CREATE TABLE IF NOT EXISTS public.college_status_history (
    id SERIAL PRIMARY KEY,
    college_id INTEGER NOT NULL REFERENCES public.colleges(id) ON DELETE RESTRICT,
    actor_user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    action VARCHAR(32) NOT NULL,
    previous_status VARCHAR(20),
    new_status VARCHAR(20) NOT NULL,
    reason VARCHAR(1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_college_status_history_action
        CHECK (action IN ('provisioned_pending', 'approved_and_activated', 'suspended', 'reactivated')),
    CONSTRAINT ck_college_status_history_new_status
        CHECK (new_status IN ('pending', 'active', 'suspended', 'archived'))
);

CREATE INDEX IF NOT EXISTS ix_college_status_history_college_created
    ON public.college_status_history (college_id, created_at);

CREATE TABLE IF NOT EXISTS public.college_registration_applications (
    id SERIAL PRIMARY KEY,
    application_reference VARCHAR(48) NOT NULL UNIQUE,
    tracking_token_digest VARCHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    provisioning_status VARCHAR(24) NOT NULL DEFAULT 'not_started',
    college_name VARCHAR(200) NOT NULL,
    college_type VARCHAR(80) NOT NULL,
    address VARCHAR(255) NOT NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL,
    postal_code VARCHAR(20) NOT NULL,
    country VARCHAR(80) NOT NULL,
    official_email VARCHAR(254) NOT NULL,
    contact_number VARCHAR(20) NOT NULL,
    website VARCHAR(2048),
    admin_name VARCHAR(120) NOT NULL,
    admin_email VARCHAR(254) NOT NULL,
    admin_contact_number VARCHAR(20) NOT NULL,
    admin_password_hash VARCHAR(255),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by_user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    review_reason VARCHAR(1000),
    college_id INTEGER REFERENCES public.colleges(id) ON DELETE RESTRICT,
    admin_user_id INTEGER REFERENCES public.users(id) ON DELETE RESTRICT,
    CONSTRAINT ck_college_registration_applications_status
        CHECK (status IN ('pending', 'under_review', 'approved', 'rejected')),
    CONSTRAINT ck_college_registration_applications_provisioning_status
        CHECK (provisioning_status IN ('not_started', 'pending_activation', 'activated', 'rejected'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_college_registration_applications_active_official_email
    ON public.college_registration_applications (official_email)
    WHERE status <> 'rejected';
CREATE UNIQUE INDEX IF NOT EXISTS uq_college_registration_applications_active_admin_email
    ON public.college_registration_applications (admin_email)
    WHERE status <> 'rejected';
CREATE INDEX IF NOT EXISTS ix_college_registration_applications_status_submitted
    ON public.college_registration_applications (status, submitted_at);

CREATE TABLE IF NOT EXISTS public.college_registration_reviews (
    id SERIAL PRIMARY KEY,
    application_id INTEGER NOT NULL REFERENCES public.college_registration_applications(id) ON DELETE RESTRICT,
    reviewer_user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    decision VARCHAR(20) NOT NULL,
    reason VARCHAR(1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_college_registration_reviews_decision
        CHECK (decision IN ('under_review', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS ix_college_registration_reviews_application_created
    ON public.college_registration_reviews (application_id, created_at);

COMMENT ON COLUMN public.college_registration_applications.tracking_token_digest
    IS 'SHA-256 digest of a high-entropy one-time-displayed status token; never store the raw token.';
COMMENT ON COLUMN public.college_registration_applications.admin_password_hash
    IS 'Existing password hasher output only; cleared when provisioned or rejected. Never plaintext.';
COMMENT ON COLUMN public.college_registration_applications.provisioning_status
    IS 'Approval immediately activates the College, College Admin account and membership.';

DO $schema_postflight$
DECLARE
    target_table_count INTEGER;
    expected_index TEXT;
BEGIN
    SELECT count(*)
      INTO target_table_count
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relkind IN ('r', 'p')
       AND relation.relname = ANY (ARRAY[
           'colleges',
           'college_memberships',
           'college_status_history',
           'college_registration_applications',
           'college_registration_reviews'
       ]);

    IF target_table_count <> 5 THEN
        RAISE EXCEPTION 'College registration schema postflight expected all five target tables';
    END IF;

    IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.users'::regclass AND contype = 'p') <> 1 THEN
        RAISE EXCEPTION 'College registration schema postflight failed users primary-key check';
    END IF;

    IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.college_memberships'::regclass AND contype = 'f') <> 5
       OR (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.college_status_history'::regclass AND contype = 'f') <> 2
       OR (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.college_registration_applications'::regclass AND contype = 'f') <> 3
       OR (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.college_registration_reviews'::regclass AND contype = 'f') <> 2 THEN
        RAISE EXCEPTION 'College registration schema postflight failed foreign-key count check';
    END IF;

    FOREACH expected_index IN ARRAY ARRAY[
        'ix_colleges_slug',
        'ix_college_memberships_user_status',
        'ix_college_memberships_college_status',
        'ix_college_status_history_college_created',
        'uq_college_registration_applications_active_official_email',
        'uq_college_registration_applications_active_admin_email',
        'ix_college_registration_applications_status_submitted',
        'ix_college_registration_reviews_application_created'
    ] LOOP
        IF to_regclass('public.' || expected_index) IS NULL THEN
            RAISE EXCEPTION 'College registration schema postflight missing expected index %', expected_index;
        END IF;
    END LOOP;
END;
$schema_postflight$;

COMMIT;
