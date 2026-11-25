-- Add optional classroom GIS configuration. Existing class and attendance data is preserved.
-- Inspect the target and take a verified backup before applying this additive migration.
BEGIN;

ALTER TABLE classes
    ADD COLUMN IF NOT EXISTS location_name VARCHAR(120),
    ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS radius_m DOUBLE PRECISION NOT NULL DEFAULT 100;

DO $$ BEGIN
    ALTER TABLE classes ADD CONSTRAINT ck_classes_latitude_range
        CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE classes ADD CONSTRAINT ck_classes_longitude_range
        CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE classes ADD CONSTRAINT ck_classes_coordinate_pair
        CHECK ((latitude IS NULL) = (longitude IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE classes ADD CONSTRAINT ck_classes_radius_m_range
        CHECK (radius_m BETWEEN 10 AND 5000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
