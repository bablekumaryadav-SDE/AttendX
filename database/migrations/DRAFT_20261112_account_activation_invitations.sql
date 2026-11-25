-- STATUS: DRAFT / NOT APPLIED
-- Requires the tenant ownership/foundation and student/teacher registration drafts.
-- Adds one-use invitation state; token plaintext is never stored in this table.
-- Review against an approved, isolated PostgreSQL catalog before any execution.

BEGIN;

DO $activation_preflight$
DECLARE
    membership_id_attnum SMALLINT;
    membership_user_id_attnum SMALLINT;
    membership_college_id_attnum SMALLINT;
BEGIN
    IF to_regclass('public.users') IS NULL
       OR to_regclass('public.colleges') IS NULL
       OR to_regclass('public.college_memberships') IS NULL
       OR to_regclass('public.students') IS NULL
       OR to_regclass('public.teachers') IS NULL THEN
        RAISE EXCEPTION 'Account activation requires the tenant and Student/Teacher schema drafts';
    END IF;

    SELECT attnum INTO membership_id_attnum
      FROM pg_attribute
     WHERE attrelid = 'public.college_memberships'::regclass
       AND attname = 'id' AND attnum > 0 AND NOT attisdropped;
    SELECT attnum INTO membership_user_id_attnum
      FROM pg_attribute
     WHERE attrelid = 'public.college_memberships'::regclass
       AND attname = 'user_id' AND attnum > 0 AND NOT attisdropped;
    SELECT attnum INTO membership_college_id_attnum
      FROM pg_attribute
     WHERE attrelid = 'public.college_memberships'::regclass
       AND attname = 'college_id' AND attnum > 0 AND NOT attisdropped;

    IF membership_id_attnum IS NULL
       OR membership_user_id_attnum IS NULL
       OR membership_college_id_attnum IS NULL
       OR NOT EXISTS (
            SELECT 1
              FROM pg_constraint AS constraint_info
             WHERE constraint_info.conrelid = 'public.college_memberships'::regclass
               AND constraint_info.conname = 'uq_college_memberships_id_user_college'
               AND constraint_info.contype = 'u'
               AND constraint_info.conkey = ARRAY[
                    membership_id_attnum,
                    membership_user_id_attnum,
                    membership_college_id_attnum
               ]::SMALLINT[]
       ) THEN
        RAISE EXCEPTION 'Account activation requires UNIQUE (id, user_id, college_id) on public.college_memberships from tenant foundation v2';
    END IF;
END;
$activation_preflight$;

CREATE TABLE public.account_invitations (
    id SERIAL PRIMARY KEY,
    college_id INTEGER NOT NULL REFERENCES public.colleges(id) ON DELETE RESTRICT,
    membership_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    token_digest VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    delivery_status VARCHAR(20) NOT NULL,
    sent_at TIMESTAMPTZ,
    created_by_user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_account_invitations_membership_user_college
        FOREIGN KEY (membership_id, user_id, college_id)
        REFERENCES public.college_memberships(id, user_id, college_id)
        ON DELETE RESTRICT,
    CONSTRAINT ck_account_invitations_delivery_status
        CHECK (delivery_status IN ('sent', 'failed'))
);

CREATE INDEX ix_account_invitations_college_membership_created
    ON public.account_invitations (college_id, membership_id, created_at);
CREATE INDEX ix_account_invitations_expiry
    ON public.account_invitations (expires_at);

COMMENT ON TABLE public.account_invitations IS
    'One-use account setup invitations. Stores SHA-256 token digests only; raw token is delivered once.';

COMMIT;

-- DOWNGRADE PLAN ONLY: no automatic downgrade is supplied. Dropping this table
-- removes invitation and delivery audit state; removing the membership unique
-- key can invalidate the composite invitation relationship. Prefer a verified
-- backup/restore in an isolated development rehearsal or a separately reviewed
-- forward repair. No downgrade is authorized by this draft.
