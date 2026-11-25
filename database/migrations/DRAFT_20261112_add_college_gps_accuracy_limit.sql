-- DRAFT ONLY: College-scoped GPS measurement accuracy policy.
-- This migration is intentionally not applied by the source implementation task.
-- The 100 m value is a GPS accuracy limit; classroom radius_m remains unchanged.

ALTER TABLE public.colleges
    ADD COLUMN IF NOT EXISTS gps_accuracy_limit_m INTEGER NOT NULL DEFAULT 100;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_colleges_gps_accuracy_limit_m_range'
          AND conrelid = 'public.colleges'::regclass
    ) THEN
        ALTER TABLE public.colleges
            ADD CONSTRAINT ck_colleges_gps_accuracy_limit_m_range
            CHECK (gps_accuracy_limit_m BETWEEN 1 AND 150);
    END IF;
END
$$;
