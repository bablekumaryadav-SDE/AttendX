"""Isolated AttendX Phase 2 regression tests; never uses DATABASE_URL."""
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import get_db
from app.dependencies import get_current_user
from app.main import app
from app.models import Attendance, AttendanceRecord, Student, Subject, Teacher, User
from app.api.dashboard import get_student_attendance
from app.services.attendance_core import build_qr_token, verify_current_qr_token
from app.services.face_engine import decode_embedding, identify_embedding, is_valid_embedding

ROOT = Path(__file__).resolve().parents[2]
SQLITE_MIGRATION = ROOT / "database" / "migrations" / "20261103_add_notification_events_sqlite.sql"


class AttendanceVerificationTests(unittest.TestCase):
    def test_rotated_qr_token_is_rejected(self):
        expires = datetime.now(timezone.utc) + timedelta(minutes=5)
        secret = "unit-test-secret"
        token = build_qr_token(17, secret, expires)
        self.assertTrue(verify_current_qr_token(token, 17, secret, expires))
        self.assertFalse(verify_current_qr_token(token, 17, secret, expires + timedelta(seconds=30)))
        self.assertFalse(verify_current_qr_token(token, 18, secret, expires))

    def test_expired_qr_token_is_rejected(self):
        expired = datetime.now(timezone.utc) - timedelta(seconds=1)
        token = build_qr_token(17, "unit-test-secret", expired)
        self.assertFalse(verify_current_qr_token(token, 17, "unit-test-secret", expired))


class FaceEmbeddingTests(unittest.TestCase):
    def test_vectors_are_normalized_and_unknown_or_ambiguous_faces_rejected(self):
        query = [1.0] + [0.0] * 127
        normalized = decode_embedding([2.0] + [0.0] * 127)
        self.assertIsNotNone(normalized)
        self.assertAlmostEqual(float(np.linalg.norm(normalized)), 1.0, places=6)
        self.assertFalse(is_valid_embedding([2.0] + [0.0] * 127))
        self.assertTrue(is_valid_embedding(query))
        self.assertEqual(identify_embedding(query, [(5, query)])[0:2], (5, "matched"))
        orthogonal = [0.0, 1.0] + [0.0] * 126
        self.assertEqual(identify_embedding(query, [(5, orthogonal)])[0:2], (None, "unknown_face"))
        self.assertEqual(
            identify_embedding(query, [(5, query), (6, query)])[0:2],
            (None, "ambiguous_face"),
        )


class StudentDashboardSummaryTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        for model in (User, Student, Subject, AttendanceRecord):
            model.__table__.create(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.Session.begin() as session:
            session.add_all([
                User(id=31, name="Student", email="dashboard@example.com", hashed_password="x", role="student"),
                Student(id=41, name="Student", email="dashboard@example.com", roll_number="D-41"),
                Subject(id=51, name="Systems", code="SYS-51"),
                AttendanceRecord(id=61, student_id=41, teacher_id=71, subject_id=51, class_id=81,
                                 attendance_date=datetime.now(timezone.utc), status="present"),
                AttendanceRecord(id=62, student_id=41, teacher_id=71, subject_id=51, class_id=81,
                                 attendance_date=datetime.now(timezone.utc), status="late"),
                AttendanceRecord(id=63, student_id=41, teacher_id=71, subject_id=51, class_id=81,
                                 attendance_date=datetime.now(timezone.utc), status="absent"),
            ])

    def tearDown(self):
        self.engine.dispose()

    def test_summary_uses_subject_id_and_counts_late_as_attended(self):
        with self.Session() as session:
            user = session.get(User, 31)
            summary = get_student_attendance(session, user)

        self.assertEqual(summary.total_classes, 3)
        self.assertEqual(summary.present_classes, 2)
        self.assertEqual(summary.absent_classes, 1)
        self.assertEqual(summary.attendance_percentage, 66.67)
        self.assertEqual(summary.subjects[0].subject_name, "Systems")
        self.assertEqual(summary.subjects[0].present_classes, 2)
        self.assertEqual(summary.subjects[0].absent_classes, 1)

    def test_non_student_cannot_use_student_summary(self):
        with self.Session() as session:
            user = session.get(User, 31)
            user.role = "teacher"
            with self.assertRaises(HTTPException) as raised:
                get_student_attendance(session, user)

        self.assertEqual(raised.exception.status_code, 403)


class IsolatedNotificationApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        with self.engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE users (id INTEGER PRIMARY KEY)")
            connection.exec_driver_sql("CREATE TABLE students (id INTEGER PRIMARY KEY)")
            connection.exec_driver_sql("INSERT INTO users (id) VALUES (1), (2)")
            connection.connection.driver_connection.executescript(SQLITE_MIGRATION.read_text(encoding="utf-8"))
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.Session.begin() as session:
            session.execute(text("""INSERT INTO notification_events
                (user_id, event_type, channel, title, message, delivery_status, idempotency_key)
                VALUES
                (1, 'fixture', 'in_app', 'Mine', 'Account one event', 'queued', 'test:user:1'),
                (2, 'fixture', 'in_app', 'Other', 'Account two event', 'queued', 'test:user:2')"""))

        def override_db():
            with self.Session() as session:
                yield session

        app.dependency_overrides.clear()
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_user] = lambda: {"sub": "1", "role": "student"}
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        self.engine.dispose()

    def test_history_and_read_updates_are_owner_scoped(self):
        response = self.client.get("/notifications/history")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["title"] for row in response.json()], ["Mine"])
        own_id = response.json()[0]["id"]
        with self.engine.connect() as connection:
            other_id = connection.execute(
                text("SELECT id FROM notification_events WHERE user_id = 2")
            ).scalar_one()
        self.assertEqual(self.client.post(f"/notifications/{own_id}/read").status_code, 200)
        self.assertEqual(self.client.post(f"/notifications/{other_id}/read").status_code, 404)
        with self.engine.connect() as connection:
            own_read_at = connection.execute(
                text("SELECT read_at FROM notification_events WHERE id = :id"), {"id": own_id}
            ).scalar_one()
            other_read_at = connection.execute(
                text("SELECT read_at FROM notification_events WHERE id = :id"), {"id": other_id}
            ).scalar_one()
        self.assertIsNotNone(own_read_at)
        self.assertIsNone(other_read_at)

    def test_sqlite_migration_is_repeatable_and_deduplicates_events(self):
        with self.engine.begin() as connection:
            connection.connection.driver_connection.executescript(SQLITE_MIGRATION.read_text(encoding="utf-8"))
            with self.assertRaises(IntegrityError):
                connection.exec_driver_sql("""INSERT INTO notification_events
                    (event_type, channel, title, message, delivery_status, idempotency_key)
                    VALUES ('fixture', 'in_app', 'Duplicate', 'Duplicate', 'queued', 'test:user:1')""")


class LegacyAccessScopeTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Student.__table__.create(self.engine)
        Teacher.__table__.create(self.engine)
        Attendance.__table__.create(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.Session.begin() as session:
            session.add_all([
                Student(id=1, name="Student One", email="one@example.test", roll_number="1"),
                Student(id=2, name="Student Two", email="two@example.test", roll_number="2"),
                Teacher(id=10, name="Teacher One", email="teacher1@example.test", employee_id="T1"),
                Teacher(id=11, name="Teacher Two", email="teacher2@example.test", employee_id="T2"),
                Attendance(id=100, student_id=1, teacher_id=10, date=datetime.now(timezone.utc), status="present"),
                Attendance(id=101, student_id=2, teacher_id=11, date=datetime.now(timezone.utc), status="absent"),
            ])

        def override_db():
            with self.Session() as session:
                yield session

        app.dependency_overrides.clear()
        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        self.engine.dispose()

    def _as_user(self, user_id, email, role):
        app.dependency_overrides[get_current_user] = lambda: {
            "sub": str(user_id), "id": user_id, "email": email, "role": role,
        }

    def test_legacy_attendance_reads_are_scoped_to_the_signed_in_profile(self):
        self._as_user(1, "one@example.test", "student")
        response = self.client.get("/attendance/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["id"] for row in response.json()], [100])
        self.assertEqual(self.client.get("/attendance/101").status_code, 404)
        self._as_user(20, "teacher1@example.test", "teacher")
        response = self.client.get("/attendance/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["id"] for row in response.json()], [100])

    def test_teacher_cannot_create_attendance_for_another_teacher(self):
        self._as_user(20, "teacher1@example.test", "teacher")
        response = self.client.post("/attendance/", json={
            "student_id": 2, "teacher_id": 11, "date": "2026-11-03", "status": "present",
        })
        self.assertEqual(response.status_code, 403)

    def test_student_cannot_list_the_private_student_directory(self):
        self._as_user(1, "one@example.test", "student")
        self.assertEqual(self.client.get("/students/").status_code, 403)


if __name__ == "__main__":
    unittest.main()
