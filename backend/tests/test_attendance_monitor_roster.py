"""Isolated regression coverage for the session roster monitor endpoint."""
import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import get_db
from app.dependencies import get_current_user
from app.main import app


class AttendanceMonitorRosterTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        with self.engine.begin() as connection:
            connection.exec_driver_sql(
                "CREATE TABLE attendance_sessions "
                "(id INTEGER PRIMARY KEY, class_id INTEGER, teacher_id INTEGER)"
            )
            connection.exec_driver_sql(
                "CREATE TABLE students "
                "(id INTEGER PRIMARY KEY, student_code TEXT, name TEXT, "
                "roll_number TEXT, is_active BOOLEAN)"
            )
            connection.exec_driver_sql(
                "CREATE TABLE student_class_assignments "
                "(student_id INTEGER, class_id INTEGER, is_active BOOLEAN)"
            )
            connection.exec_driver_sql(
                "CREATE TABLE attendance_events "
                "(id INTEGER PRIMARY KEY, student_id INTEGER, session_id INTEGER, "
                "status TEXT, method TEXT, verified_at TEXT, distance_m REAL)"
            )
            connection.exec_driver_sql(
                "INSERT INTO attendance_sessions VALUES (7, 3, 9)"
            )
            connection.exec_driver_sql(
                "INSERT INTO students VALUES "
                "(1, 'S-1', 'Ada One', '1', 1), "
                "(2, 'S-2', 'Ben Two', '2', 1), "
                "(3, 'S-3', 'Inactive Student', '3', 0), "
                "(4, 'S-4', 'Other Class Student', '4', 1)"
            )
            # A duplicate active assignment must not duplicate a roster row.
            connection.exec_driver_sql(
                "INSERT INTO student_class_assignments VALUES "
                "(1, 3, 1), (2, 3, 1), (2, 3, 1), (3, 3, 1)"
            )
            connection.exec_driver_sql(
                "INSERT INTO attendance_events VALUES "
                "(11, 1, 7, 'present', 'qr', '2026-11-03T08:00:00', 5.0), "
                "(12, 4, 7, 'late', 'face', '2026-11-03T08:01:00', 6.0)"
            )

        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)

        def override_db():
            with self.Session() as session:
                yield session

        app.dependency_overrides.clear()
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_user] = lambda: {
            "sub": "90",
            "role": "admin",
        }
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        self.engine.dispose()

    def test_live_monitor_returns_enrolled_roster_and_pending_students(self):
        response = self.client.get("/attendance/sessions/7/live")

        self.assertEqual(response.status_code, 200, response.text)
        rows = response.json()
        self.assertEqual([row["student_id"] for row in rows], [1, 2])
        self.assertEqual([row["status"] for row in rows], ["present", "pending"])
        self.assertEqual(rows[0]["attendance_id"], 11)
        self.assertIsNone(rows[1]["attendance_id"])
        self.assertEqual(rows[0]["method"], "qr")
        self.assertIsNone(rows[1]["method"])


if __name__ == "__main__":
    unittest.main()
