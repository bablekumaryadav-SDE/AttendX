"""GIS schema and GPS policy checks that use no configured database."""

import unittest
from pathlib import Path

from fastapi import HTTPException
from pydantic import ValidationError

from app.schemas.attendance import StudentQrAttendanceRequest
from app.schemas.attendance_gis import (
    AttendanceSessionGISCreate,
    StudentQrAttendanceGISRequest,
)
from app.models import College
from app.services.attendance_core import haversine_m, validate_geofence_fix


class GisGeofenceTests(unittest.TestCase):
    def test_college_gps_setting_draft_matches_orm_default_and_range(self):
        migration = (
            Path(__file__).resolve().parents[1]
            / ".."
            / "database"
            / "migrations"
            / "DRAFT_20261112_add_college_gps_accuracy_limit.sql"
        ).resolve().read_text(encoding="utf-8").lower()
        self.assertIn("add column if not exists gps_accuracy_limit_m integer not null default 100", migration)
        self.assertIn("check (gps_accuracy_limit_m between 1 and 150)", migration)
        gps_column = College.__table__.c.gps_accuracy_limit_m
        self.assertFalse(gps_column.nullable)
        self.assertEqual(str(gps_column.default.arg), "100")
        self.assertEqual(str(gps_column.server_default.arg), "100")
        self.assertEqual(
            {constraint.name for constraint in College.__table__.constraints},
            {"ck_colleges_status", "ck_colleges_gps_accuracy_limit_m_range", None},
        )

    def test_restored_legacy_qr_schema_remains_unchanged(self):
        legacy = StudentQrAttendanceRequest(token="AXQR.1.abcdefgh")
        self.assertFalse(hasattr(legacy, "accuracy_m"))

    def test_gis_qr_schema_accepts_accuracy_and_rejects_bad_coordinates(self):
        request = StudentQrAttendanceGISRequest(
            token="AXQR.1.abcdefgh", latitude=20.0, longitude=78.0, accuracy_m=12.5
        )
        self.assertEqual(request.accuracy_m, 12.5)
        with self.assertRaises(ValidationError):
            StudentQrAttendanceGISRequest(
                token="AXQR.1.abcdefgh", latitude=91, longitude=78, accuracy_m=10
            )
        with self.assertRaises(ValidationError):
            StudentQrAttendanceGISRequest(
                token="AXQR.1.abcdefgh", latitude=20, accuracy_m=10
            )

    def test_session_radius_is_optional_to_inherit_class_default(self):
        request = AttendanceSessionGISCreate(
            location_verification_mode="gps_off",
            subject_id=1,
            class_id=1,
            title="GIS test",
            starts_at="2026-11-04T09:00:00Z",
            ends_at="2026-11-04T10:00:00Z",
        )
        self.assertIsNone(request.radius_m)
        with self.assertRaises(ValidationError):
            AttendanceSessionGISCreate(
                location_verification_mode="gps_off",
                subject_id=1,
                class_id=1,
                title="GIS test",
                starts_at="2026-11-04T09:00:00Z",
                ends_at="2026-11-04T10:00:00Z",
                latitude=20.0,
            )

    def test_session_creation_requires_explicit_mode_and_mode_specific_gps_values(self):
        common = dict(
            subject_id=1, class_id=1, title="GIS test",
            starts_at="2026-11-04T09:00:00Z", ends_at="2026-11-04T10:00:00Z",
        )
        # The route performs authentication before returning a missing-mode
        # error, so schema construction accepts it but handler must reject it.
        self.assertIsNone(AttendanceSessionGISCreate(**common).location_verification_mode)
        with self.assertRaises(ValidationError):
            AttendanceSessionGISCreate(**common, location_verification_mode="gps_on")
        with self.assertRaises(ValidationError):
            AttendanceSessionGISCreate(**common, location_verification_mode="gps_off", teacher_latitude=20, teacher_longitude=78)
        with self.assertRaises(ValidationError):
            AttendanceSessionGISCreate(**common, location_verification_mode="disabled")

    def test_accuracy_permission_and_haversine_policy(self):
        self.assertAlmostEqual(haversine_m(0, 0, 0, 0.001), 111.195, places=2)
        self.assertEqual(validate_geofence_fix(20, 78, 25, 100), 25)
        self.assertEqual(validate_geofence_fix(20, 78, 100, 100), 100)
        self.assertEqual(validate_geofence_fix(20, 78, 107, 100, 120), 107)
        self.assertEqual(validate_geofence_fix(20, 78, 107, 100, 150), 107)
        with self.assertRaises(HTTPException) as too_imprecise:
            validate_geofence_fix(20, 78, 151, 500, 150)
        self.assertEqual(too_imprecise.exception.status_code, 403)
        for coordinates, accuracy, expected_status in [
            ((None, None), 10, 400),
            ((20, 78), None, 400),
            ((20, 78), -1, 400),
            ((20, 78), 107, 403),
            ((20, 78), 101, 403),
        ]:
            with self.subTest(coordinates=coordinates, accuracy=accuracy):
                with self.assertRaises(HTTPException) as raised:
                    validate_geofence_fix(*coordinates, accuracy, 100)
                self.assertEqual(raised.exception.status_code, expected_status)


if __name__ == "__main__":
    unittest.main()
