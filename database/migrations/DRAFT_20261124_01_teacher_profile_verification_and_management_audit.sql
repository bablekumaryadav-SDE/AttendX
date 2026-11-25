-- SUPERSEDED: do not execute this standalone SQL draft.
-- The reviewed schema is tracked by backend/alembic/versions/20261125_01_teacher_profile_verification_and_management_audit.py.
-- Alembic is the sole execution path for this schema to avoid duplicate migrations.
-- DRAFT ONLY — NOT APPLIED.
-- Separate Teacher profile review from TeacherAccountLink identity attestation.
-- Apply only after PostgreSQL preflight confirms the named composite parent keys.
-- This migration deliberately does not assign Colleges or backfill legacy rows.

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.teachers') IS NULL
       OR to_regclass('public.college_memberships') IS NULL THEN
        RAISE EXCEPTION 'Teacher profile verification prerequisites are missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.teachers'::regclass
          AND conname = 'uq_teachers_id_college'
          AND contype IN ('u', 'p')
    ) THEN
        RAISE EXCEPTION 'Required parent key uq_teachers_id_college is missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.college_memberships'::regclass
          AND conname = 'uq_college_memberships_user_college'
          AND contype IN ('u', 'p')
    ) THEN
        RAISE EXCEPTION 'Required parent key uq_college_memberships_user_college is missing';
    END IF;
    IF to_regclass('public.teacher_profile_verifications') IS NOT NULL
       OR to_regclass('public.teacher_management_audit_events') IS NOT NULL THEN
        RAISE EXCEPTION 'A Teacher verification or audit relation already exists; inspect it before proceeding';
    END IF;
END $$;

CREATE TABLE public.teacher_profile_verifications (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL,
    college_id INTEGER NOT NULL,
    verification_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    verified_by_admin_id INTEGER,
    verified_at TIMESTAMPTZ,
    rejected_by_admin_id INTEGER,
    rejected_at TIMESTAMPTZ,
    verification_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_teacher_profile_verifications_teacher_college UNIQUE (teacher_id, college_id),
    CONSTRAINT ck_teacher_profile_verifications_status
        CHECK (verification_status IN ('pending', 'verified', 'rejected')),
    CONSTRAINT ck_teacher_profile_verifications_review_state CHECK (
        (verification_status = 'pending'
            AND verified_by_admin_id IS NULL AND verified_at IS NULL
            AND rejected_by_admin_id IS NULL AND rejected_at IS NULL
            AND verification_reason IS NULL)
        OR
        (verification_status = 'verified'
            AND verified_by_admin_id IS NOT NULL AND verified_at IS NOT NULL
            AND rejected_by_admin_id IS NULL AND rejected_at IS NULL
            AND length(trim(verification_reason)) > 0)
        OR
        (verification_status = 'rejected'
            AND verified_by_admin_id IS NULL AND verified_at IS NULL
            AND rejected_by_admin_id IS NOT NULL AND rejected_at IS NOT NULL
            AND length(trim(verification_reason)) > 0)
    ),
    CONSTRAINT fk_teacher_profile_verifications_teacher_college
        FOREIGN KEY (teacher_id, college_id)
        REFERENCES public.teachers (id, college_id) ON DELETE RESTRICT,
    CONSTRAINT fk_teacher_profile_verifications_verifier_membership
        FOREIGN KEY (verified_by_admin_id, college_id)
        REFERENCES public.college_memberships (user_id, college_id) ON DELETE RESTRICT,
    CONSTRAINT fk_teacher_profile_verifications_rejector_membership
        FOREIGN KEY (rejected_by_admin_id, college_id)
        REFERENCES public.college_memberships (user_id, college_id) ON DELETE RESTRICT
);

CREATE INDEX ix_teacher_profile_verifications_college_status
    ON public.teacher_profile_verifications (college_id, verification_status);

CREATE TABLE public.teacher_management_audit_events (
    id SERIAL PRIMARY KEY,
    college_id INTEGER NOT NULL,
    teacher_id INTEGER NOT NULL,
    related_user_id INTEGER,
    actor_user_id INTEGER NOT NULL,
    action VARCHAR(80) NOT NULL,
    previous_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    new_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    reason TEXT NOT NULL,
    evidence_reference VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_teacher_management_audit_teacher_college
        FOREIGN KEY (teacher_id, college_id)
        REFERENCES public.teachers (id, college_id) ON DELETE RESTRICT,
    CONSTRAINT fk_teacher_management_audit_actor_membership
        FOREIGN KEY (actor_user_id, college_id)
        REFERENCES public.college_memberships (user_id, college_id) ON DELETE RESTRICT,
    CONSTRAINT fk_teacher_management_audit_related_membership
        FOREIGN KEY (related_user_id, college_id)
        REFERENCES public.college_memberships (user_id, college_id) ON DELETE RESTRICT,
    CONSTRAINT ck_teacher_management_audit_action
        CHECK (action IN (
            'ownership_established', 'membership_created', 'membership_repaired',
            'account_linked', 'account_unlinked', 'profile_verified',
            'profile_rejected', 'teacher_activated', 'teacher_deactivated',
            'class_assigned', 'class_assignment_ended',
            'subject_assigned', 'subject_assignment_ended'
        )),
    CONSTRAINT ck_teacher_management_audit_reason_nonempty
        CHECK (length(trim(reason)) > 0)
);

CREATE INDEX ix_teacher_management_audit_college_teacher_created
    ON public.teacher_management_audit_events (college_id, teacher_id, created_at DESC);
CREATE INDEX ix_teacher_management_audit_actor_created
    ON public.teacher_management_audit_events (actor_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.reject_teacher_management_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Teacher management audit events are append-only';
END;
$$;

CREATE TRIGGER trg_teacher_management_audit_append_only
BEFORE UPDATE OR DELETE ON public.teacher_management_audit_events
FOR EACH ROW EXECUTE FUNCTION public.reject_teacher_management_audit_mutation();

COMMENT ON TABLE public.teacher_profile_verifications IS
    'Independent College Admin review state for a Teacher profile; not account-link verification.';
COMMENT ON TABLE public.teacher_management_audit_events IS
    'Append-only College-scoped audit history for sensitive Teacher management actions.';

COMMIT;
