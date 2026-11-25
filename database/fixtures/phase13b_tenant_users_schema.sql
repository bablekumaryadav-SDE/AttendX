-- Phase 13B synthetic schema-only fixture; generated offline.
-- Source: backend/app/models.py User.id SQLAlchemy Integer primary-key metadata.
-- Includes only public.users(id), required by the tenant migration foreign keys.
-- Zero rows: no INSERT statements, credentials, user data, or production data.
-- This fixture tests FK type/key mechanics, not legacy PostgreSQL compatibility.
CREATE TABLE public.users (
	id INTEGER NOT NULL,
	PRIMARY KEY (id)
);
