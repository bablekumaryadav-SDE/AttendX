-- STATUS: DRAFT / NOT APPLIED
-- Phase 14A.30: editable College profile fields and status-change audit.
-- Requires the reviewed tenant foundation. Apply this before enabling the
-- Phase 14A.29 application approval handler, which writes the College profile
-- fields and status-history event defined below. It can follow the foundation
-- and precede the registration workflow.
-- No existing College, membership, user, or application rows are backfilled.
-- Apply only after separate migration approval and isolated PostgreSQL rehearsal.

BEGIN;

DO $college_status_history_preflight$
DECLARE
    expected_column RECORD;
    actual_type TEXT;
    actual_length INTEGER;
    actual_nullable TEXT;
BEGIN
    IF to_regclass('public.users') IS NULL
       OR to_regclass('public.colleges') IS NULL THEN
        RAISE EXCEPTION 'College status history requires public.users and public.colleges from the tenant foundation';
    END IF;

    -- ADD COLUMN IF NOT EXISTS alone could silently accept a conflicting
    -- legacy definition. Existing profile columns must match the nullable
    -- VARCHAR contract before the additive DDL is allowed to continue.
    FOR expected_column IN
        SELECT * FROM (VALUES
            ('college_type', 80),
            ('address', 255),
            ('city', 100),
            ('state', 100),
            ('postal_code', 20),
            ('country', 80),
            ('official_email', 254),
            ('contact_number', 20),
            ('website', 2048)
        ) AS expected(column_name, character_limit)
    LOOP
        SELECT data_type, character_maximum_length, is_nullable
          INTO actual_type, actual_length, actual_nullable
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'colleges'
           AND column_name = expected_column.column_name;

        IF FOUND AND (
            actual_type <> 'character varying'
            OR actual_length <> expected_column.character_limit
            OR actual_nullable <> 'YES'
        ) THEN
            RAISE EXCEPTION 'Existing public.colleges.% column is incompatible with the expected nullable VARCHAR(%) definition',
                expected_column.column_name, expected_column.character_limit;
        END IF;
    END LOOP;
END;
$college_status_history_preflight$;

-- Nullable additive profile fields preserve existing Colleges without making
-- assumptions or backfilling their ownership or registration details.
ALTER TABLE public.colleges ADD COLUMN IF NOT EXISTS college_type VARCHAR(80);
ALTER TABLE public.colleges ADD COLUMN IF NOT EXISTS address VARCHAR(255);
ALTER TABLE public.colleges ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE public.colleges ADD COLUMN IF NOT EXISTS state VARCHAR(100);
ALTER TABLE public.colleges ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20);
ALTER TABLE public.colleges ADD COLUMN IF NOT EXISTS country VARCHAR(80);
ALTER TABLE public.colleges ADD COLUMN IF NOT EXISTS official_email VARCHAR(254);
ALTER TABLE public.colleges ADD COLUMN IF NOT EXISTS contact_number VARCHAR(20);
ALTER TABLE public.colleges ADD COLUMN IF NOT EXISTS website VARCHAR(2048);

CREATE TABLE public.college_status_history (
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

CREATE INDEX ix_college_status_history_college_created
    ON public.college_status_history (college_id, created_at);

COMMIT;

-- Manual rollback proposal only; destroys status-history records. Do not run automatically.
-- BEGIN;
-- DROP TABLE public.college_status_history;
-- COMMIT;
