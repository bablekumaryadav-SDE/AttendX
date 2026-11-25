-- STATUS: DRAFT / NOT APPLIED. Coursework preparation only.
-- Depends on DRAFT_20261114_03_coursework_submissions.
-- The INSERT trigger owns submitted_at and is_late. Updates/deletes are rejected
-- by a trigger for ordinary application sessions; database owners/superusers can
-- still bypass trigger protections, so permissions and operational custody matter.
-- TRUNCATE is separately guarded for ordinary sessions; it is not tamper-proof storage.

BEGIN;

DO $preflight$
BEGIN
    IF to_regclass('public.student_account_links') IS NULL
       OR to_regclass('public.coursework_submissions') IS NULL
       OR to_regclass('public.coursework_assignments') IS NULL THEN
        RAISE EXCEPTION 'Draft 04 requires Draft 01 account links, Draft 02 assignments, and Draft 03 submissions';
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
            ('coursework_assignments','due_at','timestamptz', TRUE), ('coursework_assignments','status','varchar', TRUE),
            ('coursework_assignments','archived_at','timestamptz', FALSE),
            ('coursework_submissions','id','int4', TRUE), ('coursework_submissions','coursework_assignment_id','int4', TRUE),
            ('coursework_submissions','college_id','int4', TRUE)
        ) AS required(rel_name,col_name,type_name,must_be_not_null)
        LEFT JOIN pg_class rel ON rel.oid=to_regclass('public.'||required.rel_name)
        LEFT JOIN pg_attribute att ON att.attrelid=rel.oid AND att.attname=required.col_name AND att.attnum>0 AND NOT att.attisdropped
        LEFT JOIN pg_type typ ON typ.oid=att.atttypid
        WHERE att.attnum IS NULL OR typ.typname::text <> required.type_name
           OR (required.must_be_not_null AND NOT att.attnotnull)
    ) THEN
        RAISE EXCEPTION 'Draft 04 prerequisite column is missing or has an incompatible PostgreSQL type';
    END IF;
    IF EXISTS (
        SELECT 1 FROM (VALUES ('student_account_links','link_status'),('coursework_assignments','status')) required(rel_name,col_name)
        JOIN pg_class rel ON rel.oid=to_regclass('public.'||required.rel_name)
        JOIN pg_attribute att ON att.attrelid=rel.oid AND att.attname=required.col_name AND att.attnum>0 AND NOT att.attisdropped
        WHERE format_type(att.atttypid,att.atttypmod)<>'character varying(12)'
    ) THEN
        RAISE EXCEPTION 'Draft 04 requires account-link and assignment status columns to be VARCHAR(12)';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.student_account_links'::regclass
               AND attname IN ('revoked_by_user_id','revoked_at','revocation_reason') AND attnotnull) THEN
        RAISE EXCEPTION 'Draft 04 requires the account-link revocation fields to remain nullable';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute att JOIN pg_type typ ON typ.oid=att.atttypid
        WHERE att.attrelid='public.coursework_assignments'::regclass AND att.attname='archived_at'
          AND att.attnum>0 AND NOT att.attisdropped AND typ.typname::text='timestamptz' AND NOT att.attnotnull
    ) THEN
        RAISE EXCEPTION 'Draft 04 requires nullable coursework_assignments.archived_at TIMESTAMPTZ';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='id'
        JOIN pg_attribute b ON b.attrelid=c.conrelid AND b.attname='college_id'
        WHERE c.conrelid='public.coursework_submissions'::regclass AND c.conname='uq_coursework_submissions_id_college'
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
        SELECT 1 FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='id'
        JOIN pg_attribute b ON b.attrelid=c.conrelid AND b.attname='college_id'
        WHERE c.conrelid='public.coursework_assignments'::regclass AND c.conname='uq_coursework_assignments_id_college'
          AND c.contype='u' AND c.conkey=ARRAY[a.attnum,b.attnum]::smallint[]
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
        RAISE EXCEPTION 'Draft 04 prerequisite keys, account-link status constraint, or active-link unique indexes are absent/incompatible';
    END IF;
    IF to_regclass('public.coursework_submission_revisions') IS NOT NULL
       OR to_regprocedure('public.attendx_set_coursework_revision_server_fields()') IS NOT NULL
       OR to_regprocedure('public.attendx_reject_coursework_revision_mutation()') IS NOT NULL
       OR to_regprocedure('public.attendx_reject_coursework_revision_truncate()') IS NOT NULL THEN
        RAISE EXCEPTION 'Coursework revision objects already exist; reconcile partial or prior application first';
    END IF;
END;
$preflight$;

CREATE TABLE public.coursework_submission_revisions (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    coursework_submission_id INTEGER NOT NULL,
    college_id INTEGER NOT NULL,
    revision_number INTEGER NOT NULL,
    idempotency_key UUID NOT NULL,
    content TEXT NOT NULL,
    submitted_at TIMESTAMPTZ NOT NULL,
    is_late BOOLEAN NOT NULL,
    CONSTRAINT ck_coursework_revision_number CHECK (revision_number >= 1),
    CONSTRAINT ck_coursework_revision_content CHECK (length(trim(content)) > 0),
    CONSTRAINT uq_coursework_revision_id_college UNIQUE (id, college_id),
    CONSTRAINT uq_coursework_revision_number UNIQUE (coursework_submission_id, revision_number),
    CONSTRAINT uq_coursework_revision_idempotency UNIQUE (coursework_submission_id, idempotency_key),
    CONSTRAINT fk_coursework_revision_submission_college FOREIGN KEY (coursework_submission_id, college_id)
        REFERENCES public.coursework_submissions (id, college_id) ON DELETE RESTRICT
);

CREATE INDEX ix_coursework_revisions_submission_order
    ON public.coursework_submission_revisions (college_id, coursework_submission_id, revision_number DESC);
CREATE INDEX ix_coursework_revisions_submission_college_fk
    ON public.coursework_submission_revisions (coursework_submission_id, college_id);

CREATE FUNCTION public.attendx_set_coursework_revision_server_fields()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
DECLARE
    assignment_due_at TIMESTAMPTZ;
BEGIN
    SELECT assignment.due_at INTO assignment_due_at
      FROM public.coursework_submissions AS submission
      JOIN public.coursework_assignments AS assignment
        ON assignment.id = submission.coursework_assignment_id
       AND assignment.college_id = submission.college_id
     WHERE submission.id = NEW.coursework_submission_id
       AND submission.college_id = NEW.college_id
       AND assignment.status = 'published'
       AND assignment.archived_at IS NULL
     FOR SHARE OF assignment;
    IF assignment_due_at IS NULL THEN
        RAISE EXCEPTION 'Submission requires a published assignment';
    END IF;
    NEW.submitted_at := clock_timestamp();
    NEW.is_late := NEW.submitted_at > assignment_due_at;
    RETURN NEW;
END;
$function$;

CREATE FUNCTION public.attendx_reject_coursework_revision_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    RAISE EXCEPTION 'Coursework submission revisions are append-only';
END;
$function$;

CREATE TRIGGER trg_coursework_revision_server_fields
    BEFORE INSERT ON public.coursework_submission_revisions
    FOR EACH ROW EXECUTE FUNCTION public.attendx_set_coursework_revision_server_fields();
CREATE TRIGGER trg_coursework_revision_no_update
    BEFORE UPDATE OR DELETE ON public.coursework_submission_revisions
    FOR EACH ROW EXECUTE FUNCTION public.attendx_reject_coursework_revision_mutation();

CREATE FUNCTION public.attendx_reject_coursework_revision_truncate()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    RAISE EXCEPTION 'Coursework submission revision history cannot be truncated';
END;
$function$;

CREATE TRIGGER trg_coursework_revision_no_truncate
    BEFORE TRUNCATE ON public.coursework_submission_revisions
    FOR EACH STATEMENT EXECUTE FUNCTION public.attendx_reject_coursework_revision_truncate();

COMMIT;
