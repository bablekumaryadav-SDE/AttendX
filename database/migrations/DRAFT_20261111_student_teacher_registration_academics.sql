-- STATUS: DRAFT / NOT APPLIED
-- Adds tenant-scoped Student/Teacher registration metadata and academic history.
-- Requires the reviewed tenant-ownership draft to have been applied first,
-- including (students.id, students.college_id) and (classes.id, classes.college_id)
-- unique keys. Do not run against an empty schema or production.

BEGIN;

DO $registration_preflight$
BEGIN
    IF to_regclass('public.users') IS NULL
       OR to_regclass('public.colleges') IS NULL
       OR to_regclass('public.college_memberships') IS NULL
       OR to_regclass('public.students') IS NULL
       OR to_regclass('public.teachers') IS NULL
       OR to_regclass('public.classes') IS NULL
       OR to_regclass('public.subjects') IS NULL
       OR to_regclass('public.student_guardians') IS NULL
       OR to_regclass('public.teacher_assignments') IS NULL
       OR to_regclass('public.student_class_assignments') IS NULL THEN
        RAISE EXCEPTION 'Student/Teacher registration requires users, tenant foundation, existing business tables and guardian schema';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = 'public.users'::regclass
          AND attname = 'id'
          AND atttypid = 'integer'::regtype
          AND attnotnull
          AND NOT attisdropped
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attname = 'id'
        WHERE c.conrelid = 'public.users'::regclass
          AND c.contype = 'p'
          AND c.conkey = ARRAY[a.attnum]::smallint[]
    ) THEN
        RAISE EXCEPTION 'users.id must be an INTEGER NOT NULL primary key';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = 'public.teacher_assignments'::regclass
          AND attname = 'college_id'
          AND atttypid = 'integer'::regtype
          AND NOT attisdropped
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = 'public.student_class_assignments'::regclass
          AND attname = 'college_id'
          AND atttypid = 'integer'::regtype
          AND NOT attisdropped
    ) THEN
        RAISE EXCEPTION 'Tenant ownership columns are required on assignment tables';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.students'::regclass
          AND conname = 'uq_students_id_college'
          AND contype = 'u'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.classes'::regclass
          AND conname = 'uq_classes_id_college'
          AND contype = 'u'
    ) THEN
        RAISE EXCEPTION 'Composite tenant keys from the tenant ownership migration are required';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.teacher_assignments'::regclass
          AND conname = 'fk_teacher_assignments_teacher_college' AND contype = 'f'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.teacher_assignments'::regclass
          AND conname = 'fk_teacher_assignments_subject_college' AND contype = 'f'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.teacher_assignments'::regclass
          AND conname = 'fk_teacher_assignments_class_college' AND contype = 'f'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.student_class_assignments'::regclass
          AND conname = 'fk_student_class_assignments_student_college' AND contype = 'f'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.student_class_assignments'::regclass
          AND conname = 'fk_student_class_assignments_class_college' AND contype = 'f'
    ) THEN
        RAISE EXCEPTION 'Same-College assignment foreign keys from the tenant ownership migration are required';
    END IF;
END;
$registration_preflight$;

ALTER TABLE public.students
    ADD COLUMN date_of_birth DATE,
    ADD COLUMN gender VARCHAR(30),
    ADD COLUMN enrollment_number VARCHAR(80),
    ADD COLUMN admission_year INTEGER,
    ADD COLUMN admission_session VARCHAR(30),
    ADD COLUMN program_duration_years INTEGER,
    ADD COLUMN current_academic_year INTEGER,
    ADD COLUMN current_semester INTEGER,
    ADD COLUMN section VARCHAR(50),
    ADD COLUMN course VARCHAR(120),
    ADD COLUMN mobile VARCHAR(20),
    ADD COLUMN address VARCHAR(255),
    ADD COLUMN city VARCHAR(100),
    ADD COLUMN state VARCHAR(100),
    ADD COLUMN postal_code VARCHAR(20),
    ADD CONSTRAINT ck_students_admission_year_range
        CHECK (admission_year IS NULL OR admission_year BETWEEN 1900 AND 2200),
    ADD CONSTRAINT ck_students_program_duration_range
        CHECK (program_duration_years IS NULL OR program_duration_years BETWEEN 1 AND 12),
    ADD CONSTRAINT ck_students_current_academic_year_range
        CHECK (current_academic_year IS NULL OR current_academic_year BETWEEN 1 AND 12),
    ADD CONSTRAINT ck_students_current_semester_range
        CHECK (current_semester IS NULL OR current_semester BETWEEN 1 AND 24);

ALTER TABLE public.teachers
    ADD COLUMN gender VARCHAR(30),
    ADD COLUMN designation VARCHAR(100),
    ADD COLUMN qualification VARCHAR(150),
    ADD COLUMN mobile VARCHAR(20),
    ADD COLUMN address VARCHAR(255),
    ADD COLUMN joining_date DATE;

ALTER TABLE public.student_guardians
    ALTER COLUMN guardian_name DROP NOT NULL,
    ALTER COLUMN guardian_mobile DROP NOT NULL,
    ADD COLUMN father_name VARCHAR(120),
    ADD COLUMN mother_name VARCHAR(120),
    ADD COLUMN parent_email VARCHAR(254);

CREATE UNIQUE INDEX uq_students_college_enrollment_number
    ON public.students (college_id, enrollment_number)
    WHERE college_id IS NOT NULL AND enrollment_number IS NOT NULL;

CREATE TABLE public.student_academic_history (
    id SERIAL PRIMARY KEY,
    college_id INTEGER NOT NULL REFERENCES public.colleges(id) ON DELETE RESTRICT,
    student_id INTEGER NOT NULL,
    class_id INTEGER,
    admission_year INTEGER,
    academic_year INTEGER,
    semester INTEGER,
    section VARCHAR(50),
    action VARCHAR(20) NOT NULL,
    reason VARCHAR(500),
    actor_user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_student_academic_history_action
        CHECK (action IN ('admitted', 'promoted', 'updated')),
    CONSTRAINT fk_student_academic_history_student_college
        FOREIGN KEY (student_id, college_id)
        REFERENCES public.students(id, college_id) ON DELETE RESTRICT,
    CONSTRAINT fk_student_academic_history_class_college
        FOREIGN KEY (class_id, college_id)
        REFERENCES public.classes(id, college_id) ON DELETE RESTRICT
);

CREATE INDEX ix_student_academic_history_college_student_created
    ON public.student_academic_history (college_id, student_id, created_at);

COMMENT ON COLUMN public.students.admission_year IS 'Original admission year; not changed during academic promotion.';
COMMENT ON COLUMN public.students.current_academic_year IS 'College-managed current year; never inferred from calendar year.';
COMMENT ON TABLE public.student_academic_history IS 'Tenant-scoped academic snapshots; existing legacy history is not inferred or backfilled.';

COMMIT;

-- DOWNGRADE PLAN ONLY. Dropping this table/columns would destroy newly entered
-- profile and academic history data. Requires separate approval and retention
-- review. No downgrade is authorized by this draft.
