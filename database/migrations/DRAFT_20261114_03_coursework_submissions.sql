-- STATUS: DRAFT / NOT APPLIED. Coursework preparation only.
-- Depends on DRAFT_20261114_01_student_account_links and
-- DRAFT_20261114_02_coursework_assignments, plus live students(id, college_id).
-- Enrollment and verified active account-link checks remain mandatory in the
-- future service on every request; this table does not grant access by itself.
-- The database guard below prevents a logical submission header for draft/archived work.

BEGIN;

DO $preflight$
BEGIN
    IF to_regclass('public.student_account_links') IS NULL
       OR to_regclass('public.coursework_assignments') IS NULL
       OR to_regclass('public.students') IS NULL THEN
        RAISE EXCEPTION 'Draft 03 requires Draft 01 account links, Draft 02 assignments, and live students';
    END IF;
    IF EXISTS (
        SELECT 1 FROM (VALUES
            ('student_account_links','id','int4', TRUE), ('student_account_links','student_id','int4', TRUE),
            ('student_account_links','user_id','int4', TRUE), ('student_account_links','college_id','int4', TRUE),
            ('student_account_links','link_status','varchar', TRUE), ('student_account_links','verified_by_user_id','int4', TRUE),
            ('student_account_links','verified_at','timestamptz', TRUE), ('student_account_links','revoked_by_user_id','int4', FALSE),
            ('student_account_links','revoked_at','timestamptz', FALSE), ('student_account_links','revocation_reason','text', FALSE),
            ('student_account_links','created_at','timestamptz', TRUE),
            ('coursework_assignments','id','int4', TRUE), ('coursework_assignments','college_id','int4', TRUE),
            ('coursework_assignments','status','varchar', TRUE),
            ('students','id','int4', TRUE), ('students','college_id','int4', FALSE)
        ) AS required(rel_name,col_name,type_name,must_be_not_null)
        LEFT JOIN pg_class rel ON rel.oid=to_regclass('public.'||required.rel_name)
        LEFT JOIN pg_attribute att ON att.attrelid=rel.oid AND att.attname=required.col_name AND att.attnum>0 AND NOT att.attisdropped
        LEFT JOIN pg_type typ ON typ.oid=att.atttypid
        WHERE att.attnum IS NULL OR typ.typname::text <> required.type_name
           OR (required.must_be_not_null AND NOT att.attnotnull)
    ) THEN
        RAISE EXCEPTION 'Draft 03 prerequisite column is missing or has an incompatible PostgreSQL type';
    END IF;
    IF EXISTS (
        SELECT 1 FROM (VALUES ('student_account_links','link_status'),('coursework_assignments','status')) required(rel_name,col_name)
        JOIN pg_class rel ON rel.oid=to_regclass('public.'||required.rel_name)
        JOIN pg_attribute att ON att.attrelid=rel.oid AND att.attname=required.col_name AND att.attnum>0 AND NOT att.attisdropped
        WHERE format_type(att.atttypid,att.atttypmod)<>'character varying(12)'
    ) THEN
        RAISE EXCEPTION 'Draft 03 requires account-link and assignment status columns to be VARCHAR(12)';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.student_account_links'::regclass
               AND attname IN ('revoked_by_user_id','revoked_at','revocation_reason') AND attnotnull) THEN
        RAISE EXCEPTION 'Draft 03 requires the account-link revocation fields to remain nullable';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute att JOIN pg_type typ ON typ.oid=att.atttypid
        WHERE att.attrelid='public.coursework_assignments'::regclass AND att.attname='archived_at'
          AND att.attnum>0 AND NOT att.attisdropped AND typ.typname::text='timestamptz' AND NOT att.attnotnull
    ) THEN
        RAISE EXCEPTION 'Draft 03 requires nullable coursework_assignments.archived_at TIMESTAMPTZ';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='id'
        JOIN pg_attribute b ON b.attrelid=c.conrelid AND b.attname='college_id'
        WHERE c.conrelid='public.coursework_assignments'::regclass AND c.conname='uq_coursework_assignments_id_college'
          AND c.contype='u' AND c.conkey=ARRAY[a.attnum,b.attnum]::smallint[]
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='id'
        JOIN pg_attribute b ON b.attrelid=c.conrelid AND b.attname='college_id'
        WHERE c.conrelid='public.students'::regclass AND c.conname='uq_students_id_college'
          AND c.contype='u' AND c.conkey=ARRAY[a.attnum,b.attnum]::smallint[]
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='id'
        WHERE c.conrelid='public.student_account_links'::regclass AND c.contype='p' AND c.conkey=ARRAY[a.attnum]::smallint[]
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conrelid='public.coursework_assignments'::regclass
          AND conname='ck_coursework_assignments_status' AND contype='c'
          AND position('draft' in lower(pg_get_constraintdef(oid)))>0
          AND position('published' in lower(pg_get_constraintdef(oid)))>0
          AND position('archived' in lower(pg_get_constraintdef(oid)))>0
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conrelid='public.student_account_links'::regclass
          AND conname='ck_student_account_links_status' AND contype='c'
          AND position('active' in lower(pg_get_constraintdef(oid)))>0
          AND position('revoked' in lower(pg_get_constraintdef(oid)))>0
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conrelid='public.student_account_links'::regclass
          AND conname='ck_student_account_links_revocation' AND contype='c'
          AND position('revoked_by_user_id' in lower(pg_get_constraintdef(oid)))>0
          AND position('revoked_at' in lower(pg_get_constraintdef(oid)))>0
          AND position('revocation_reason' in lower(pg_get_constraintdef(oid)))>0
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_index ix JOIN pg_attribute a ON a.attrelid=ix.indrelid AND a.attname='student_id'
        WHERE ix.indexrelid=to_regclass('public.uq_student_account_links_active_student')
          AND ix.indrelid='public.student_account_links'::regclass AND ix.indisunique
          -- pg_index.indkey is an int2vector with a zero-based lower bound.
          AND ix.indpred IS NOT NULL AND ix.indnkeyatts=1 AND ix.indkey[0]=a.attnum
          AND pg_get_expr(ix.indpred,ix.indrelid) ILIKE '%link_status%' AND pg_get_expr(ix.indpred,ix.indrelid) ILIKE '%active%'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_index ix
        JOIN pg_attribute a ON a.attrelid=ix.indrelid AND a.attname='user_id'
        JOIN pg_attribute b ON b.attrelid=ix.indrelid AND b.attname='college_id'
        WHERE ix.indexrelid=to_regclass('public.uq_student_account_links_active_user_college')
          AND ix.indrelid='public.student_account_links'::regclass AND ix.indisunique
          AND ix.indpred IS NOT NULL AND ix.indnkeyatts=2
          AND ix.indkey[0]=a.attnum AND ix.indkey[1]=b.attnum
          AND pg_get_expr(ix.indpred,ix.indrelid) ILIKE '%link_status%' AND pg_get_expr(ix.indpred,ix.indrelid) ILIKE '%active%'
    ) THEN
        RAISE EXCEPTION 'Draft 03 prerequisite keys, account-link status constraint, or active-link unique indexes are absent/incompatible';
    END IF;
    IF to_regclass('public.coursework_submissions') IS NOT NULL
       OR to_regprocedure('public.attendx_guard_coursework_submission_header()') IS NOT NULL
       OR to_regprocedure('public.attendx_reject_coursework_submission_truncate()') IS NOT NULL THEN
        RAISE EXCEPTION 'Coursework submission objects already exist; reconcile partial or prior application first';
    END IF;
END;
$preflight$;

CREATE TABLE public.coursework_submissions (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    coursework_assignment_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    college_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_coursework_submissions_id_college UNIQUE (id, college_id),
    CONSTRAINT uq_coursework_submissions_assignment_student UNIQUE (coursework_assignment_id, student_id, college_id),
    CONSTRAINT fk_coursework_submissions_assignment_college FOREIGN KEY (coursework_assignment_id, college_id)
        REFERENCES public.coursework_assignments (id, college_id) ON DELETE RESTRICT,
    CONSTRAINT fk_coursework_submissions_student_college FOREIGN KEY (student_id, college_id)
        REFERENCES public.students (id, college_id) ON DELETE RESTRICT
);

CREATE INDEX ix_coursework_submissions_student
    ON public.coursework_submissions (college_id, student_id, created_at DESC);
CREATE INDEX ix_coursework_submissions_assignment
    ON public.coursework_submissions (college_id, coursework_assignment_id, created_at);
-- Exact referencing-key order for each composite FK; existing query indexes are
-- retained because they serve distinct College-first listing access patterns.
CREATE INDEX ix_coursework_submissions_assignment_college_fk
    ON public.coursework_submissions (coursework_assignment_id, college_id);
CREATE INDEX ix_coursework_submissions_student_college_fk
    ON public.coursework_submissions (student_id, college_id);

CREATE FUNCTION public.attendx_guard_coursework_submission_header()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
DECLARE
    assignment_found BOOLEAN;
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Assignment is the first lock in the documented global submit lock order.
        -- FOR SHARE conflicts with publication/deadline/archive UPDATE locks, so the
        -- state checked here cannot change until this transaction finishes.
        SELECT TRUE INTO assignment_found
          FROM public.coursework_assignments assignment
         WHERE assignment.id=NEW.coursework_assignment_id
           AND assignment.college_id=NEW.college_id
           AND assignment.status='published'
           AND assignment.archived_at IS NULL
         FOR SHARE;
        IF assignment_found IS DISTINCT FROM TRUE THEN
            RAISE EXCEPTION 'A submission header requires a published, non-archived assignment';
        END IF;
        NEW.created_at := clock_timestamp();
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Coursework submission identity and creation time are immutable';
    END IF;
    RAISE EXCEPTION 'Coursework submission headers cannot be physically deleted';
END;
$function$;

CREATE TRIGGER trg_coursework_submission_header_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.coursework_submissions
    FOR EACH ROW EXECUTE FUNCTION public.attendx_guard_coursework_submission_header();

CREATE FUNCTION public.attendx_reject_coursework_submission_truncate()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    RAISE EXCEPTION 'Coursework submission history cannot be truncated';
END;
$function$;

CREATE TRIGGER trg_coursework_submission_no_truncate
    BEFORE TRUNCATE ON public.coursework_submissions
    FOR EACH STATEMENT EXECUTE FUNCTION public.attendx_reject_coursework_submission_truncate();

COMMIT;
