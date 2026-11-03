-- AttendX notification events, SQLite
-- Additive only: creates one table and indexes; does not alter or delete data.
-- Apply only to an explicitly approved, backed-up SQLite target.
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS notification_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
    student_id INTEGER NULL REFERENCES students(id) ON DELETE SET NULL,
    event_type VARCHAR(64) NOT NULL,
    channel VARCHAR(24) NOT NULL DEFAULT 'in_app',
    recipient VARCHAR(255),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    delivery_status VARCHAR(20) NOT NULL DEFAULT 'queued'
        CHECK (delivery_status IN ('queued', 'sent', 'failed')),
    idempotency_key VARCHAR(180) NOT NULL UNIQUE,
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TEXT
);

CREATE INDEX IF NOT EXISTS ix_notification_events_user_id
    ON notification_events(user_id);
CREATE INDEX IF NOT EXISTS ix_notification_events_student_id
    ON notification_events(student_id);
CREATE INDEX IF NOT EXISTS ix_notification_events_user_created
    ON notification_events(user_id, created_at);

COMMIT;
