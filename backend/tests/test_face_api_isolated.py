"""Face enrollment API validation tests with isolated user/student records."""
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.dependencies import get_current_user
from app.main import app
from app.models import FaceEmbedding, Student, User


class FaceApiIsolationTests(unittest.TestCase):
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
                User(id=30, name="Fixture Student", email="face@example.org", hashed_password="x", role="student"),
                Student(id=40, student_code="S-FACE-40", name="Fixture Student",
                        email="face@example.org", roll_number="F-40", is_active=True),
            ])
        self.actor = {"sub": "30", "id": 30, "email": "face@example.org", "role": "student", "is_active": True}

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

    def test_corrupt_image_is_rejected_and_registration_stays_false(self):
        before = self.client.get("/face/me/status")
        self.assertEqual(before.status_code, 200, before.text)
        self.assertFalse(before.json()["face_registered"])

        response = self.client.post(
            "/face/me/register",
            files={"file": ("corrupt.jpg", b"not a valid image", "image/jpeg")},
        )
        self.assertEqual(response.status_code, 422, response.text)

        after = self.client.get("/face/me/status")
        self.assertEqual(after.status_code, 200, after.text)
        self.assertFalse(after.json()["face_registered"])
        with self.Session() as session:
            self.assertEqual(session.query(FaceEmbedding).count(), 0)

    def test_student_cannot_register_a_different_students_face_through_admin_route(self):
        response = self.client.post(
            "/students/40/face",
            files={"file": ("corrupt.jpg", b"not a valid image", "image/jpeg")},
            data={"consent": "true"},
        )
        self.assertEqual(response.status_code, 403)
        with self.Session() as session:
            self.assertEqual(session.query(FaceEmbedding).count(), 0)

    def test_admin_face_registration_requires_explicit_consent(self):
        self.actor["role"] = "admin"
        image = {"file": ("corrupt.jpg", b"not a valid image", "image/jpeg")}

        missing = self.client.post("/students/40/face", files=image)
        self.assertEqual(missing.status_code, 422, missing.text)

        declined = self.client.post(
            "/students/40/face",
            files=image,
            data={"consent": "false"},
        )
        self.assertEqual(declined.status_code, 400, declined.text)
        self.assertIn("consent is required", declined.json()["detail"].lower())
        with self.Session() as session:
            self.assertEqual(session.query(FaceEmbedding).count(), 0)

    def test_admin_face_registration_persists_only_after_consent_and_confirms_status(self):
        self.actor["role"] = "admin"
        image = b"\x89PNG\r\n\x1a\nfixture-image-bytes"
        embedding = [1.0] + [0.0] * 127
        with patch("app.api.students.embedding_from_image", return_value=embedding):
            response = self.client.post(
                "/students/40/face",
                files={"file": ("consented.png", image, "image/png")},
                data={"consent": "true"},
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["face_registered"])
        with self.Session() as session:
            registration = session.query(FaceEmbedding).one()
            self.assertEqual(registration.student_id, 40)
            self.assertEqual(registration.image_data, image)
            self.assertEqual(registration.status, "registered")


if __name__ == "__main__":
    unittest.main()
