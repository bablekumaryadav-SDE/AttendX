"""Teacher-to-student QR attendance flow against an isolated SQLite fixture."""
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import attendance_sessions as teacher_api
from app.api import student_attendance as student_api
from app.database import Base, get_db
from app.dependencies import get_current_user
from app.main import app
from app.models import (
    Class,
    Student,
    StudentClassAssignment,
    Subject,
    Teacher,
    TeacherAssignment,
    User,
)
from app.services.attendance_core import build_qr_token


class QrAttendanceFlowTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        with self.engine.begin() as connection:
            connection.exec_driver_sql("""
                CREATE TABLE attendance_sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    teacher_id INTEGER NOT NULL,
                    subject_id INTEGER NOT NULL,
                    class_id INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    starts_at TIMESTAMP NOT NULL,
                    ends_at TIMESTAMP NOT NULL,
                    status TEXT NOT NULL,
                    qr_secret TEXT NOT NULL,
                    qr_expires_at TIMESTAMP,
                    latitude REAL,
                    longitude REAL,
                    radius_m REAL NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    closed_at TIMESTAMP
                )
            """)
            connection.exec_driver_sql("""
                CREATE TABLE attendance_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id INTEGER NOT NULL,
                    student_id INTEGER NOT NULL,
                    method TEXT NOT NULL,
                    status TEXT NOT NULL,
                    confidence REAL,
                    latitude REAL,
                    longitude REAL,
                    distance_m REAL,
                    verification_reason TEXT,
                    device_hash TEXT,
                    verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(session_id, student_id)
                )
            """)
            connection.exec_driver_sql("""
                CREATE TABLE attendance_audit_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    action TEXT NOT NULL,
                    entity_type TEXT,
                    entity_id INTEGER,
                    metadata TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.Session.begin() as session:
            teacher_user = User(
                id=20, name="Fixture Teacher", email="teacher@example.org",
                hashed_password="unused", role="teacher", is_active=True,
            )
            student_user = User(
                id=30, name="Fixture Student", email="student@example.org",
                hashed_password="unused", role="student", is_active=True,
            )
            pending_user = User(
                id=31, name="Pending Student", email="pending@example.org",
                hashed_password="unused", role="student", is_active=True,
            )
            teacher = Teacher(
                id=10, name="Fixture Teacher", email=teacher_user.email,
                employee_id="T-QR-1", is_active=True,
            )
            student = Student(
                id=40, student_code="S-QR-1", name="Fixture Student",
                email=student_user.email, roll_number="QR-1", is_active=True,
            )
            pending_student = Student(
                id=41, student_code="S-QR-2", name="Pending Student",
                email=pending_user.email, roll_number="QR-2", is_active=True,
            )
            subject = Subject(id=50, name="Fixture Subject", code="QR-101", is_active=True)
            class_ = Class(id=60, name="Fixture Class", section="A", is_active=True)
            session.add_all([teacher_user, student_user, pending_user, teacher, student, pending_student, subject, class_])
            session.flush()
            session.add_all([
                TeacherAssignment(
                    teacher_id=teacher.id, subject_id=subject.id, class_id=class_.id,
                    academic_year="2026-27", semester=1, is_active=True,
                ),
                StudentClassAssignment(
                    student_id=student.id, class_id=class_.id,
                    academic_year="2026-27", semester=1, is_active=True,
                ),
                StudentClassAssignment(
                    student_id=pending_student.id, class_id=class_.id,
                    academic_year="2026-27", semester=1, is_active=True,
                ),
            ])

        self.actor = {"sub": "20", "role": "teacher", "email": "teacher@example.org"}

        def override_db():
            with self.Session() as session:
                yield session

        app.dependency_overrides.clear()
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_user] = lambda: self.actor
        self.client = TestClient(app)
        self.original_session_loader = teacher_api._session

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        self.engine.dispose()

    def test_teacher_to_student_qr_flow_and_token_rejections(self):
        def typed_session(db, session_id):
            row = dict(self.original_session_loader(db, session_id))
            for field in ("starts_at", "ends_at", "qr_expires_at", "closed_at"):
                value = row.get(field)
                if isinstance(value, str):
                    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
                    row[field] = parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed
            return row

        def create_session(title):
            now = datetime.now(timezone.utc)
            response = self.client.post("/attendance/sessions", json={
                "subject_id": 50,
                "class_id": 60,
                "title": title,
                "starts_at": (now - timedelta(minutes=1)).isoformat(),
                "ends_at": (now + timedelta(minutes=10)).isoformat(),
            })
            self.assertEqual(response.status_code, 201, response.text)
            return response.json()["id"]

        with (
            patch.object(teacher_api, "_session", typed_session),
            patch.object(student_api, "_get_session", lambda db, sid: typed_session(db, sid)),
            patch.object(teacher_api, "log_audit", lambda *args, **kwargs: None),
            patch.object(student_api, "log_audit", lambda *args, **kwargs: None),
        ):
            first_session = create_session("QR Flow One")
            first_qr = self.client.get(f"/attendance/sessions/{first_session}/qr")
            self.assertEqual(first_qr.status_code, 200, first_qr.text)
            old_token = first_qr.json()["token"]

            self.actor.update(sub="30", role="student", email="student@example.org")
            active_sessions = self.client.get("/attendance/student/active-sessions")
            self.assertEqual(active_sessions.status_code, 200, active_sessions.text)
            self.assertEqual(len(active_sessions.json()), 1)

            invalid = self.client.post(
                f"/attendance/student/sessions/{first_session}/qr",
                json={"token": "not-a-valid-attendx-qr-token"},
            )
            self.assertEqual(invalid.status_code, 400)

            with self.Session() as session:
                secret = session.execute(text(
                    "SELECT qr_secret FROM attendance_sessions WHERE id = :id"
                ), {"id": first_session}).scalar_one()
            expired_token = build_qr_token(
                first_session, secret, datetime.now(timezone.utc) - timedelta(seconds=5)
            )
            expired = self.client.post(
                f"/attendance/student/sessions/{first_session}/qr",
                json={"token": expired_token},
            )
            self.assertEqual(expired.status_code, 400)

            self.actor.update(sub="30", role="student", email="student@example.org")
            rotated = self.client.post(f"/attendance/sessions/{first_session}/qr/refresh")
            self.assertEqual(rotated.status_code, 403)
            self.actor.update(sub="20", role="teacher", email="teacher@example.org")
            rotated = self.client.post(f"/attendance/sessions/{first_session}/qr/refresh")
            self.assertEqual(rotated.status_code, 200, rotated.text)
            self.assertNotEqual(rotated.json()["token"], old_token)

            second_session = create_session("QR Flow Two")
            second_qr = self.client.get(f"/attendance/sessions/{second_session}/qr")
            self.assertEqual(second_qr.status_code, 200, second_qr.text)

            self.actor.update(sub="30", role="student", email="student@example.org")
            cross_session = self.client.post(
                f"/attendance/student/sessions/{second_session}/qr",
                json={"token": rotated.json()["token"]},
            )
            self.assertEqual(cross_session.status_code, 400)

            accepted = self.client.post(
                f"/attendance/student/sessions/{first_session}/qr",
                json={"token": rotated.json()["token"]},
            )
            self.assertEqual(accepted.status_code, 200, accepted.text)
            self.assertEqual(accepted.json()["status"], "present")
            duplicate = self.client.post(
                f"/attendance/student/sessions/{first_session}/qr",
                json={"token": rotated.json()["token"]},
            )
            self.assertEqual(duplicate.status_code, 409)

            self.actor.update(sub="20", role="teacher", email="teacher@example.org")
            teacher_live = self.client.get(f"/attendance/sessions/{first_session}/live")
            self.assertEqual(teacher_live.status_code, 200, teacher_live.text)
            self.assertEqual(len(teacher_live.json()), 2)
            self.assertEqual(teacher_live.json()[0]["method"], "qr")
            self.assertEqual(teacher_live.json()[1]["status"], "pending")

            self.actor.update(sub="30", role="student", email="student@example.org")
            history = self.client.get("/attendance/student/me")
            self.assertEqual(history.status_code, 200, history.text)
            self.assertEqual(len(history.json()), 1)
            self.assertEqual(history.json()[0]["method"], "qr")
            refreshed_active = self.client.get("/attendance/student/active-sessions")
            self.assertEqual(refreshed_active.status_code, 200, refreshed_active.text)
            first_active = next(row for row in refreshed_active.json() if row["id"] == first_session)
            self.assertTrue(first_active["already_attended"])

            self.actor.update(sub="20", role="teacher", email="teacher@example.org")
            with patch.object(teacher_api, "_queue_absence_notification", lambda **kwargs: False):
                closed = self.client.post(f"/attendance/sessions/{first_session}/close")
            self.assertEqual(closed.status_code, 200, closed.text)
            self.assertEqual(closed.json()["summary"]["total_students"], 2)
            self.assertEqual(closed.json()["summary"]["present"], 1)
            self.assertEqual(closed.json()["summary"]["absent"], 1)

            with self.Session() as session:
                saved = session.execute(text("""
                    SELECT method, status FROM attendance_events
                    WHERE session_id = :sid AND student_id = 40
                """), {"sid": first_session}).one()
                self.assertEqual(tuple(saved), ("qr", "present"))
                events = session.execute(text("""
                    SELECT session_id, student_id, method, status FROM attendance_events
                    ORDER BY session_id, student_id
                """)).all()
                self.assertEqual(
                    [tuple(event) for event in events],
                    [(first_session, 40, "qr", "present"), (first_session, 41, "session_close", "absent")],
                )


if __name__ == "__main__":
    unittest.main()
