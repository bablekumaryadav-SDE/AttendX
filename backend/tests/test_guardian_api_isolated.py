"""Guardian endpoint integration tests using in-memory SQLite only."""
import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.dependencies import get_current_user
from app.main import app
from app.models import Student


class GuardianApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.Session.begin() as session:
            session.add(Student(
                id=101,
                student_code="GUARD-101",
                name="Guardian Test Student",
                email="guardian-student@example.org",
                roll_number="GUARD-101",
                is_active=True,
            ))
        self.actor = {"sub": "900", "id": 900, "email": "admin@example.org", "role": "admin", "is_active": True}

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

    def test_legacy_guardian_write_is_default_denied(self):
        path = "/students/101/guardian"
        original = {
            "guardian_name": "  Ananya   Sharma ",
            "guardian_relationship": "mother",
            "guardian_mobile": "98765-43210",
            "alternate_mobile": None,
        }
        saved = self.client.put(path, json=original)
        self.assertEqual(saved.status_code, 503, saved.text)
        self.assertEqual(saved.json(), {"detail": "This business API is unavailable until College-scoped authorization is enabled."})

    def test_legacy_guardian_validation_route_is_default_denied(self):
        path = "/students/101/guardian"
        base = {"guardian_name": "Sam Parent", "guardian_relationship": "Father", "guardian_mobile": "9876543210"}
        response = self.client.put(path, json=base)
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(response.json(), {"detail": "This business API is unavailable until College-scoped authorization is enabled."})

    def test_only_admin_can_read_or_write_guardian_and_missing_auth_is_401(self):
        path = "/students/101/guardian"
        payload = {"guardian_name": "Sam Parent", "guardian_relationship": "Father", "guardian_mobile": "9876543210"}
        self.actor["role"] = "student"
        self.assertEqual(self.client.get(path).status_code, 503)
        self.assertEqual(self.client.put(path, json=payload).status_code, 503)

        app.dependency_overrides.pop(get_current_user)
        self.assertEqual(self.client.get(path).status_code, 401)


if __name__ == "__main__":
    unittest.main()
