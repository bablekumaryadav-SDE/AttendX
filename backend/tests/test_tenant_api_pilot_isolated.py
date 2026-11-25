"""Behavioral cross-college API tests against isolated synthetic SQLite data."""

import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import AttendanceAuditLog, College, CollegeMembership, User
from app.security import create_access_token, get_password_hash


class TenantApiPilotTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.Session.begin() as db:
            db.add_all([
                User(id=1101, name="A College Admin", email="a-admin@example.test", hashed_password="x", role="teacher"),
                User(id=1102, name="B College Admin", email="b-admin@example.test", hashed_password="x", role="student"),
                User(id=1103, name="A Teacher", email="a-teacher@example.test", hashed_password="x", role="teacher"),
                User(id=1104, name="No Membership", email="no-membership@example.test", hashed_password="x", role="student"),
                User(id=1105, name="Suspended Member", email="suspended-member@example.test", hashed_password="x", role="student"),
                User(id=1106, name="Platform Operator", email="platform@example.test", hashed_password="x", role="super_admin"),
                User(id=1107, name="Multi College Member", email="multi@example.test", hashed_password="x", role="teacher"),
                User(id=1108, name="Suspended College Member", email="suspended-college@example.test", hashed_password="x", role="student"),
                User(
                    id=1109,
                    name="Unassigned Legacy Admin",
                    email="legacy-admin@example.org",
                    hashed_password=get_password_hash("legacy-login-test"),
                    role="admin",
                ),
                College(id=71, slug="pilot-college-a", official_name="Synthetic College A", display_name="A Display", status="active"),
                College(id=72, slug="pilot-college-b", official_name="Synthetic College B", display_name="B Display", status="active"),
                College(id=73, slug="pilot-college-suspended", official_name="Synthetic Suspended College", status="suspended"),
            ])
            db.flush()
            db.add_all([
                CollegeMembership(user_id=1101, college_id=71, role="college_admin", status="active"),
                CollegeMembership(user_id=1102, college_id=72, role="college_admin", status="active"),
                CollegeMembership(user_id=1103, college_id=71, role="teacher", status="active"),
                CollegeMembership(user_id=1105, college_id=71, role="student", status="suspended"),
                CollegeMembership(user_id=1107, college_id=71, role="teacher", status="active"),
                CollegeMembership(user_id=1107, college_id=72, role="teacher", status="active"),
                CollegeMembership(user_id=1108, college_id=73, role="student", status="active"),
            ])

        def override_db():
            with self.Session() as db:
                yield db

        app.dependency_overrides.clear()
        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        self.engine.dispose()

    @staticmethod
    def _headers(email, role_claim="irrelevant-for-authorization"):
        token = create_access_token({"sub": email, "role": role_claim})
        return {"Authorization": f"Bearer {token}"}

    def _college_value(self, college_id, field):
        with self.Session() as db:
            return getattr(db.get(College, college_id), field)

    def test_college_a_admin_reads_and_updates_only_its_profile(self):
        headers = self._headers("a-admin@example.test")
        read = self.client.get("/tenant/pilot/college-profile", headers=headers)
        self.assertEqual(read.status_code, 200, read.text)
        self.assertEqual(read.json()["id"], 71)
        self.assertEqual(read.json()["display_name"], "A Display")

        updated = self.client.patch(
            "/tenant/pilot/college-profile",
            headers=headers,
            json={"display_name": "  A Updated  "},
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["display_name"], "A Updated")
        self.assertEqual(self._college_value(71, "display_name"), "A Updated")
        self.assertEqual(self._college_value(72, "display_name"), "B Display")

    def test_college_admin_updates_accuracy_limit_and_change_is_audited(self):
        headers = self._headers("a-admin@example.test")
        profile = self.client.get("/tenant/pilot/college-profile", headers=headers)
        self.assertEqual(profile.status_code, 200, profile.text)
        self.assertEqual(profile.json()["gps_accuracy_limit_m"], 100)
        updated = self.client.patch(
            "/tenant/pilot/college-profile",
            headers=headers,
            json={"gps_accuracy_limit_m": 150},
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["gps_accuracy_limit_m"], 150)
        self.assertEqual(self._college_value(71, "gps_accuracy_limit_m"), 150)
        self.assertEqual(self._college_value(72, "gps_accuracy_limit_m"), 100)
        with self.Session() as db:
            audit = db.query(AttendanceAuditLog).filter_by(
                college_id=71,
                action="college.gps_accuracy_limit_updated",
            ).one()
            self.assertEqual(audit.user_id, 1101)
            self.assertEqual(audit.event_metadata["gps_accuracy_limit_m"], {"before": 100, "after": 150})

    def test_accuracy_setting_is_bounded_and_requires_college_admin(self):
        admin_headers = self._headers("a-admin@example.test")
        for value in (0, 151):
            response = self.client.patch(
                "/tenant/pilot/college-profile", headers=admin_headers,
                json={"gps_accuracy_limit_m": value},
            )
            self.assertEqual(response.status_code, 422, response.text)
        teacher_response = self.client.patch(
            "/tenant/pilot/college-profile",
            headers=self._headers("a-teacher@example.test"),
            json={"gps_accuracy_limit_m": 150},
        )
        self.assertEqual(teacher_response.status_code, 403, teacher_response.text)
        self.assertEqual(self._college_value(71, "gps_accuracy_limit_m"), 100)

    def test_college_a_cannot_read_or_modify_college_b_by_selector(self):
        headers = self._headers("a-admin@example.test")
        read = self.client.get("/tenant/pilot/college-profile?college_id=72", headers=headers)
        self.assertEqual(read.status_code, 403, read.text)

        modified = self.client.patch(
            "/tenant/pilot/college-profile?college_id=72",
            headers=headers,
            json={"display_name": "attempted cross-college write"},
        )
        self.assertEqual(modified.status_code, 403, modified.text)
        self.assertEqual(self._college_value(72, "display_name"), "B Display")

    def test_college_admin_cannot_change_another_colleges_gps_policy(self):
        response = self.client.patch(
            "/tenant/pilot/college-profile?college_id=72",
            headers=self._headers("a-admin@example.test"),
            json={"gps_accuracy_limit_m": 150},
        )
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(self._college_value(71, "gps_accuracy_limit_m"), 100)
        self.assertEqual(self._college_value(72, "gps_accuracy_limit_m"), 100)

    def test_missing_membership_is_denied_by_api(self):
        response = self.client.get(
            "/tenant/pilot/college-profile",
            headers=self._headers("no-membership@example.test"),
        )
        self.assertEqual(response.status_code, 403, response.text)

    def test_inactive_membership_is_denied_by_api(self):
        response = self.client.get(
            "/tenant/pilot/college-profile?college_id=71",
            headers=self._headers("suspended-member@example.test"),
        )
        self.assertEqual(response.status_code, 403, response.text)

    def test_suspended_college_is_denied_by_api(self):
        response = self.client.get(
            "/tenant/pilot/college-profile?college_id=73",
            headers=self._headers("suspended-college@example.test"),
        )
        self.assertEqual(response.status_code, 403, response.text)

    def test_membership_role_cannot_write_admin_profile(self):
        headers = self._headers("a-teacher@example.test", role_claim="college_admin")
        response = self.client.patch(
            "/tenant/pilot/college-profile",
            headers=headers,
            json={"display_name": "teacher must not write"},
        )
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(self._college_value(71, "display_name"), "A Display")

    def test_ambiguous_membership_requires_selecting_a_verified_college(self):
        headers = self._headers("multi@example.test")
        ambiguous = self.client.get("/tenant/pilot/college-profile", headers=headers)
        self.assertEqual(ambiguous.status_code, 409, ambiguous.text)
        selected = self.client.get(
            "/tenant/pilot/college-profile?college_id=71",
            headers=headers,
        )
        self.assertEqual(selected.status_code, 200, selected.text)
        self.assertEqual(selected.json()["id"], 71)

    def test_super_admin_does_not_inherit_college_admin_or_legacy_admin_access(self):
        headers = self._headers("platform@example.test", role_claim="college_admin")
        pilot = self.client.get("/tenant/pilot/college-profile?college_id=71", headers=headers)
        self.assertEqual(pilot.status_code, 403, pilot.text)
        legacy_admin = self.client.get("/admin-dashboard", headers=headers)
        self.assertEqual(legacy_admin.status_code, 503, legacy_admin.text)

    def test_unassigned_legacy_admin_login_remains_but_business_api_is_blocked(self):
        login = self.client.post("/auth/login", json={
            "email": "legacy-admin@example.org",
            "password": "legacy-login-test",
        })
        self.assertEqual(login.status_code, 200, login.text)
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        self.assertEqual(self.client.get("/auth/me", headers=headers).json()["role"], "admin")
        self.assertEqual(self.client.get("/tenant/pilot/college-profile", headers=headers).status_code, 403)
        self.assertEqual(self.client.get("/admin-dashboard", headers=headers).status_code, 503)

    def test_legacy_business_api_returns_sanitized_unavailable_without_queries(self):
        headers = self._headers("a-admin@example.test")
        for path in (
            "/students/1101/guardian",
            "/assignments/",
            "/attendance/sessions",
            "/attendance/student/active-sessions",
            "/face/me/status",
            "/dashboard/student/attendance",
            "/admin-dashboard",
            "/teacher-dashboard/teacher/dashboard",
            "/analytics/overview",
            "/notifications/mine",
        ):
            with self.subTest(path=path):
                response = self.client.get(path, headers=headers)
                self.assertEqual(response.status_code, 503, f"{path}: {response.text}")
                self.assertEqual(
                    response.json()["detail"],
                    "This business API is unavailable until College-scoped authorization is enabled.",
                )

    def test_legacy_business_writes_are_blocked_before_handler_execution(self):
        headers = self._headers("a-admin@example.test")
        registration = self.client.post("/students/?college_id=71", headers=headers, json={
            "name": "Scoped Student", "email": "scoped-student@example.com", "roll_number": "SCOPED-71",
            "password": "SyntheticStudent!2026", "password_confirmation": "SyntheticStudent!2026",
        })
        self.assertEqual(registration.status_code, 201, registration.text)
        requests = (
            (self.client.put, "/classes/71", {}),
            (self.client.delete, "/assignments/71", None),
            (self.client.post, "/attendance-records/", {}),
            (self.client.post, "/notifications/71/read", {}),
        )
        for request, path, body in requests:
            with self.subTest(method=request.__name__, path=path):
                response = request(path, headers=headers, json=body) if body is not None else request(path, headers=headers)
                self.assertEqual(response.status_code, 503, f"{path}: {response.text}")

    def test_legacy_business_gate_requires_authentication(self):
        response = self.client.get("/students/")
        self.assertEqual(response.status_code, 401, response.text)

    def test_unauthenticated_request_is_denied(self):
        response = self.client.get("/tenant/pilot/college-profile")
        self.assertEqual(response.status_code, 401, response.text)

    def test_missing_tenant_schema_fails_closed_with_service_unavailable(self):
        with self.engine.begin() as connection:
            CollegeMembership.__table__.drop(connection)
        response = self.client.get(
            "/tenant/pilot/college-profile",
            headers=self._headers("a-admin@example.test"),
        )
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(response.json()["detail"], "Required College settings schema is unavailable. Contact the administrator.")

    def test_client_body_cannot_supply_an_alternate_tenant_or_fields(self):
        response = self.client.patch(
            "/tenant/pilot/college-profile",
            headers=self._headers("a-admin@example.test"),
            json={"display_name": "Allowed update", "college_id": 72, "status": "active"},
        )
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self._college_value(71, "display_name"), "A Display")
        self.assertEqual(self._college_value(72, "display_name"), "B Display")


if __name__ == "__main__":
    unittest.main()
