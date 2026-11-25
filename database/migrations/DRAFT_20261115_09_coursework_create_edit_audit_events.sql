-- STATUS: DRAFT / NOT APPLIED outside the explicitly authorized local AttendX database.
-- Purpose: permit append-only audit snapshots for draft creation and edits.
-- No rows are inserted, updated, backfilled, or deleted by this migration.
-- Re-running safely replaces only the named CHECK constraint in one transaction.

BEGIN;

DO $$
DECLARE
    existing_definition TEXT;
BEGIN
    IF to_regclass('public.coursework_assignment_audit_events') IS NULL THEN
        RAISE EXCEPTION 'Coursework audit table is required before migration 09';
    END IF;

    SELECT pg_get_constraintdef(oid)
      INTO existing_definition
      FROM pg_constraint
     WHERE conrelid = 'public.coursework_assignment_audit_events'::regclass
       AND conname = 'ck_coursework_audit_event_type'
       AND contype = 'c';

    IF existing_definition IS NULL THEN
        RAISE EXCEPTION 'Expected coursework audit event type constraint is missing';
    END IF;

    IF existing_definition NOT LIKE '%published%'
       OR existing_definition NOT LIKE '%deadline_extended%'
       OR existing_definition NOT LIKE '%archived%'
       OR existing_definition NOT LIKE '%graded%' THEN
        RAISE EXCEPTION 'Coursework audit event type constraint differs from the reviewed Phase 16 schema';
    END IF;
END;
$$;

ALTER TABLE public.coursework_assignment_audit_events
    DROP CONSTRAINT IF EXISTS ck_coursework_audit_event_type;

ALTER TABLE public.coursework_assignment_audit_events
    ADD CONSTRAINT ck_coursework_audit_event_type
    CHECK (event_type IN ('created', 'edited', 'published', 'deadline_extended', 'archived', 'graded'));

COMMIT;
