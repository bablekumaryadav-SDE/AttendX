"""Legacy face routes remain fail-closed; tenant-face behavior has its own suite."""
import unittest

from fastapi.testclient import TestClient

from app.dependencies import get_current_user
from app.main import app


BLOCKED_DETAIL = "This business API is unavailable until College-scoped authorization is enabled."


class FaceApiIsolationTests(unittest.TestCase):
    def setUp(self):
        self.actor = {"sub": "30", "id": 30, "email": "face@example.org", "role": "student", "is_active": True}
        app.dependency_overrides.clear()
        app.dependency_overrides[get_current_user] = lambda: self.actor
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()

    def assert_legacy_route_blocked(self, response):
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(response.json(), {"detail": BLOCKED_DETAIL})

    def test_legacy_face_status_route_is_blocked(self):
        self.assert_legacy_route_blocked(self.client.get("/face/me/status"))

    def test_legacy_self_registration_is_blocked_before_image_processing(self):
        response = self.client.post(
            "/face/me/register",
            files={"file": ("invalid.jpg", b"synthetic invalid image", "image/jpeg")},
        )
        self.assert_legacy_route_blocked(response)

    def test_legacy_admin_registration_is_blocked_before_image_processing(self):
        self.actor["role"] = "admin"
        response = self.client.post(
            "/students/40/face",
            files={"file": ("invalid.jpg", b"synthetic invalid image", "image/jpeg")},
            data={"consent": "true"},
        )
        self.assert_legacy_route_blocked(response)

    def test_unauthenticated_legacy_face_access_is_rejected(self):
        app.dependency_overrides.pop(get_current_user)
        response = self.client.get("/face/me/status")
        self.assertEqual(response.status_code, 401, response.text)


if __name__ == "__main__":
    unittest.main()
