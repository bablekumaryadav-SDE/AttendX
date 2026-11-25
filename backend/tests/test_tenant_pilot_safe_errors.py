"""Pure contract tests for GPS settings validation and sanitized DB errors.

These tests do not create a database engine session or execute SQL.
"""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy.exc import OperationalError
from pydantic import ValidationError

from app.api import tenant_pilot
from app.api.tenant_pilot import _database_failure_detail
from app.api.tenant_face import _save_attendance_event
from app.schemas.tenant_pilot import TenantCollegeProfileUpdate
from app.services.attendance_core import get_college_gps_accuracy_limit, validate_geofence_fix


def _db_error(sqlstate, *, column=None):
    original = SimpleNamespace(
        sqlstate=sqlstate,
        pgcode=None,
        diag=SimpleNamespace(
            constraint_name=None,
            schema_name="public",
            table_name="colleges",
            column_name=column,
        ),
    )
    return RuntimeError("synthetic") if sqlstate is None else SimpleNamespace(orig=original)


class TenantPilotSafeErrorTests(unittest.TestCase):
    def test_accuracy_limit_accepts_only_integer_range(self):
        self.assertEqual(TenantCollegeProfileUpdate(gps_accuracy_limit_m=120).gps_accuracy_limit_m, 120)
        for value in (0, -1, 151, 100.5):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                TenantCollegeProfileUpdate(gps_accuracy_limit_m=value)

    def test_known_schema_and_connection_errors_get_safe_messages(self):
        missing_gps_column = _db_error("42703", column="gps_accuracy_limit_m")
        missing_relation = _db_error("42P01")
        connection_failure = _db_error("08006")

        self.assertIn("GPS settings schema is unavailable", _database_failure_detail(missing_gps_column))
        self.assertIn("Required College settings schema is unavailable", _database_failure_detail(missing_relation))
        self.assertIn("database is temporarily unavailable", _database_failure_detail(connection_failure))

    def test_public_error_messages_never_include_sql_or_driver_text(self):
        exc = _db_error("42703", column="gps_accuracy_limit_m")
        message = _database_failure_detail(exc)
        self.assertNotIn("SELECT", message)
        self.assertNotIn("42703", message)
        self.assertNotIn("public.colleges", message)

    def test_profile_save_returns_committed_value_and_next_read_sees_it(self):
        college = SimpleNamespace(
            id=71,
            slug="synthetic-college",
            official_name="Synthetic College",
            display_name=None,
            status="active",
            gps_accuracy_limit_m=100,
            updated_at=None,
        )
        context = SimpleNamespace(college_id=71, user_id=10)
        db = SimpleNamespace(add=lambda _obj: None, commit=lambda: None)
        with patch.object(tenant_pilot, "_resolve_context", return_value=context), patch.object(
            tenant_pilot, "get_tenant_college", return_value=college
        ):
            saved = tenant_pilot.update_college_profile(
                TenantCollegeProfileUpdate(gps_accuracy_limit_m=120),
                college_id=71,
                current_user=object(),
                db=db,
            )
            loaded = tenant_pilot.read_college_profile(college_id=71, current_user=object(), db=db)
        self.assertEqual(saved["gps_accuracy_limit_m"], 120)
        self.assertEqual(loaded.gps_accuracy_limit_m, 120)

    def test_commit_failure_is_sanitized_and_rolled_back(self):
        college = SimpleNamespace(
            id=71,
            slug="synthetic-college",
            official_name="Synthetic College",
            display_name=None,
            status="active",
            gps_accuracy_limit_m=100,
            updated_at=None,
        )
        rollback_calls = []
        db = SimpleNamespace(
            add=lambda _obj: None,
            commit=lambda: (_ for _ in ()).throw(
                OperationalError("sensitive SQL omitted", {}, Exception("driver detail"))
            ),
            rollback=lambda: rollback_calls.append(True),
        )
        with patch.object(tenant_pilot, "_resolve_context", return_value=SimpleNamespace(college_id=71, user_id=10)), patch.object(
            tenant_pilot, "get_tenant_college", return_value=college
        ), self.assertRaises(tenant_pilot.HTTPException) as raised:
            tenant_pilot.update_college_profile(
                TenantCollegeProfileUpdate(gps_accuracy_limit_m=120),
                college_id=71,
                current_user=object(),
                db=db,
            )
        self.assertEqual(raised.exception.status_code, 503)
        self.assertNotIn("sensitive SQL", raised.exception.detail)
        self.assertEqual(rollback_calls, [True])

    def test_attendance_reads_setting_for_session_college_and_keeps_fence_separate(self):
        class Query:
            def filter(self, predicate):
                self.predicate = predicate
                return self

            def scalar(self):
                return 120

        requested_column = []
        predicates = []

        class CapturingQuery(Query):
            def filter(self, predicate):
                predicates.append(predicate)
                return self

        db = SimpleNamespace(query=lambda column: (requested_column.append(column), CapturingQuery())[1])
        limit = get_college_gps_accuracy_limit(db, 71)
        self.assertEqual(limit, 120)
        self.assertEqual(len(requested_column), 1)
        self.assertIn(71, predicates[0].compile().params.values())
        self.assertEqual(validate_geofence_fix(0, 0, 107, 100, accuracy_limit_m=limit), 107)
        with self.assertRaises(tenant_pilot.HTTPException) as raised:
            validate_geofence_fix(0, 0, 121, 100, accuracy_limit_m=limit)
        self.assertEqual(raised.exception.status_code, 403)

    def test_attendance_settings_missing_or_invalid_fails_closed(self):
        class Query:
            def filter(self, _predicate):
                return self

            def scalar(self):
                return None

        with self.assertRaises(tenant_pilot.HTTPException) as missing:
            get_college_gps_accuracy_limit(SimpleNamespace(query=lambda _column: Query()), 71)
        self.assertEqual(missing.exception.status_code, 503)
        self.assertIn("unavailable", missing.exception.detail)
        with self.assertRaises(tenant_pilot.HTTPException) as no_college:
            get_college_gps_accuracy_limit(SimpleNamespace(), None)
        self.assertEqual(no_college.exception.status_code, 503)

    def test_face_attendance_can_commit_without_student_location_or_gps_policy_read(self):
        from app.models import AttendanceEvent

        queried = []
        added = []

        class Query:
            def filter(self, *_criteria):
                return self

            def first(self):
                return None

        db = SimpleNamespace(
            query=lambda model: (queried.append(model), Query())[1],
            add=added.append,
            commit=lambda: None,
        )
        context = SimpleNamespace(college_id=71, user_id=811)
        student = SimpleNamespace(id=8110)
        session = SimpleNamespace(
            id=8115,
            latitude=12.0,
            longitude=77.0,
            radius_m=100,
        )
        _save_attendance_event(
            db,
            context,
            student,
            session,
            method="face",
            coordinates=None,
            confidence=0.99,
        )
        event = next(item for item in added if isinstance(item, AttendanceEvent))
        self.assertEqual(event.method, "face")
        self.assertIsNone(event.latitude)
        self.assertIsNone(event.longitude)
        self.assertIsNone(event.distance_m)
        self.assertEqual(queried, [AttendanceEvent.id])

    def test_qr_attendance_still_requires_location_and_uses_college_accuracy_policy(self):
        from app.models import AttendanceEvent, College

        queried = []
        added = []

        class Query:
            def __init__(self, model):
                self.model = model

            def filter(self, *_criteria):
                return self

            def first(self):
                return None

            def scalar(self):
                return 120

        db = SimpleNamespace(
            query=lambda model: (queried.append(model), Query(model))[1],
            add=added.append,
            commit=lambda: None,
        )
        context = SimpleNamespace(college_id=71, user_id=811)
        student = SimpleNamespace(id=8110)
        session = SimpleNamespace(id=8115, latitude=0.0, longitude=0.0, radius_m=100)
        with self.assertRaises(tenant_pilot.HTTPException) as missing_location:
            _save_attendance_event(db, context, student, session, method="qr", coordinates=None)
        self.assertEqual(missing_location.exception.status_code, 400)
        _save_attendance_event(
            db,
            context,
            student,
            session,
            method="qr",
            coordinates={"latitude": 0, "longitude": 0.0002, "accuracy_m": 107},
        )
        event = next(item for item in added if isinstance(item, AttendanceEvent))
        self.assertIn(College.gps_accuracy_limit_m, queried)
        self.assertEqual(event.method, "qr")
        self.assertEqual(event.latitude, 0)
        self.assertEqual(event.longitude, 0.0002)
        self.assertIsNotNone(event.distance_m)


if __name__ == "__main__":
    unittest.main()
