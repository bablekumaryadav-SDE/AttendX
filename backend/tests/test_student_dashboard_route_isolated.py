"""Student dashboard route and percentage regression test."""
import unittest
from datetime import datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.dependencies import get_current_user
from app.main import app
from app.models import AttendanceRecord, Student, Subject, User


class Principal(dict):
    __getattr__ = dict.__getitem__


class StudentDashboardRouteTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.Session.begin() as session:
            session.add_all([
                User(id=31, name="Route Student", email="route-student@example.org",
                     hashed_password="x", role="student", is_active=True),
                Student(id=41, name="Route Student", email="route-student@example.org",
                        roll_number="R-41", student_code="S-R41", is_active=True),
                Subject(id=51, name="Systems", code="SYS-51", is_active=True),
                AttendanceRecord(
                    id=61, student_id=41, teacher_id=71, subject_id=51, class_id=81,
                    attendance_date=datetime.now(timezone.utc), status="present",
                ),
                AttendanceRecord(
                    id=62, student_id=41, teacher_id=71, subject_id=51, class_id=81,
                    attendance_date=datetime.now(timezone.utc), status="late",
                ),
            ])
        self.actor = Principal(sub="31", id=31, email="route-student@example.org", role="student")

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

    def test_expected_student_dashboard_route_returns_real_summary(self):
        response = self.client.get("/dashboard/student/attendance")
        self.assertEqual(response.status_code, 200, response.text)
        summary = response.json()
        self.assertEqual(summary["total_classes"], 2)
        self.assertEqual(summary["present_classes"], 2)
        self.assertEqual(summary["absent_classes"], 0)
        self.assertEqual(summary["attendance_percentage"], 100.0)
        self.assertEqual(summary["subjects"][0]["subject_name"], "Systems")


if __name__ == "__main__":
    unittest.main()
