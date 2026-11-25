-- STATUS: DRAFT / NOT APPLIED. Forward-only notification schema reconciliation.
-- Requires the reviewed base notification_events table and tenant-ownership
-- migration, which already adds nullable college_id and its College/student
-- constraints. This draft never assigns ownership to historical rows.
-- Apply only after migration-history reconciliation, disposable PostgreSQL
-- rehearsal, verified backup/restore, and separate explicit approval.

BEGIN;

DO $preflight$
DECLARE
    required RECORD;
BEGIN
    IF to_regclass('public.notification_events') IS NULL THEN
        RAISE EXCEPTION 'Notification reconciliation requires an existing public.notification_events table';
    END IF;
    IF to_regclass('public.colleges') IS NULL
       OR to_regclass('public.students') IS NULL
       OR to_regclass('public.users') IS NULL THEN
        RAISE EXCEPTION 'Notification reconciliation requires public.colleges, public.students, and public.users';
    END IF;

    FOR required IN
        SELECT * FROM (VALUES
            ('id', 'int4', TRUE),
            ('user_id', 'int4', FALSE),
            ('student_id', 'int4', FALSE),
            ('event_type', 'varchar', TRUE),
            ('channel', 'varchar', TRUE),
            ('title', 'varchar', TRUE),
            ('message', 'text', TRUE),
            ('delivery_status', 'varchar', TRUE),
            ('idempotency_key', 'varchar', TRUE),
            ('read_at', 'timestamptz', FALSE),
            ('created_at', 'timestamptz', TRUE),
            ('sent_at', 'timestamptz', FALSE)
        ) AS columns_required(column_name, type_name, must_be_not_null)
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_attribute attribute
              JOIN pg_type type ON type.oid = attribute.atttypid
             WHERE attribute.attrelid = 'public.notification_events'::regclass
               AND attribute.attname = required.column_name
               AND attribute.attnum > 0
               AND NOT attribute.attisdropped
               AND type.typname::text = required.type_name
               AND (NOT required.must_be_not_null OR attribute.attnotnull)
        ) THEN
            RAISE EXCEPTION 'notification_events prerequisite column is missing or incompatible: %', required.column_name;
        END IF;
    END LOOP;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint constraint_row
        JOIN pg_attribute id_attribute
          ON id_attribute.attrelid = constraint_row.conrelid AND id_attribute.attname = 'id'
        WHERE constraint_row.conrelid = 'public.notification_events'::regclass
          AND constraint_row.contype = 'p'
          AND constraint_row.conkey = ARRAY[id_attribute.attnum]::smallint[]
    ) THEN
        RAISE EXCEPTION 'notification_events requires a single-column id primary key';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint constraint_row
        WHERE constraint_row.conrelid = 'public.notification_events'::regclass
          AND constraint_row.contype = 'u'
          AND constraint_row.conname = 'uq_notification_events_idempotency_key'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint constraint_row
        WHERE constraint_row.conrelid = 'public.notification_events'::regclass
          AND constraint_row.contype = 'c'
          AND constraint_row.conname = 'ck_notification_events_delivery_status'
          AND position('queued' in lower(pg_get_constraintdef(constraint_row.oid))) > 0
          AND position('sent' in lower(pg_get_constraintdef(constraint_row.oid))) > 0
          AND position('failed' in lower(pg_get_constraintdef(constraint_row.oid))) > 0
    ) THEN
        RAISE EXCEPTION 'notification_events idempotency or delivery-status constraint is missing/incompatible';
    END IF;
    -- The tenant-ownership migration owns these objects. Require their exact
    -- key order and restrictive actions instead of adding duplicate objects.
    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute attribute
        JOIN pg_type type ON type.oid = attribute.atttypid
        WHERE attribute.attrelid = 'public.notification_events'::regclass
          AND attribute.attname = 'college_id'
          AND attribute.attnum > 0 AND NOT attribute.attisdropped
          AND type.typname::text = 'int4' AND NOT attribute.attnotnull
    ) THEN
        RAISE EXCEPTION 'notification_events requires nullable INTEGER college_id from tenant ownership';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint constraint_row
        JOIN pg_attribute id_attribute
          ON id_attribute.attrelid = constraint_row.conrelid AND id_attribute.attname = 'id'
        JOIN pg_attribute college_attribute
          ON college_attribute.attrelid = constraint_row.conrelid AND college_attribute.attname = 'college_id'
        WHERE constraint_row.conrelid = 'public.notification_events'::regclass
          AND constraint_row.contype = 'u'
          AND constraint_row.conname = 'uq_notification_events_id_college'
          AND constraint_row.conkey = ARRAY[id_attribute.attnum, college_attribute.attnum]::smallint[]
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint constraint_row
        JOIN pg_attribute local_attribute
          ON local_attribute.attrelid = constraint_row.conrelid AND local_attribute.attname = 'college_id'
        JOIN pg_attribute remote_attribute
          ON remote_attribute.attrelid = constraint_row.confrelid AND remote_attribute.attname = 'id'
        WHERE constraint_row.conrelid = 'public.notification_events'::regclass
          AND constraint_row.confrelid = 'public.colleges'::regclass
          AND constraint_row.contype = 'f'
          AND constraint_row.conkey = ARRAY[local_attribute.attnum]::smallint[]
          AND constraint_row.confkey = ARRAY[remote_attribute.attnum]::smallint[]
          AND constraint_row.confdeltype = 'r'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint constraint_row
        JOIN pg_attribute local_student
          ON local_student.attrelid = constraint_row.conrelid AND local_student.attname = 'student_id'
        JOIN pg_attribute local_college
          ON local_college.attrelid = constraint_row.conrelid AND local_college.attname = 'college_id'
        JOIN pg_attribute remote_student
          ON remote_student.attrelid = constraint_row.confrelid AND remote_student.attname = 'id'
        JOIN pg_attribute remote_college
          ON remote_college.attrelid = constraint_row.confrelid AND remote_college.attname = 'college_id'
        WHERE constraint_row.conrelid = 'public.notification_events'::regclass
          AND constraint_row.confrelid = 'public.students'::regclass
          AND constraint_row.contype = 'f'
          AND constraint_row.conkey = ARRAY[local_student.attnum, local_college.attnum]::smallint[]
          AND constraint_row.confkey = ARRAY[remote_student.attnum, remote_college.attnum]::smallint[]
          AND constraint_row.confdeltype = 'r'
    ) THEN
        RAISE EXCEPTION 'notification_events tenant ownership constraints are missing or incompatible';
    END IF;
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint constraint_row
          JOIN pg_attribute local_attribute
            ON local_attribute.attrelid = constraint_row.conrelid AND local_attribute.attname = 'user_id'
          JOIN pg_attribute remote_attribute
            ON remote_attribute.attrelid = constraint_row.confrelid AND remote_attribute.attname = 'id'
         WHERE constraint_row.conrelid = 'public.notification_events'::regclass
           AND constraint_row.confrelid = 'public.users'::regclass
           AND constraint_row.contype = 'f'
           AND constraint_row.conkey = ARRAY[local_attribute.attnum]::smallint[]
           AND constraint_row.confkey = ARRAY[remote_attribute.attnum]::smallint[]
           AND constraint_row.confdeltype = 'n'
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_constraint constraint_row
          JOIN pg_attribute local_attribute
            ON local_attribute.attrelid = constraint_row.conrelid AND local_attribute.attname = 'student_id'
          JOIN pg_attribute remote_attribute
            ON remote_attribute.attrelid = constraint_row.confrelid AND remote_attribute.attname = 'id'
         WHERE constraint_row.conrelid = 'public.notification_events'::regclass
           AND constraint_row.confrelid = 'public.students'::regclass
           AND constraint_row.contype = 'f'
           AND constraint_row.conkey = ARRAY[local_attribute.attnum]::smallint[]
           AND constraint_row.confkey = ARRAY[remote_attribute.attnum]::smallint[]
           AND constraint_row.confdeltype = 'r'
    ) THEN
        RAISE EXCEPTION 'notification_events user/student foreign keys are missing or have unsafe delete actions';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint constraint_row
        JOIN pg_attribute id_attribute
          ON id_attribute.attrelid = constraint_row.conrelid AND id_attribute.attname = 'id'
        JOIN pg_attribute college_attribute
          ON college_attribute.attrelid = constraint_row.conrelid AND college_attribute.attname = 'college_id'
        WHERE constraint_row.conrelid = 'public.students'::regclass
          AND constraint_row.contype = 'u'
          AND constraint_row.conkey = ARRAY[id_attribute.attnum, college_attribute.attnum]::smallint[]
    ) THEN
        RAISE EXCEPTION 'notification reconciliation requires a unique students(id, college_id) key';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM (VALUES
              ('students', 'id', 'int4'),
              ('students', 'college_id', 'int4'),
              ('colleges', 'id', 'int4')
          ) AS expected(table_name, column_name, type_name)
          LEFT JOIN pg_class relation
            ON relation.oid = to_regclass('public.' || expected.table_name)
          LEFT JOIN pg_attribute attribute
            ON attribute.attrelid = relation.oid
           AND attribute.attname = expected.column_name
           AND attribute.attnum > 0
           AND NOT attribute.attisdropped
          LEFT JOIN pg_type type ON type.oid = attribute.atttypid
         WHERE attribute.attnum IS NULL OR type.typname::text <> expected.type_name
    ) THEN
        RAISE EXCEPTION 'Student/College foreign-key columns must use compatible INTEGER types';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint constraint_row
        JOIN pg_attribute id_attribute
          ON id_attribute.attrelid = constraint_row.conrelid AND id_attribute.attname = 'id'
        WHERE constraint_row.conrelid = 'public.colleges'::regclass
          AND constraint_row.contype = 'p'
          AND constraint_row.conkey = ARRAY[id_attribute.attnum]::smallint[]
    ) THEN
        RAISE EXCEPTION 'notification reconciliation requires the College id primary key';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.notification_events
         WHERE substr(event_type, 1, 11) = 'coursework_'
    ) THEN
        RAISE EXCEPTION 'Existing coursework notification events require manual attribution review before reconciliation';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_constraint constraint_row
         WHERE constraint_row.conrelid = 'public.notification_events'::regclass
           AND constraint_row.conname = 'ck_notification_events_coursework_requires_college'
           AND (constraint_row.contype <> 'c'
                OR pg_get_constraintdef(constraint_row.oid) NOT ILIKE '%substr%event_type%'
                OR pg_get_constraintdef(constraint_row.oid) NOT ILIKE '%coursework_%'
                OR pg_get_constraintdef(constraint_row.oid) NOT ILIKE '%college_id IS NOT NULL%')
    ) THEN
        RAISE EXCEPTION 'Existing coursework notification check is incompatible';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_index index_info
        JOIN pg_class index_relation ON index_relation.oid = index_info.indexrelid
        JOIN pg_attribute college_attribute
          ON college_attribute.attrelid = index_info.indrelid AND college_attribute.attname = 'college_id'
        JOIN pg_attribute created_attribute
          ON created_attribute.attrelid = index_info.indrelid AND created_attribute.attname = 'created_at'
        WHERE index_relation.relnamespace = 'public'::regnamespace
          AND index_relation.relname = 'ix_notification_events_college_created'
          AND index_info.indrelid = 'public.notification_events'::regclass
          AND index_info.indnkeyatts = 2
          AND index_info.indkey[0] = college_attribute.attnum
          AND index_info.indkey[1] = created_attribute.attnum
    ) THEN
        RAISE EXCEPTION 'Tenant-ownership index ix_notification_events_college_created is missing or incompatible';
    END IF;
    IF to_regclass('public.ix_notification_events_id') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM pg_index index_info
        JOIN pg_class index_relation ON index_relation.oid = index_info.indexrelid
        JOIN pg_attribute id_attribute
          ON id_attribute.attrelid = index_info.indrelid AND id_attribute.attname = 'id'
        WHERE index_relation.relnamespace = 'public'::regnamespace
          AND index_relation.relname = 'ix_notification_events_id'
          AND index_info.indrelid = 'public.notification_events'::regclass
          AND index_info.indnkeyatts = 1
          AND index_info.indkey[0] = id_attribute.attnum
    ) THEN
        RAISE EXCEPTION 'Existing ix_notification_events_id index is incompatible';
    END IF;
END;
$preflight$;

DO $ensure_coursework_college_check$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.notification_events'::regclass
           AND conname = 'ck_notification_events_coursework_requires_college'
           AND contype = 'c'
    ) THEN
        ALTER TABLE public.notification_events
            ADD CONSTRAINT ck_notification_events_coursework_requires_college
            CHECK (substr(event_type, 1, 11) <> 'coursework_' OR college_id IS NOT NULL)
            NOT VALID;
    END IF;
END;
$ensure_coursework_college_check$;

-- Historical rows retain NULL ownership. The tenant-ownership constraints stay
-- authoritative; this revision adds the Coursework-specific new-row contract.
-- If absent, it is added NOT VALID so historical rows remain untouched while
-- the rule is enforced for new/updated coursework events.

-- Match the ORM id index (the primary-key index remains the uniqueness authority)
-- and College-scoped event-list index.
CREATE INDEX IF NOT EXISTS ix_notification_events_id
    ON public.notification_events (id);
CREATE INDEX IF NOT EXISTS ix_notification_events_college_created
    ON public.notification_events (college_id, created_at);

COMMIT;
