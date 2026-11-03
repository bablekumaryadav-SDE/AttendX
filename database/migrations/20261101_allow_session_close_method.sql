-- Keep the method constraint compatible with existing automatic absence finalization.
-- This is additive to the new attendance_events table and preserves all rows.

BEGIN;

ALTER TABLE attendance_events
    DROP CONSTRAINT IF EXISTS attendance_events_method_check;
ALTER TABLE attendance_events
    DROP CONSTRAINT IF EXISTS ck_attendance_events_method;
ALTER TABLE attendance_events
    ADD CONSTRAINT ck_attendance_events_method
    CHECK (method IN ('qr', 'face', 'manual', 'session_close'));

COMMIT;
