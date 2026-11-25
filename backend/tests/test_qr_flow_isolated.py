"""Legacy QR/session URLs stay blocked; tenant attendance flows are tested separately."""
import unittest

from fastapi.testclient import TestClient

from app.dependencies import get_current_user
from app.main import app


BLOCKED_DETAIL = "This business API is unavailable until College-scoped authorization is enabled."


class QrAttendanceFlowTests(unittest.TestCase):
    def setUp(self):
        self.actor = {"sub": "20", "id": 20, "email": "teacher@example.org", "role": "teacher", "is_active": True}
        app.dependency_overrides.clear()
        app.dependency_overrides[get_current_user] = lambda: self.actor
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()

    def assert_legacy_route_blocked(self, response):
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(response.json(), {"detail": BLOCKED_DETAIL})

    def test_legacy_teacher_cannot_create_an_unscoped_attendance_session(self):
        response = self.client.post("/attendance/sessions", json={})
        self.assert_legacy_route_blocked(response)

    def test_legacy_teacher_live_roster_and_dashboard_routes_stay_blocked(self):
        self.assert_legacy_route_blocked(self.client.get("/attendance/sessions/7/live"))
        self.assert_legacy_route_blocked(self.client.get("/teacher-dashboard/teacher/dashboard"))

    def test_legacy_student_qr_submission_stays_blocked(self):
        self.actor.update(sub="30", id=30, email="student@example.org", role="student")
        response = self.client.post(
            "/attendance/student/sessions/7/qr",
            json={"token": "synthetic-invalid-token"},
        )
        self.assert_legacy_route_blocked(response)


if __name__ == "__main__":
    unittest.main()
