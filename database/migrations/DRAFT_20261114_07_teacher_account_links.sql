-- STATUS: DRAFT / NOT APPLIED. Explicit Teacher identity binding prerequisite.
-- Requires public.teachers(id, college_id), public.college_memberships(user_id, college_id),
-- and public.college_memberships(id, user_id, college_id), all INTEGER keys with the
-- exact unique-key order checked below. This migration creates no links and uses no
-- email, name, phone, or employee-number matching.
-- A College Admin workflow must explicitly select both existing records and attest
-- that identity was verified before inserting an active link. Do not store identity
-- documents or sensitive evidence in this table.
-- Apply only after migration review, a verified isolated PostgreSQL rehearsal, and
-- separate explicit approval. No downgrade is supplied because link history is retained.

BEGIN;

DO $preflight$
BEGIN
    IF to_regclass('public.teachers') IS NULL
       OR to_regclass('public.college_memberships') IS NULL THEN
        RAISE EXCEPTION 'Teacher account links require public.teachers and public.college_memberships';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM (VALUES
              ('teachers', 'id', 'int4', TRUE),
              ('teachers', 'college_id', 'int4', FALSE),
              ('college_memberships', 'id', 'int4', TRUE),
              ('college_memberships', 'user_id', 'int4', TRUE),
              ('college_memberships', 'college_id', 'int4', TRUE)
          ) AS required(table_name, column_name, type_name, must_be_not_null)
          LEFT JOIN pg_class relation
            ON relation.oid = to_regclass('public.' || required.table_name)
          LEFT JOIN pg_attribute attribute
            ON attribute.attrelid = relation.oid
           AND attribute.attname = required.column_name
           AND attribute.attnum > 0
           AND NOT attribute.attisdropped
          LEFT JOIN pg_type type ON type.oid = attribute.atttypid
         WHERE attribute.attnum IS NULL
            OR type.typname::text <> required.type_name
            OR (required.must_be_not_null AND attribute.attnotnull IS FALSE)
    ) THEN
        RAISE EXCEPTION 'Teacher and College membership INTEGER NOT NULL columns are missing or incompatible';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint constraint_row
          JOIN pg_attribute id_attribute
            ON id_attribute.attrelid = constraint_row.conrelid AND id_attribute.attname = 'id'
          JOIN pg_attribute college_attribute
            ON college_attribute.attrelid = constraint_row.conrelid AND college_attribute.attname = 'college_id'
         WHERE constraint_row.conrelid = 'public.teachers'::regclass
           AND constraint_row.contype = 'u'
           AND constraint_row.conname = 'uq_teachers_id_college'
           AND constraint_row.conkey = ARRAY[id_attribute.attnum, college_attribute.attnum]::smallint[]
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_constraint constraint_row
          JOIN pg_attribute user_attribute
            ON user_attribute.attrelid = constraint_row.conrelid AND user_attribute.attname = 'user_id'
          JOIN pg_attribute college_attribute
            ON college_attribute.attrelid = constraint_row.conrelid AND college_attribute.attname = 'college_id'
         WHERE constraint_row.conrelid = 'public.college_memberships'::regclass
           AND constraint_row.contype = 'u'
           AND constraint_row.conname = 'uq_college_memberships_user_college'
           AND constraint_row.conkey = ARRAY[user_attribute.attnum, college_attribute.attnum]::smallint[]
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_constraint constraint_row
          JOIN pg_attribute id_attribute
            ON id_attribute.attrelid = constraint_row.conrelid AND id_attribute.attname = 'id'
          JOIN pg_attribute user_attribute
            ON user_attribute.attrelid = constraint_row.conrelid AND user_attribute.attname = 'user_id'
          JOIN pg_attribute college_attribute
            ON college_attribute.attrelid = constraint_row.conrelid AND college_attribute.attname = 'college_id'
         WHERE constraint_row.conrelid = 'public.college_memberships'::regclass
           AND constraint_row.contype = 'u'
           AND constraint_row.conname = 'uq_college_memberships_id_user_college'
           AND constraint_row.conkey = ARRAY[id_attribute.attnum, user_attribute.attnum, college_attribute.attnum]::smallint[]
    ) THEN
        RAISE EXCEPTION 'Required Teacher and membership composite unique keys are absent or have wrong column order';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint constraint_row
        JOIN pg_attribute id_attribute
          ON id_attribute.attrelid = constraint_row.conrelid AND id_attribute.attname = 'id'
        WHERE constraint_row.conrelid = 'public.teachers'::regclass
          AND constraint_row.contype = 'p'
          AND constraint_row.conkey = ARRAY[id_attribute.attnum]::smallint[]
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint constraint_row
        JOIN pg_attribute id_attribute
          ON id_attribute.attrelid = constraint_row.conrelid AND id_attribute.attname = 'id'
        WHERE constraint_row.conrelid = 'public.college_memberships'::regclass
          AND constraint_row.contype = 'p'
          AND constraint_row.conkey = ARRAY[id_attribute.attnum]::smallint[]
    ) THEN
        RAISE EXCEPTION 'Teacher and College membership primary keys are missing or incompatible';
    END IF;

    IF to_regclass('public.teacher_account_links') IS NOT NULL THEN
        RAISE EXCEPTION 'public.teacher_account_links exists; inspect partial or prior application instead of rerunning';
    END IF;
    IF to_regprocedure('public.attendx_guard_teacher_account_link()') IS NOT NULL
       OR to_regprocedure('public.attendx_reject_teacher_account_link_truncate()') IS NOT NULL THEN
        RAISE EXCEPTION 'Teacher account-link guard exists; inspect partial or prior application instead of rerunning';
    END IF;
END;
$preflight$;

CREATE TABLE public.teacher_account_links (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    teacher_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    college_id INTEGER NOT NULL,
    link_status VARCHAR(12) NOT NULL DEFAULT 'active',
    verified_by_user_id INTEGER NOT NULL,
    verified_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    revoked_by_user_id INTEGER,
    revoked_at TIMESTAMPTZ,
    revocation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_teacher_account_links_id_teacher_college UNIQUE (id, teacher_id, college_id),
    CONSTRAINT ck_teacher_account_links_status CHECK (link_status IN ('active', 'revoked')),
    CONSTRAINT ck_teacher_account_links_revocation CHECK (
        (link_status = 'active' AND revoked_by_user_id IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL)
        OR (link_status = 'revoked' AND revoked_by_user_id IS NOT NULL AND revoked_at IS NOT NULL
            AND revocation_reason IS NOT NULL AND length(trim(revocation_reason)) > 0)
    ),
    CONSTRAINT fk_teacher_account_links_teacher_college FOREIGN KEY (teacher_id, college_id)
        REFERENCES public.teachers (id, college_id) ON DELETE RESTRICT,
    CONSTRAINT fk_teacher_account_links_user_college FOREIGN KEY (user_id, college_id)
        REFERENCES public.college_memberships (user_id, college_id) ON DELETE RESTRICT,
    CONSTRAINT fk_teacher_account_links_verifier_membership FOREIGN KEY (verified_by_user_id, college_id)
        REFERENCES public.college_memberships (user_id, college_id) ON DELETE RESTRICT,
    CONSTRAINT fk_teacher_account_links_revoker_membership FOREIGN KEY (revoked_by_user_id, college_id)
        REFERENCES public.college_memberships (user_id, college_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_teacher_account_links_active_teacher
    ON public.teacher_account_links (teacher_id) WHERE link_status = 'active';
CREATE UNIQUE INDEX uq_teacher_account_links_active_user_college
    ON public.teacher_account_links (user_id, college_id) WHERE link_status = 'active';
CREATE INDEX ix_teacher_account_links_college_status
    ON public.teacher_account_links (college_id, link_status);
CREATE INDEX ix_teacher_account_links_user_college_status
    ON public.teacher_account_links (user_id, college_id, link_status);
CREATE INDEX ix_teacher_account_links_teacher_college
    ON public.teacher_account_links (teacher_id, college_id);
CREATE INDEX ix_teacher_account_links_verifier_membership
    ON public.teacher_account_links (verified_by_user_id, college_id);
CREATE INDEX ix_teacher_account_links_revoker_membership
    ON public.teacher_account_links (revoked_by_user_id, college_id);

CREATE FUNCTION public.attendx_guard_teacher_account_link()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Teacher account-link history cannot be physically deleted';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.link_status <> 'active' THEN
            RAISE EXCEPTION 'A Teacher account link requires explicit verification before activation';
        END IF;
        NEW.verified_at := clock_timestamp();
        NEW.created_at := NEW.verified_at;
        RETURN NEW;
    END IF;
    IF OLD.link_status <> 'active' OR NEW.link_status <> 'revoked' THEN
        RAISE EXCEPTION 'A Teacher account link can only transition once from active to revoked';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.teacher_id IS DISTINCT FROM OLD.teacher_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.college_id IS DISTINCT FROM OLD.college_id
       OR NEW.verified_by_user_id IS DISTINCT FROM OLD.verified_by_user_id
       OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Verified Teacher account-link identity fields are immutable';
    END IF;
    IF NEW.revoked_by_user_id IS NULL OR NEW.revocation_reason IS NULL OR length(trim(NEW.revocation_reason)) = 0 THEN
        RAISE EXCEPTION 'Teacher account-link revocation requires an authorized actor and reason';
    END IF;
    NEW.revoked_at := clock_timestamp();
    RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_teacher_account_link_history
    BEFORE INSERT OR UPDATE OR DELETE ON public.teacher_account_links
    FOR EACH ROW EXECUTE FUNCTION public.attendx_guard_teacher_account_link();

CREATE FUNCTION public.attendx_reject_teacher_account_link_truncate()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    RAISE EXCEPTION 'Teacher account-link history cannot be truncated';
END;
$function$;

CREATE TRIGGER trg_teacher_account_link_no_truncate
    BEFORE TRUNCATE ON public.teacher_account_links
    FOR EACH STATEMENT EXECUTE FUNCTION public.attendx_reject_teacher_account_link_truncate();

COMMIT;
