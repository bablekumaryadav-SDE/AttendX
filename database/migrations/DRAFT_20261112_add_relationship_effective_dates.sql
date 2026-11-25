-- DRAFT ONLY — do not execute without separate migration approval.
-- Adds prospective validity intervals for College-owned enrollments and
-- Teacher-Class-Subject assignments. Existing rows are deliberately left NULL:
-- created_at is a row-recording time, not verified effective-date evidence.
-- No ownership backfill or business data change is performed here.

BEGIN;

ALTER TABLE public.student_class_assignments
    ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS effective_to TIMESTAMPTZ NULL;

ALTER TABLE public.teacher_assignments
    ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS effective_to TIMESTAMPTZ NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_student_class_assignments_effective_interval'
          AND conrelid = 'public.student_class_assignments'::regclass
    ) THEN
        ALTER TABLE public.student_class_assignments
            ADD CONSTRAINT ck_student_class_assignments_effective_interval
            CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_teacher_assignments_effective_interval'
          AND conrelid = 'public.teacher_assignments'::regclass
    ) THEN
        ALTER TABLE public.teacher_assignments
            ADD CONSTRAINT ck_teacher_assignments_effective_interval
            CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_student_class_assignments_college_effective_from
    ON public.student_class_assignments (college_id, effective_from);
CREATE INDEX IF NOT EXISTS ix_teacher_assignments_college_effective_from
    ON public.teacher_assignments (college_id, effective_from);

COMMENT ON COLUMN public.student_class_assignments.effective_from IS
    'Verified prospective relationship start; NULL means historical validity unknown.';
COMMENT ON COLUMN public.student_class_assignments.effective_to IS
    'Exclusive relationship end; NULL means no recorded end.';
COMMENT ON COLUMN public.teacher_assignments.effective_from IS
    'Verified prospective relationship start; NULL means historical validity unknown.';
COMMENT ON COLUMN public.teacher_assignments.effective_to IS
    'Exclusive relationship end; NULL means no recorded end.';

COMMIT;

-- Rollback warning: dropping these columns/indexes/constraints deletes newly
-- collected validity evidence. Use a database restore rehearsal and explicit
-- approval; do not perform an automatic destructive downgrade.
