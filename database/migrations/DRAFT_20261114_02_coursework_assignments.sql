-- STATUS: DRAFT / NOT APPLIED. Coursework preparation only.
-- Depends on DRAFT_20261114_01_student_account_links being reviewed/applied first,
-- plus public.teacher_assignments(id, college_id), colleges(id), and
-- college_memberships(id, user_id, college_id), all INTEGER keys.
-- Published rows are not physically deletable; assignment-level mutation guards
-- are installed in DRAFT_20261114_05_coursework_assignment_audit_events.sql.
-- DRAFT_01 is checked as a sequencing prerequisite, not as an authorization substitute.

BEGIN;

DO $preflight$
BEGIN
    IF to_regclass('public.student_account_links') IS NULL
       OR to_regclass('public.teacher_assignments') IS NULL
       OR to_regclass('public.colleges') IS NULL
       OR to_regclass('public.college_memberships') IS NULL THEN
        RAISE EXCEPTION 'Draft 02 requires Draft 01 student_account_links and tenant foundation relations';
    END IF;
    IF EXISTS (
        SELECT 1 FROM (VALUES
            ('student_account_links','id','int4', TRUE), ('student_account_links','student_id','int4', TRUE),
            ('student_account_links','user_id','int4', TRUE), ('student_account_links','college_id','int4', TRUE),
            ('student_account_links','link_status','varchar', TRUE), ('student_account_links','verified_by_user_id','int4', TRUE),
            ('student_account_links','verified_at','timestamptz', TRUE), ('student_account_links','revoked_by_user_id','int4', FALSE),
            ('student_account_links','revoked_at','timestamptz', FALSE), ('student_account_links','revocation_reason','text', FALSE),
            ('student_account_links','created_at','timestamptz', TRUE),
            ('teacher_assignments','id','int4', TRUE), ('teacher_assignments','college_id','int4', FALSE),
            ('colleges','id','int4', TRUE),
            ('college_memberships','id','int4', TRUE), ('college_memberships','user_id','int4', TRUE),
            ('college_memberships','college_id','int4', TRUE)
        ) AS required(rel_name,col_name,type_name,must_be_not_null)
        LEFT JOIN pg_class rel ON rel.oid=to_regclass('public.'||required.rel_name)
        LEFT JOIN pg_attribute att ON att.attrelid=rel.oid AND att.attname=required.col_name AND att.attnum>0 AND NOT att.attisdropped
        LEFT JOIN pg_type typ ON typ.oid=att.atttypid
        WHERE att.attnum IS NULL OR typ.typname::text <> required.type_name
           OR (required.must_be_not_null AND NOT att.attnotnull)
    ) THEN
        RAISE EXCEPTION 'Draft 02 prerequisite column is missing or has an incompatible PostgreSQL type';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute att
        WHERE att.attrelid='public.student_account_links'::regclass AND att.attname='link_status'
          AND att.attnum>0 AND NOT att.attisdropped AND format_type(att.atttypid,att.atttypmod)='character varying(12)'
    ) THEN
        RAISE EXCEPTION 'Draft 02 requires student_account_links.link_status VARCHAR(12)';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.student_account_links'::regclass
               AND attname IN ('revoked_by_user_id','revoked_at','revocation_reason') AND attnotnull) THEN
        RAISE EXCEPTION 'Draft 02 requires the account-link revocation fields to remain nullable';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='id'
        JOIN pg_attribute b ON b.attrelid=c.conrelid AND b.attname='college_id'
        WHERE c.conrelid='public.teacher_assignments'::regclass AND c.conname='uq_teacher_assignments_id_college'
          AND c.contype='u' AND c.conkey=ARRAY[a.attnum,b.attnum]::smallint[]
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='id'
        JOIN pg_attribute b ON b.attrelid=c.conrelid AND b.attname='user_id'
        JOIN pg_attribute d ON d.attrelid=c.conrelid AND d.attname='college_id'
        WHERE c.conrelid='public.college_memberships'::regclass AND c.conname='uq_college_memberships_id_user_college'
          AND c.contype='u' AND c.conkey=ARRAY[a.attnum,b.attnum,d.attnum]::smallint[]
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='id'
        WHERE c.conrelid='public.colleges'::regclass AND c.contype='p' AND c.conkey=ARRAY[a.attnum]::smallint[]
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='id'
        WHERE c.conrelid='public.student_account_links'::regclass AND c.contype='p' AND c.conkey=ARRAY[a.attnum]::smallint[]
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
          -- pg_index.indkey is an int2vector with a zero-based lower bound;
          -- normalize its key order by reading the key slots directly.
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
        RAISE EXCEPTION 'Draft 02 prerequisite keys, account-link status constraint, or active-link unique indexes are absent/incompatible';
    END IF;
    IF to_regclass('public.coursework_assignments') IS NOT NULL THEN
        RAISE EXCEPTION 'public.coursework_assignments already exists; reconcile partial or prior application first';
    END IF;
END;
$preflight$;

CREATE TABLE public.coursework_assignments (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    college_id INTEGER NOT NULL,
    teacher_assignment_id INTEGER NOT NULL,
    created_by_membership_id INTEGER NOT NULL,
    created_by_user_id INTEGER NOT NULL,
    title VARCHAR(240) NOT NULL,
    instructions TEXT NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL,
    due_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'draft',
    maximum_marks NUMERIC(8,2),
    published_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_coursework_assignments_id_college UNIQUE (id, college_id),
    CONSTRAINT ck_coursework_assignments_title CHECK (length(trim(title)) > 0),
    CONSTRAINT ck_coursework_assignments_time_order CHECK (due_at > issued_at),
    CONSTRAINT ck_coursework_assignments_marks CHECK (maximum_marks IS NULL OR maximum_marks > 0),
    CONSTRAINT ck_coursework_assignments_status CHECK (status IN ('draft', 'published', 'archived')),
    CONSTRAINT ck_coursework_assignments_state_timestamps CHECK (
        (status = 'draft' AND published_at IS NULL AND archived_at IS NULL)
        OR (status = 'published' AND published_at IS NOT NULL AND archived_at IS NULL)
        OR (status = 'archived' AND published_at IS NOT NULL AND archived_at IS NOT NULL)
    ),
    CONSTRAINT fk_coursework_assignments_college FOREIGN KEY (college_id)
        REFERENCES public.colleges (id) ON DELETE RESTRICT,
    CONSTRAINT fk_coursework_assignments_teacher_assignment_college FOREIGN KEY (teacher_assignment_id, college_id)
        REFERENCES public.teacher_assignments (id, college_id) ON DELETE RESTRICT,
    CONSTRAINT fk_coursework_assignments_creator_membership FOREIGN KEY (created_by_membership_id, created_by_user_id, college_id)
        REFERENCES public.college_memberships (id, user_id, college_id) ON DELETE RESTRICT
);

CREATE INDEX ix_coursework_assignments_college_status_due
    ON public.coursework_assignments (college_id, status, due_at);
CREATE INDEX ix_coursework_assignments_teacher_assignment
    ON public.coursework_assignments (college_id, teacher_assignment_id, status);
CREATE INDEX ix_coursework_assignments_created_by
    ON public.coursework_assignments (college_id, created_by_user_id, created_at DESC);
-- Exact referencing-key order for the two composite FKs.
CREATE INDEX ix_coursework_assignments_teacher_assignment_college
    ON public.coursework_assignments (teacher_assignment_id, college_id);
CREATE INDEX ix_coursework_assignments_creator_membership_user_college
    ON public.coursework_assignments (created_by_membership_id, created_by_user_id, college_id);

COMMIT;
