"""Role-scoped report filtering tests using an in-memory SQLite database."""
import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.dependencies import get_current_user
from app.main import app
from app.models import Class, Student, Subject, Teacher, User


class AnalyticsFilterTests(unittest.TestCase):
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
                    id INTEGER PRIMARY KEY, teacher_id INTEGER, subject_id INTEGER,
                    class_id INTEGER, title TEXT, starts_at TIMESTAMP, ends_at TIMESTAMP,
                    status TEXT, qr_secret TEXT, qr_expires_at TIMESTAMP
                )
            """)
            connection.exec_driver_sql("""
                CREATE TABLE attendance_events (
                    id INTEGER PRIMARY KEY, session_id INTEGER, student_id INTEGER,
                    status TEXT, method TEXT, verified_at TIMESTAMP, verification_reason TEXT
                )
            """)
            connection.exec_driver_sql("""
                INSERT INTO attendance_sessions
                (id, teacher_id, subject_id, class_id, title, starts_at, ends_at, status, qr_secret)
                VALUES
                (1, 10, 50, 60, 'Session A', '2026-10-01', '2026-10-01', 'closed', 'secret'),
                (2, 10, 51, 61, 'Session B', '2026-10-02', '2026-10-02', 'closed', 'secret'),
                (3, 10, 50, 60, 'Session C', '2026-10-03', '2026-10-03', 'closed', 'secret')
            """)
            connection.exec_driver_sql("""
                INSERT INTO attendance_events
                (id, session_id, student_id, status, method, verified_at, verification_reason)
                VALUES
                (101, 1, 40, 'late', 'qr', '2026-10-01T09:00:00+00:00', 'fixture'),
                (102, 2, 41, 'present', 'face', '2026-10-02T09:00:00+00:00', 'fixture'),
                (103, 3, 41, 'absent', 'session_close', '2026-10-03T09:00:00+00:00', 'fixture')
            """)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.Session.begin() as session:
            session.add_all([
                User(id=20, name="Teacher", email="teacher@example.org", hashed_password="x", role="teacher"),
                User(id=30, name="Student A", email="a@example.org", hashed_password="x", role="student"),
                User(id=31, name="Student B", email="b@example.org", hashed_password="x", role="student"),
                Teacher(id=10, name="Teacher", email="teacher@example.org", employee_id="T-10"),
                Student(id=40, name="Student A", email="a@example.org", roll_number="40", student_code="S-40"),
                Student(id=41, name="Student B", email="b@example.org", roll_number="41", student_code="S-41"),
                Subject(id=50, name="Systems", code="SYS"),
                Subject(id=51, name="Networks", code="NET"),
                Class(id=60, name="CSE-A", section="A"),
                Class(id=61, name="CSE-B", section="B"),
            ])
        self.actor = {"sub": "900", "role": "admin", "email": "admin@example.org"}

        def override_db():
            with self.Session() as session:
                yield session

        app.dependency_overrides.clear()
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_user] = lambda: self.actor
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        self.engine.dispose()

    def test_admin_can_filter_reports_by_date_status_class_subject_and_student(self):
        response = self.client.get("/analytics/records", params={
            "date_from": "2026-10-01",
            "date_to": "2026-10-01",
            "status": "LATE",
            "class_id": 60,
            "subject_id": 50,
            "student_id": 40,
            "teacher_id": 10,
        })
        self.assertEqual(response.status_code, 200, response.text)
        rows = response.json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], 101)
        self.assertEqual(rows[0]["class_id"], 60)

    def test_student_scope_cannot_be_broadened_by_report_filters(self):
        self.actor.update(sub="30", role="student", email="a@example.org")
        response = self.client.get("/analytics/records", params={"student_id": 41})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([row["student_id"] for row in response.json()], [40])

    def test_invalid_date_range_is_rejected_and_empty_filter_is_empty(self):
        bad_range = self.client.get("/analytics/records", params={
            "date_from": "2026-10-03", "date_to": "2026-10-01",
        })
        self.assertEqual(bad_range.status_code, 422)
        empty = self.client.get("/analytics/records", params={"class_id": 999})
        self.assertEqual(empty.status_code, 200)
        self.assertEqual(empty.json(), [])


if __name__ == "__main__":
    unittest.main()
