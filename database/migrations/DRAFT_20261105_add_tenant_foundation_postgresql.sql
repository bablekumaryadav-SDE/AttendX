-- STATUS: DRAFT / NOT APPLIED
-- Phase 5 additive tenant identity and membership tables only.
-- Does not create a college row, alter legacy tables, or assign legacy ownership.
-- Review this script and test it on a separately restored disposable PostgreSQL
-- database before any separately approved execution.

BEGIN;

CREATE TABLE colleges (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(80) NOT NULL,
    official_name VARCHAR(200) NOT NULL,
    display_name VARCHAR(120),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_colleges_slug UNIQUE (slug),
    CONSTRAINT ck_colleges_slug_format CHECK (slug ~ '^[a-z0-9_-]{1,80}$'),
    CONSTRAINT ck_colleges_official_name CHECK (length(btrim(official_name)) > 0),
    CONSTRAINT ck_colleges_status CHECK (status IN ('pending', 'active', 'suspended', 'archived'))
);

CREATE INDEX ix_colleges_slug ON colleges (slug);

CREATE TABLE college_memberships (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    college_id INTEGER NOT NULL REFERENCES colleges(id) ON DELETE RESTRICT,
    role VARCHAR(30) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    activated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    revoked_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    activated_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    status_reason VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_college_memberships_user_college UNIQUE (user_id, college_id),
    CONSTRAINT ck_college_memberships_role CHECK (role IN ('college_admin', 'teacher', 'student')),
    CONSTRAINT ck_college_memberships_status CHECK (status IN ('pending', 'active', 'suspended', 'revoked'))
);

CREATE INDEX ix_college_memberships_user_status ON college_memberships (user_id, status);
CREATE INDEX ix_college_memberships_college_status ON college_memberships (college_id, status);

COMMIT;

-- ROLLBACK PLAN (reviewed operator action; not executed automatically):
-- Only after verifying the exact target, and only if these tables contain no
-- required data, run in a separately reviewed transaction:
-- BEGIN;
-- DROP TABLE college_memberships;
-- DROP TABLE colleges;
-- COMMIT;
