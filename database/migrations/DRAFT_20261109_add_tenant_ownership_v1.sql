-- STATUS: DRAFT / NOT APPLIED / NOT VALIDATED BY POSTGRESQL.
-- Depends on DRAFT_20261105_add_tenant_foundation_postgresql_v2.sql and all
-- listed legacy tables/columns being present in public.
--
-- Adds nullable ownership only. Existing rows remain college_id NULL (UNKNOWN).
-- No College, membership, user, or business record is inserted or backfilled.
-- Phase 14A.7 gates must remain active until the application is separately
-- updated and reviewed to bind new rows and scope every route/query.
--
-- Composite FKs use MATCH SIMPLE (the default): a legacy row with NULL
-- college_id is retained without inventing ownership. Non-NULL tenant rows
-- must match the same College on every related parent. NOT VALID avoids
-- retroactively assigning/interpreting unknown rows; PostgreSQL still checks
-- new writes against these constraints. This is a DRAFT; review exact server
-- behavior, locks, and legacy referential integrity before any approved use.

BEGIN;

DO $tenant_ownership_preflight$
DECLARE
    required_table TEXT;
    required_column RECORD;
    identifier_index RECORD;
BEGIN
    FOREACH required_table IN ARRAY ARRAY[
        'colleges', 'students', 'teachers', 'subjects', 'classes',
        'teacher_assignments', 'student_class_assignments', 'attendance',
        'attendance_records', 'attendance_sessions', 'attendance_events',
        'notification_events', 'attendance_audit_logs'
    ] LOOP
        IF to_regclass(format('public.%I', required_table)) IS NULL THEN
            RAISE EXCEPTION 'Tenant ownership requires public.% table; prerequisite is absent', required_table;
        END IF;
        IF EXISTS (
            SELECT 1 FROM pg_attribute
             WHERE attrelid = to_regclass(format('public.%I', required_table))
               AND attname = 'college_id' AND attnum > 0 AND NOT attisdropped
        ) THEN
            RAISE EXCEPTION 'public.% already has college_id; reconcile catalogs before using this non-repeatable draft', required_table;
        END IF;
        IF NOT EXISTS (
            SELECT 1
              FROM pg_constraint AS c
              JOIN pg_attribute AS a ON a.attrelid = c.conrelid
             WHERE c.conrelid = to_regclass(format('public.%I', required_table))
               AND c.contype = 'p' AND a.attname = 'id'
               AND c.conkey = ARRAY[a.attnum]::SMALLINT[]
        ) THEN
            RAISE EXCEPTION 'public.% requires an id primary key', required_table;
        END IF;
    END LOOP;

    FOR required_column IN
        SELECT * FROM (VALUES
            ('colleges','id'), ('students','id'), ('teachers','id'), ('subjects','id'), ('classes','id'),
            ('teacher_assignments','id'), ('student_class_assignments','id'), ('attendance','id'),
            ('attendance_records','id'), ('attendance_sessions','id'), ('attendance_events','id'),
            ('notification_events','id'), ('attendance_audit_logs','id'),
            ('teacher_assignments','teacher_id'), ('teacher_assignments','subject_id'), ('teacher_assignments','class_id'),
            ('student_class_assignments','student_id'), ('student_class_assignments','class_id'),
            ('attendance','student_id'), ('attendance','teacher_id'),
            ('attendance_records','student_id'), ('attendance_records','teacher_id'),
            ('attendance_records','subject_id'), ('attendance_records','class_id'),
            ('attendance_sessions','teacher_id'), ('attendance_sessions','subject_id'), ('attendance_sessions','class_id'),
            ('attendance_events','session_id'), ('attendance_events','student_id'),
            ('notification_events','student_id')
        ) AS required(table_name, column_name)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_attribute
             WHERE attrelid = to_regclass(format('public.%I', required_column.table_name))
               AND attname = required_column.column_name
               AND atttypid = 'integer'::regtype
               AND attnum > 0 AND NOT attisdropped
        ) THEN
            RAISE EXCEPTION 'Tenant ownership requires public.%.% INTEGER', required_column.table_name, required_column.column_name;
        END IF;
    END LOOP;

    -- These exact single-column unique indexes are emitted by the current ORM
    -- for legacy global identifier uniqueness. Do not proceed against a schema
    -- whose catalog differs; an operator must review alternate indexes first.
    FOR identifier_index IN
        SELECT * FROM (VALUES
            ('students', 'roll_number', 'ix_students_roll_number'),
            ('teachers', 'employee_id', 'ix_teachers_employee_id'),
            ('subjects', 'code', 'ix_subjects_code')
        ) AS expected(table_name, column_name, index_name)
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_index AS index_info
              JOIN pg_class AS index_relation ON index_relation.oid = index_info.indexrelid
              JOIN pg_class AS table_relation ON table_relation.oid = index_info.indrelid
              JOIN pg_namespace AS table_schema ON table_schema.oid = table_relation.relnamespace
              JOIN pg_attribute AS identifier_column
                ON identifier_column.attrelid = table_relation.oid
               AND identifier_column.attname = identifier_index.column_name
               AND identifier_column.attnum > 0
               AND NOT identifier_column.attisdropped
             WHERE table_schema.nspname = 'public'
               AND table_relation.relname = identifier_index.table_name
               AND index_relation.relname = identifier_index.index_name
               AND index_info.indisunique
               AND index_info.indpred IS NULL
               AND index_info.indexprs IS NULL
               AND index_info.indnatts = 1
               AND index_info.indkey[0] = identifier_column.attnum
        ) THEN
            RAISE EXCEPTION 'Tenant ownership requires the reviewed public.% unique index on %; inspect catalog and revise the draft before execution',
                identifier_index.table_name, identifier_index.column_name;
        END IF;
    END LOOP;
END;
$tenant_ownership_preflight$;

ALTER TABLE public.students ADD COLUMN college_id INTEGER;
ALTER TABLE public.teachers ADD COLUMN college_id INTEGER;
ALTER TABLE public.subjects ADD COLUMN college_id INTEGER;
ALTER TABLE public.classes ADD COLUMN college_id INTEGER;
ALTER TABLE public.teacher_assignments ADD COLUMN college_id INTEGER;
ALTER TABLE public.student_class_assignments ADD COLUMN college_id INTEGER;
ALTER TABLE public.attendance ADD COLUMN college_id INTEGER;
ALTER TABLE public.attendance_records ADD COLUMN college_id INTEGER;
ALTER TABLE public.attendance_sessions ADD COLUMN college_id INTEGER;
ALTER TABLE public.attendance_events ADD COLUMN college_id INTEGER;
ALTER TABLE public.notification_events ADD COLUMN college_id INTEGER;
ALTER TABLE public.attendance_audit_logs ADD COLUMN college_id INTEGER;

-- Existing Student roll numbers, Teacher employee IDs, and Subject codes were
-- globally unique. For owned rows they are College-local identifiers. Preserve
-- the old global rule among NULL/UNKNOWN legacy rows, while allowing the same
-- identifier in separate Colleges. These names match the existing ORM-created
-- unique indexes; this draft must stop for catalog review if a deployed schema
-- uses different names or additional global unique indexes.
DROP INDEX IF EXISTS public.ix_students_roll_number;
CREATE UNIQUE INDEX uq_students_unknown_roll_number
    ON public.students (roll_number) WHERE college_id IS NULL;
CREATE UNIQUE INDEX uq_students_college_roll_number
    ON public.students (college_id, roll_number) WHERE college_id IS NOT NULL;

DROP INDEX IF EXISTS public.ix_teachers_employee_id;
CREATE UNIQUE INDEX uq_teachers_unknown_employee_id
    ON public.teachers (employee_id) WHERE college_id IS NULL;
CREATE UNIQUE INDEX uq_teachers_college_employee_id
    ON public.teachers (college_id, employee_id) WHERE college_id IS NOT NULL;

DROP INDEX IF EXISTS public.ix_subjects_code;
CREATE UNIQUE INDEX uq_subjects_unknown_code
    ON public.subjects (code) WHERE college_id IS NULL;
CREATE UNIQUE INDEX uq_subjects_college_code
    ON public.subjects (college_id, code) WHERE college_id IS NOT NULL;

COMMENT ON COLUMN public.students.college_id IS 'NULL means legacy College ownership UNKNOWN; never infer or backfill.';
COMMENT ON COLUMN public.teachers.college_id IS 'NULL means legacy College ownership UNKNOWN; never infer or backfill.';
COMMENT ON COLUMN public.subjects.college_id IS 'NULL means legacy College ownership UNKNOWN; never infer or backfill.';
COMMENT ON COLUMN public.classes.college_id IS 'NULL means legacy College ownership UNKNOWN; never infer or backfill.';
COMMENT ON COLUMN public.teacher_assignments.college_id IS 'NULL means legacy College ownership UNKNOWN; never infer or backfill.';
COMMENT ON COLUMN public.student_class_assignments.college_id IS 'NULL means legacy College ownership UNKNOWN; never infer or backfill.';
COMMENT ON COLUMN public.attendance.college_id IS 'NULL means legacy College ownership UNKNOWN; never infer or backfill.';
COMMENT ON COLUMN public.attendance_records.college_id IS 'NULL means legacy College ownership UNKNOWN; never infer or backfill.';
COMMENT ON COLUMN public.attendance_sessions.college_id IS 'NULL means legacy College ownership UNKNOWN; never infer or backfill.';
COMMENT ON COLUMN public.attendance_events.college_id IS 'NULL means legacy College ownership UNKNOWN; never infer or backfill.';
COMMENT ON COLUMN public.notification_events.college_id IS 'NULL means account-global or legacy event without established College ownership.';
COMMENT ON COLUMN public.attendance_audit_logs.college_id IS 'NULL means global/system or legacy audit event without verified College ownership.';

ALTER TABLE public.students ADD CONSTRAINT uq_students_id_college UNIQUE (id, college_id);
ALTER TABLE public.teachers ADD CONSTRAINT uq_teachers_id_college UNIQUE (id, college_id);
ALTER TABLE public.subjects ADD CONSTRAINT uq_subjects_id_college UNIQUE (id, college_id);
ALTER TABLE public.classes ADD CONSTRAINT uq_classes_id_college UNIQUE (id, college_id);
ALTER TABLE public.teacher_assignments ADD CONSTRAINT uq_teacher_assignments_id_college UNIQUE (id, college_id);
ALTER TABLE public.student_class_assignments ADD CONSTRAINT uq_student_class_assignments_id_college UNIQUE (id, college_id);
ALTER TABLE public.attendance ADD CONSTRAINT uq_attendance_id_college UNIQUE (id, college_id);
ALTER TABLE public.attendance_records ADD CONSTRAINT uq_attendance_records_id_college UNIQUE (id, college_id);
ALTER TABLE public.attendance_sessions ADD CONSTRAINT uq_attendance_sessions_id_college UNIQUE (id, college_id);
ALTER TABLE public.attendance_events ADD CONSTRAINT uq_attendance_events_id_college UNIQUE (id, college_id);
ALTER TABLE public.notification_events ADD CONSTRAINT uq_notification_events_id_college UNIQUE (id, college_id);
ALTER TABLE public.attendance_audit_logs ADD CONSTRAINT uq_attendance_audit_logs_id_college UNIQUE (id, college_id);

ALTER TABLE public.students ADD CONSTRAINT fk_students_college FOREIGN KEY (college_id) REFERENCES public.colleges(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.teachers ADD CONSTRAINT fk_teachers_college FOREIGN KEY (college_id) REFERENCES public.colleges(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.subjects ADD CONSTRAINT fk_subjects_college FOREIGN KEY (college_id) REFERENCES public.colleges(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.classes ADD CONSTRAINT fk_classes_college FOREIGN KEY (college_id) REFERENCES public.colleges(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.teacher_assignments ADD CONSTRAINT fk_teacher_assignments_college FOREIGN KEY (college_id) REFERENCES public.colleges(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.student_class_assignments ADD CONSTRAINT fk_student_class_assignments_college FOREIGN KEY (college_id) REFERENCES public.colleges(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.attendance ADD CONSTRAINT fk_attendance_college FOREIGN KEY (college_id) REFERENCES public.colleges(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.attendance_records ADD CONSTRAINT fk_attendance_records_college FOREIGN KEY (college_id) REFERENCES public.colleges(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.attendance_sessions ADD CONSTRAINT fk_attendance_sessions_college FOREIGN KEY (college_id) REFERENCES public.colleges(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.attendance_events ADD CONSTRAINT fk_attendance_events_college FOREIGN KEY (college_id) REFERENCES public.colleges(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.notification_events ADD CONSTRAINT fk_notification_events_college FOREIGN KEY (college_id) REFERENCES public.colleges(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.attendance_audit_logs ADD CONSTRAINT fk_attendance_audit_logs_college FOREIGN KEY (college_id) REFERENCES public.colleges(id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE public.teacher_assignments ADD CONSTRAINT fk_teacher_assignments_teacher_college FOREIGN KEY (teacher_id, college_id) REFERENCES public.teachers(id, college_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.teacher_assignments ADD CONSTRAINT fk_teacher_assignments_subject_college FOREIGN KEY (subject_id, college_id) REFERENCES public.subjects(id, college_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.teacher_assignments ADD CONSTRAINT fk_teacher_assignments_class_college FOREIGN KEY (class_id, college_id) REFERENCES public.classes(id, college_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.student_class_assignments ADD CONSTRAINT fk_student_class_assignments_student_college FOREIGN KEY (student_id, college_id) REFERENCES public.students(id, college_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.student_class_assignments ADD CONSTRAINT fk_student_class_assignments_class_college FOREIGN KEY (class_id, college_id) REFERENCES public.classes(id, college_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.attendance ADD CONSTRAINT fk_attendance_student_college FOREIGN KEY (student_id, college_id) REFERENCES public.students(id, college_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.attendance ADD CONSTRAINT fk_attendance_teacher_college FOREIGN KEY (teacher_id, college_id) REFERENCES public.teachers(id, college_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.attendance_records ADD CONSTRAINT fk_attendance_records_student_college FOREIGN KEY (student_id, college_id) REFERENCES public.students(id, college_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.attendance_records ADD CONSTRAINT fk_attendance_records_teacher_college FOREIGN KEY (teacher_id, college_id) REFERENCES public.teachers(id, college_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.attendance_records ADD CONSTRAINT fk_attendance_records_subject_college FOREIGN KEY (subject_id, college_id) REFERENCES public.subjects(id, college_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.attendance_records ADD CONSTRAINT fk_attendance_records_class_college FOREIGN KEY (class_id, college_id) REFERENCES public.classes(id, college_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.attendance_sessions ADD CONSTRAINT fk_attendance_sessions_teacher_college FOREIGN KEY (teacher_id, college_id) REFERENCES public.teachers(id, college_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.attendance_sessions ADD CONSTRAINT fk_attendance_sessions_subject_college FOREIGN KEY (subject_id, college_id) REFERENCES public.subjects(id, college_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.attendance_sessions ADD CONSTRAINT fk_attendance_sessions_class_college FOREIGN KEY (class_id, college_id) REFERENCES public.classes(id, college_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.attendance_events ADD CONSTRAINT fk_attendance_events_session_college FOREIGN KEY (session_id, college_id) REFERENCES public.attendance_sessions(id, college_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.attendance_events ADD CONSTRAINT fk_attendance_events_student_college FOREIGN KEY (student_id, college_id) REFERENCES public.students(id, college_id) ON DELETE RESTRICT NOT VALID;
-- Keep the historical event's College attribution intact. Student deletion
-- must be soft deletion while notification history references the Student.
ALTER TABLE public.notification_events ADD CONSTRAINT fk_notification_events_student_college FOREIGN KEY (student_id, college_id) REFERENCES public.students(id, college_id) ON DELETE RESTRICT NOT VALID;

CREATE INDEX ix_students_college_id ON public.students (college_id, id);
CREATE INDEX ix_teachers_college_id ON public.teachers (college_id, id);
CREATE INDEX ix_subjects_college_id ON public.subjects (college_id, id);
CREATE INDEX ix_classes_college_id ON public.classes (college_id, id);
CREATE INDEX ix_teacher_assignments_college_active ON public.teacher_assignments (college_id, is_active);
CREATE INDEX ix_student_class_assignments_college_active ON public.student_class_assignments (college_id, is_active);
CREATE INDEX ix_attendance_college_date ON public.attendance (college_id, date);
CREATE INDEX ix_attendance_records_college_date ON public.attendance_records (college_id, attendance_date);
CREATE INDEX ix_attendance_sessions_college_status_start ON public.attendance_sessions (college_id, status, starts_at);
CREATE INDEX ix_attendance_events_college_student_verified ON public.attendance_events (college_id, student_id, verified_at);
CREATE INDEX ix_attendance_events_college_session_status ON public.attendance_events (college_id, session_id, status);
CREATE INDEX ix_notification_events_college_created ON public.notification_events (college_id, created_at);
CREATE INDEX ix_attendance_audit_logs_college_created ON public.attendance_audit_logs (college_id, created_at);

COMMIT;

-- DOWNGRADE PLAN ONLY; never execute automatically. First verify every listed
-- college_id is NULL and no dependent tenant data has been created. Removing
-- any non-NULL ownership values would destroy reviewed data. Reverse all FK
-- constraints before unique constraints/indexes/columns; students/teachers/
-- subjects/classes are parents and should have their columns dropped last.
-- No downgrade was executed or authorized by this draft.
-- If separately approved after confirming every college_id is NULL, a manual
-- reverse may drop the child columns first (which removes their local FK and
-- UNIQUE constraints/indexes), followed by parent columns. Do not use CASCADE.
-- Before restoring the former global identifier indexes, verify that no two
-- Colleges share a roll_number, employee_id, or subject code. If duplicates
-- exist, the old global uniqueness rule cannot be restored without a separate
-- data decision; do not silently rewrite identifiers.
-- BEGIN;
-- ALTER TABLE public.attendance_events DROP COLUMN college_id;
-- ALTER TABLE public.attendance_records DROP COLUMN college_id;
-- ALTER TABLE public.attendance DROP COLUMN college_id;
-- ALTER TABLE public.student_class_assignments DROP COLUMN college_id;
-- ALTER TABLE public.teacher_assignments DROP COLUMN college_id;
-- ALTER TABLE public.notification_events DROP COLUMN college_id;
-- ALTER TABLE public.attendance_audit_logs DROP COLUMN college_id;
-- ALTER TABLE public.attendance_sessions DROP COLUMN college_id;
-- ALTER TABLE public.students DROP COLUMN college_id;
-- ALTER TABLE public.teachers DROP COLUMN college_id;
-- ALTER TABLE public.subjects DROP COLUMN college_id;
-- ALTER TABLE public.classes DROP COLUMN college_id;
-- COMMIT;
