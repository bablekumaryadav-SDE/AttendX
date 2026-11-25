"""Admin attendance statistics include legacy rows and session events."""
import unittest
from datetime import datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.dependencies import get_current_user
from app.main import app
from app.models import AttendanceRecord


class AdminDashboardAttendanceCountTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        with self.engine.begin() as connection:
            connection.exec_driver_sql("""
                CREATE TABLE attendance_events (
                    id INTEGER PRIMARY KEY,
                    session_id INTEGER NOT NULL,
                    student_id INTEGER NOT NULL,
                    method TEXT NOT NULL,
                    status TEXT NOT NULL,
                    verified_at TIMESTAMP
                )
            """)
            connection.exec_driver_sql("""
                INSERT INTO attendance_events VALUES
                (1, 101, 201, 'qr', 'present', '2026-11-03T09:00:00'),
                (2, 101, 202, 'face', 'late', '2026-11-03T09:01:00'),
                (3, 101, 203, 'session_close', 'absent', '2026-11-03T09:02:00')
            """)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.Session.begin() as session:
            session.add(AttendanceRecord(
                id=301, student_id=201, teacher_id=401, subject_id=501,
                class_id=601, attendance_date=datetime.now(timezone.utc), status="present",
            ))

        def override_db():
            with self.Session() as session:
                yield session

        app.dependency_overrides.clear()
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_user] = lambda: {
            "sub": "900", "id": 900, "email": "admin@example.org", "role": "admin",
        }
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        self.engine.dispose()

    def test_total_attendance_count_includes_both_storage_paths(self):
        response = self.client.get("/admin-dashboard")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["total_attendance_records"], 4)


if __name__ == "__main__":
    unittest.main()
