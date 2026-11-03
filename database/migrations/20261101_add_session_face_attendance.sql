-- AttendX additive migration for student-class membership and unified
-- session-based attendance. It does not alter, delete, or backfill existing rows.
-- Apply only after a verified backup of the approved target database.

BEGIN;

CREATE TABLE IF NOT EXISTS student_class_assignments (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
    academic_year VARCHAR(20),
    semester INTEGER,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_class_one_active
    ON student_class_assignments (student_id)
    WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS ix_student_class_active_class
    ON student_class_assignments (class_id, is_active);

CREATE TABLE IF NOT EXISTS attendance_sessions (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
    title VARCHAR(180) NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'closed')),
    qr_secret TEXT NOT NULL,
    qr_expires_at TIMESTAMPTZ,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    radius_m DOUBLE PRECISION NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMPTZ,
    CONSTRAINT ck_attendance_session_time CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS ix_attendance_sessions_teacher_status
    ON attendance_sessions (teacher_id, status, starts_at);
CREATE INDEX IF NOT EXISTS ix_attendance_sessions_class_subject
    ON attendance_sessions (class_id, subject_id, starts_at);

CREATE TABLE IF NOT EXISTS attendance_events (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES attendance_sessions(id) ON DELETE RESTRICT,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
    method VARCHAR(20) NOT NULL
        CHECK (method IN ('qr', 'face', 'manual', 'session_close')),
    status VARCHAR(20) NOT NULL
        CHECK (status IN ('present', 'absent', 'late')),
    confidence DOUBLE PRECISION,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    distance_m DOUBLE PRECISION,
    verification_reason TEXT,
    device_hash VARCHAR(128),
    verified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_attendance_event_session_student UNIQUE (session_id, student_id)
);

CREATE INDEX IF NOT EXISTS ix_attendance_events_student_verified
    ON attendance_events (student_id, verified_at DESC);
CREATE INDEX IF NOT EXISTS ix_attendance_events_session_status
    ON attendance_events (session_id, status);

CREATE TABLE IF NOT EXISTS attendance_audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type VARCHAR(100),
    entity_id INTEGER,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_attendance_audit_logs_created
    ON attendance_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_attendance_audit_logs_entity
    ON attendance_audit_logs (entity_type, entity_id);

COMMIT;
