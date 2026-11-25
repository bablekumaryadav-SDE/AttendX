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
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
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

    def test_legacy_analytics_filter_route_is_default_denied(self):
        response = self.client.get("/analytics/records", params={
            "date_from": "2026-10-01",
            "date_to": "2026-10-01",
            "status": "LATE",
            "class_id": 60,
            "subject_id": 50,
            "student_id": 40,
            "teacher_id": 10,
        })
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(response.json(), {"detail": "This business API is unavailable until College-scoped authorization is enabled."})

    def test_legacy_analytics_route_is_denied_for_student_role(self):
        self.actor.update(sub="30", role="student", email="a@example.org")
        response = self.client.get("/analytics/records", params={"student_id": 41})
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(response.json(), {"detail": "This business API is unavailable until College-scoped authorization is enabled."})

    def test_legacy_analytics_route_is_denied_before_filter_processing(self):
        bad_range = self.client.get("/analytics/records", params={
            "date_from": "2026-10-03", "date_to": "2026-10-01",
        })
        self.assertEqual(bad_range.status_code, 503)
        self.assertEqual(bad_range.json(), {"detail": "This business API is unavailable until College-scoped authorization is enabled."})
        empty = self.client.get("/analytics/records", params={"class_id": 999})
        self.assertEqual(empty.status_code, 503)
        self.assertEqual(empty.json(), {"detail": "This business API is unavailable until College-scoped authorization is enabled."})


if __name__ == "__main__":
    unittest.main()
