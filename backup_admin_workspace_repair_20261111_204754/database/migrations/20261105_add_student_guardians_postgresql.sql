-- Add one guardian-contact record per existing student; preserve students and
-- existing student data. Apply only after a verified backup and pre-check.
BEGIN;

CREATE TABLE IF NOT EXISTS student_guardians (
    student_id INTEGER PRIMARY KEY
        REFERENCES students(id)
        ON DELETE CASCADE,
    guardian_name VARCHAR(120) NOT NULL,
    guardian_relationship VARCHAR(30) NOT NULL DEFAULT 'Father',
    guardian_mobile VARCHAR(20) NOT NULL,
    alternate_mobile VARCHAR(20),
    notify_absence BOOLEAN NOT NULL DEFAULT TRUE,
    notify_low_attendance BOOLEAN NOT NULL DEFAULT TRUE,
    notification_channel VARCHAR(20) NOT NULL DEFAULT 'sms_email',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
    ALTER TABLE student_guardians ADD CONSTRAINT ck_student_guardians_relationship
        CHECK (guardian_relationship IN ('Father', 'Mother', 'Guardian', 'Brother', 'Sister', 'Other'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE student_guardians ADD CONSTRAINT ck_student_guardians_notification_channel
        CHECK (notification_channel IN ('sms_email', 'sms', 'email'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS ix_student_guardians_mobile
    ON student_guardians (guardian_mobile);

COMMIT;
