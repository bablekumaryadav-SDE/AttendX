-- STATUS: DRAFT / NOT APPLIED. Coursework preparation only.
-- Depends on DRAFT_20261114_02_coursework_assignments.
-- Audit rows are append-only for ordinary application sessions. Assignment state
-- transitions must insert their audit event and update the assignment in one DB
-- transaction. Row and statement triggers protect ordinary sessions, but owners and
-- sufficiently privileged roles can disable/replace triggers; least-privilege ownership
-- and grants are required and are not created by this draft.

BEGIN;

DO $preflight$
BEGIN
    IF to_regclass('public.coursework_assignments') IS NULL
       OR to_regclass('public.college_memberships') IS NULL THEN
        RAISE EXCEPTION 'Coursework audit events require assignments and memberships';
    END IF;
    IF EXISTS (
        SELECT 1 FROM (VALUES
            ('coursework_assignments','id','int4', TRUE), ('coursework_assignments','college_id','int4', TRUE),
            ('coursework_assignments','teacher_assignment_id','int4', TRUE),
            ('coursework_assignments','created_by_membership_id','int4', TRUE), ('coursework_assignments','created_by_user_id','int4', TRUE),
            ('coursework_assignments','title','varchar', TRUE), ('coursework_assignments','instructions','text', TRUE),
            ('coursework_assignments','issued_at','timestamptz', TRUE), ('coursework_assignments','due_at','timestamptz', TRUE),
            ('coursework_assignments','status','varchar', TRUE), ('coursework_assignments','maximum_marks','numeric', FALSE),
            ('coursework_assignments','published_at','timestamptz', FALSE), ('coursework_assignments','archived_at','timestamptz', FALSE),
            ('coursework_assignments','created_at','timestamptz', TRUE), ('coursework_assignments','updated_at','timestamptz', TRUE),
            ('college_memberships','id','int4', TRUE), ('college_memberships','user_id','int4', TRUE),
            ('college_memberships','college_id','int4', TRUE)
        ) AS required(rel_name,col_name,type_name,must_be_not_null)
        LEFT JOIN pg_class rel ON rel.oid=to_regclass('public.'||required.rel_name)
        LEFT JOIN pg_attribute att ON att.attrelid=rel.oid AND att.attname=required.col_name AND att.attnum>0 AND NOT att.attisdropped
        LEFT JOIN pg_type typ ON typ.oid=att.atttypid
        WHERE att.attnum IS NULL OR typ.typname::text <> required.type_name
           OR (required.must_be_not_null AND NOT att.attnotnull)
    ) THEN
        RAISE EXCEPTION 'Draft 05 prerequisite column is missing or has an incompatible PostgreSQL type';
    END IF;
    IF EXISTS (
        SELECT 1 FROM (VALUES ('title','character varying(240)'),('status','character varying(12)')) required(col_name,formatted_type)
        JOIN pg_attribute att ON att.attrelid='public.coursework_assignments'::regclass
          AND att.attname=required.col_name AND att.attnum>0 AND NOT att.attisdropped
        WHERE format_type(att.atttypid,att.atttypmod)<>required.formatted_type
    ) THEN
        RAISE EXCEPTION 'Draft 05 requires coursework assignment title VARCHAR(240) and status VARCHAR(12)';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.coursework_assignments'::regclass
               AND attname IN ('maximum_marks','published_at','archived_at') AND attnotnull) THEN
        RAISE EXCEPTION 'Draft 05 requires maximum_marks, published_at, and archived_at to remain nullable';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.coursework_assignments'::regclass
                   AND conname='ck_coursework_assignments_status' AND contype='c') THEN
        RAISE EXCEPTION 'Draft 05 requires the coursework assignment status check constraint';
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
        JOIN pg_attribute b ON b.attrelid=c.conrelid AND b.attname='user_id'
        JOIN pg_attribute d ON d.attrelid=c.conrelid AND d.attname='college_id'
        WHERE c.conrelid='public.college_memberships'::regclass AND c.conname='uq_college_memberships_id_user_college'
          AND c.contype='u' AND c.conkey=ARRAY[a.attnum,b.attnum,d.attnum]::smallint[]
    ) THEN
        RAISE EXCEPTION 'Draft 05 prerequisite composite keys are absent or have the wrong column order';
    END IF;
    IF to_regclass('public.coursework_assignment_audit_events') IS NOT NULL
       OR to_regprocedure('public.attendx_reject_coursework_audit_mutation()') IS NOT NULL
       OR to_regprocedure('public.attendx_reject_coursework_audit_truncate()') IS NOT NULL
       OR to_regprocedure('public.attendx_reject_coursework_assignment_truncate()') IS NOT NULL
       OR to_regprocedure('public.attendx_guard_coursework_assignment_mutation()') IS NOT NULL THEN
        RAISE EXCEPTION 'Coursework audit objects already exist; reconcile partial or prior application first';
    END IF;
END;
$preflight$;

CREATE TABLE public.coursework_assignment_audit_events (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    coursework_assignment_id INTEGER NOT NULL,
    college_id INTEGER NOT NULL,
    actor_membership_id INTEGER NOT NULL,
    actor_user_id INTEGER NOT NULL,
    event_type VARCHAR(24) NOT NULL,
    previous_values JSONB NOT NULL,
    new_values JSONB NOT NULL,
    reason TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_coursework_audit_event_type CHECK (event_type IN ('published', 'deadline_extended', 'archived')),
    CONSTRAINT ck_coursework_audit_values_objects CHECK (
        jsonb_typeof(previous_values) = 'object' AND jsonb_typeof(new_values) = 'object'
    ),
    CONSTRAINT ck_coursework_audit_reason CHECK (length(trim(reason)) > 0),
    CONSTRAINT fk_coursework_audit_assignment_college FOREIGN KEY (coursework_assignment_id, college_id)
        REFERENCES public.coursework_assignments (id, college_id) ON DELETE RESTRICT,
    CONSTRAINT fk_coursework_audit_actor_membership FOREIGN KEY (actor_membership_id, actor_user_id, college_id)
        REFERENCES public.college_memberships (id, user_id, college_id) ON DELETE RESTRICT
);

CREATE INDEX ix_coursework_audit_assignment_time
    ON public.coursework_assignment_audit_events (college_id, coursework_assignment_id, occurred_at, id);
CREATE INDEX ix_coursework_audit_actor_time
    ON public.coursework_assignment_audit_events (college_id, actor_user_id, occurred_at);
CREATE INDEX ix_coursework_audit_assignment_college_fk
    ON public.coursework_assignment_audit_events (coursework_assignment_id, college_id);
CREATE INDEX ix_coursework_audit_actor_membership_user_college_fk
    ON public.coursework_assignment_audit_events (actor_membership_id, actor_user_id, college_id);

CREATE FUNCTION public.attendx_reject_coursework_audit_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.occurred_at := clock_timestamp();
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Coursework assignment audit events are append-only';
END;
$function$;

CREATE TRIGGER trg_coursework_audit_append_only
    BEFORE INSERT OR UPDATE OR DELETE ON public.coursework_assignment_audit_events
    FOR EACH ROW EXECUTE FUNCTION public.attendx_reject_coursework_audit_mutation();

CREATE FUNCTION public.attendx_reject_coursework_audit_truncate()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    RAISE EXCEPTION 'Coursework assignment audit history cannot be truncated';
END;
$function$;

CREATE TRIGGER trg_coursework_audit_no_truncate
    BEFORE TRUNCATE ON public.coursework_assignment_audit_events
    FOR EACH STATEMENT EXECUTE FUNCTION public.attendx_reject_coursework_audit_truncate();

CREATE FUNCTION public.attendx_guard_coursework_assignment_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
DECLARE
    matching_event BOOLEAN;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'draft' OR NEW.published_at IS NOT NULL OR NEW.archived_at IS NOT NULL THEN
            RAISE EXCEPTION 'Coursework assignments must be created as drafts';
        END IF;
        NEW.created_at := clock_timestamp();
        NEW.updated_at := NEW.created_at;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'draft' THEN
            RAISE EXCEPTION 'Published or archived coursework cannot be physically deleted';
        END IF;
        RETURN OLD;
    END IF;

    IF OLD.status = 'archived' THEN
        RAISE EXCEPTION 'Archived coursework is terminal and cannot be changed';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.college_id IS DISTINCT FROM OLD.college_id
       OR NEW.created_by_membership_id IS DISTINCT FROM OLD.created_by_membership_id
       OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Coursework assignment identity, College, creator, and creation time are immutable';
    END IF;

    IF OLD.status = 'draft' AND NEW.status = 'draft' THEN
        NEW.updated_at := clock_timestamp();
        RETURN NEW;
    END IF;

    IF OLD.status = 'draft' AND NEW.status = 'published' THEN
        SELECT EXISTS (
            SELECT 1 FROM public.coursework_assignment_audit_events event
             WHERE event.coursework_assignment_id = OLD.id AND event.college_id = OLD.college_id
               AND event.event_type = 'published'
               AND event.previous_values->>'status' = 'draft'
               AND event.new_values->>'status' = 'published'
        ) INTO matching_event;
        IF NOT matching_event THEN RAISE EXCEPTION 'Publishing requires a matching audit event'; END IF;
        NEW.published_at := clock_timestamp();
        NEW.updated_at := NEW.published_at;
        RETURN NEW;
    END IF;

    IF OLD.status = 'published' THEN
        IF NEW.college_id IS DISTINCT FROM OLD.college_id
           OR NEW.teacher_assignment_id IS DISTINCT FROM OLD.teacher_assignment_id
           OR NEW.created_by_membership_id IS DISTINCT FROM OLD.created_by_membership_id
           OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
           OR NEW.title IS DISTINCT FROM OLD.title
           OR NEW.instructions IS DISTINCT FROM OLD.instructions
           OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
           OR NEW.maximum_marks IS DISTINCT FROM OLD.maximum_marks
           OR NEW.published_at IS DISTINCT FROM OLD.published_at
           OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'Published coursework content and mapping are immutable';
        END IF;

        IF NEW.due_at IS DISTINCT FROM OLD.due_at THEN
            IF NEW.due_at <= OLD.due_at OR NEW.status <> 'published' OR NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
                RAISE EXCEPTION 'A published deadline can only be extended independently';
            END IF;
            SELECT EXISTS (
                SELECT 1 FROM public.coursework_assignment_audit_events event
                 WHERE event.coursework_assignment_id = OLD.id AND event.college_id = OLD.college_id
                   AND event.event_type = 'deadline_extended'
                   AND (event.previous_values->>'due_at')::timestamptz = OLD.due_at
                   AND (event.new_values->>'due_at')::timestamptz = NEW.due_at
            ) INTO matching_event;
            IF NOT matching_event THEN RAISE EXCEPTION 'Deadline extension requires a matching audit event'; END IF;
            NEW.updated_at := clock_timestamp();
            RETURN NEW;
        END IF;

        IF NEW.status = 'archived' THEN
            IF NEW.due_at IS DISTINCT FROM OLD.due_at THEN
                RAISE EXCEPTION 'Archive and deadline changes must be separate audited actions';
            END IF;
            SELECT EXISTS (
                SELECT 1 FROM public.coursework_assignment_audit_events event
                 WHERE event.coursework_assignment_id = OLD.id AND event.college_id = OLD.college_id
                   AND event.event_type = 'archived'
                   AND event.previous_values->>'status' = 'published'
                   AND event.new_values->>'status' = 'archived'
            ) INTO matching_event;
            IF NOT matching_event THEN RAISE EXCEPTION 'Archiving requires a matching audit event'; END IF;
            NEW.archived_at := clock_timestamp();
            NEW.updated_at := NEW.archived_at;
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'Unsupported coursework assignment state transition';
END;
$function$;

CREATE TRIGGER trg_coursework_assignment_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.coursework_assignments
    FOR EACH ROW EXECUTE FUNCTION public.attendx_guard_coursework_assignment_mutation();

CREATE FUNCTION public.attendx_reject_coursework_assignment_truncate()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    RAISE EXCEPTION 'Coursework assignments cannot be truncated';
END;
$function$;

CREATE TRIGGER trg_coursework_assignment_no_truncate
    BEFORE TRUNCATE ON public.coursework_assignments
    FOR EACH STATEMENT EXECUTE FUNCTION public.attendx_reject_coursework_assignment_truncate();

COMMIT;
