-- STATUS: DRAFT / NOT APPLIED
-- Phase 14A.29 College registration/review persistence.
-- Prerequisite: reviewed and applied tenant foundation v2 tables plus a
-- compatible public.users table. This draft creates no rows and does not
-- activate Colleges, accounts, or memberships.
-- Never apply without a separate approved isolated PostgreSQL rehearsal.

BEGIN;

DO $college_registration_preflight$
BEGIN
    IF to_regclass('public.users') IS NULL
       OR to_regclass('public.colleges') IS NULL
       OR to_regclass('public.college_memberships') IS NULL THEN
        RAISE EXCEPTION 'College registration workflow requires public.users, public.colleges, and public.college_memberships';
    END IF;
END;
$college_registration_preflight$;

CREATE TABLE public.college_registration_applications (
    id SERIAL PRIMARY KEY,
    application_reference VARCHAR(48) NOT NULL UNIQUE,
    tracking_token_digest VARCHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    provisioning_status VARCHAR(24) NOT NULL DEFAULT 'not_started',

    college_name VARCHAR(200) NOT NULL,
    college_type VARCHAR(80) NOT NULL,
    address VARCHAR(255) NOT NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL,
    postal_code VARCHAR(20) NOT NULL,
    country VARCHAR(80) NOT NULL,
    official_email VARCHAR(254) NOT NULL,
    contact_number VARCHAR(20) NOT NULL,
    website VARCHAR(2048),

    admin_name VARCHAR(120) NOT NULL,
    admin_email VARCHAR(254) NOT NULL,
    admin_contact_number VARCHAR(20) NOT NULL,
    admin_password_hash VARCHAR(255),

    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by_user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    review_reason VARCHAR(1000),
    college_id INTEGER REFERENCES public.colleges(id) ON DELETE RESTRICT,
    admin_user_id INTEGER REFERENCES public.users(id) ON DELETE RESTRICT,

    CONSTRAINT ck_college_registration_applications_status
        CHECK (status IN ('pending', 'under_review', 'approved', 'rejected')),
    CONSTRAINT ck_college_registration_applications_provisioning_status
        CHECK (provisioning_status IN ('not_started', 'pending_activation', 'activated', 'rejected'))
);

CREATE UNIQUE INDEX uq_college_registration_applications_active_official_email
    ON public.college_registration_applications (official_email)
    WHERE status <> 'rejected';
CREATE UNIQUE INDEX uq_college_registration_applications_active_admin_email
    ON public.college_registration_applications (admin_email)
    WHERE status <> 'rejected';
CREATE INDEX ix_college_registration_applications_status_submitted
    ON public.college_registration_applications (status, submitted_at);

CREATE TABLE public.college_registration_reviews (
    id SERIAL PRIMARY KEY,
    application_id INTEGER NOT NULL REFERENCES public.college_registration_applications(id) ON DELETE RESTRICT,
    reviewer_user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    decision VARCHAR(20) NOT NULL,
    reason VARCHAR(1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_college_registration_reviews_decision
        CHECK (decision IN ('under_review', 'approved', 'rejected'))
);

CREATE INDEX ix_college_registration_reviews_application_created
    ON public.college_registration_reviews (application_id, created_at);

COMMENT ON COLUMN public.college_registration_applications.tracking_token_digest
    IS 'SHA-256 digest of a high-entropy one-time-displayed status token; never store the raw token.';
COMMENT ON COLUMN public.college_registration_applications.admin_password_hash
    IS 'Existing password hasher output only; cleared when provisioned or rejected. Never plaintext.';
COMMENT ON COLUMN public.college_registration_applications.provisioning_status
    IS 'Approval immediately activates the College, College Admin account and membership.';

COMMIT;

-- Manual rollback proposal only; requires separate approval and proof that no
-- application/review data is required. Do not run automatically.
-- BEGIN;
-- DROP TABLE public.college_registration_reviews;
-- DROP TABLE public.college_registration_applications;
-- COMMIT;
