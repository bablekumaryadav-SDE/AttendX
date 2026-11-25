"""Cross-endpoint negative authorization checks using synthetic SQLite only."""

import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import College, CollegeMembership, User
from app.security import create_access_token


class TenantAuthorizationNegativePathTests(unittest.TestCase):
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
                User(id=7301, name="No membership", email="negative-none@example.test", hashed_password="x", role="admin"),
                User(id=7302, name="Inactive grant", email="negative-inactive@example.test", hashed_password="x", role="admin"),
                User(id=7303, name="Suspended College", email="negative-suspended-college@example.test", hashed_password="x", role="admin"),
                User(id=7304, name="Platform Super Admin", email="negative-super@example.test", hashed_password="x", role="super_admin"),
                User(id=7305, name="Wrong tenant role", email="negative-role@example.test", hashed_password="x", role="admin"),
                User(id=7306, name="Ambiguous member", email="negative-multi@example.test", hashed_password="x", role="admin"),
                User(id=7307, name="College A member", email="negative-a@example.test", hashed_password="x", role="admin"),
                College(id=731, slug="negative-a", official_name="Synthetic College A Sentinel", display_name="College A Sentinel", status="active"),
                College(id=732, slug="negative-b", official_name="Synthetic College B Sentinel", display_name="College B Sentinel", status="active"),
                College(id=733, slug="negative-suspended", official_name="Suspended College Sentinel", display_name="Suspended College Sentinel", status="suspended"),
            ])
            db.flush()
            db.add_all([
                CollegeMembership(user_id=7302, college_id=731, role="college_admin", status="suspended"),
                CollegeMembership(user_id=7303, college_id=733, role="college_admin", status="active"),
                CollegeMembership(user_id=7305, college_id=731, role="teacher", status="active"),
                CollegeMembership(user_id=7306, college_id=731, role="college_admin", status="active"),
                CollegeMembership(user_id=7306, college_id=732, role="college_admin", status="active"),
                CollegeMembership(user_id=7307, college_id=731, role="college_admin", status="active"),
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
    def headers(email):
        # The claim is deliberately inaccurate; authorization must use DB state.
        token = create_access_token({"sub": email, "role": "super_admin"})
        return {"Authorization": f"Bearer {token}"}

    @staticmethod
    def operations(college_id=731):
        query = f"?college_id={college_id}"
        return (
            ("GET", "/tenant/pilot/college-profile" + query, None),
            ("PATCH", "/tenant/pilot/college-profile" + query, {"display_name": "Attempted update"}),
            ("GET", "/subjects/" + query, None),
            ("GET", "/subjects/9991" + query, None),
            ("GET", "/classes/" + query, None),
            ("GET", "/classes/9991" + query, None),
            ("GET", "/teachers/" + query, None),
            ("GET", "/teachers/9991" + query, None),
            ("GET", "/students/" + query, None),
            ("GET", "/students/9991" + query, None),
            ("GET", "/attendance/" + query, None),
            ("GET", "/attendance/9991" + query, None),
            ("GET", "/attendance-records/" + query, None),
            ("GET", "/attendance-records/9991" + query, None),
            ("GET", "/tenant/dashboard/summary" + query, None),
            ("GET", "/tenant/dashboard/attendance-summary" + query, None),
        )

    def assert_no_cross_college_disclosure(self, response):
        body = response.text.lower()
        for marker in ("college a sentinel", "college b sentinel", "suspended college sentinel"):
            self.assertNotIn(marker, body)

    def request(self, method, path, *, headers=None, json=None):
        if method == "GET":
            return self.client.get(path, headers=headers)
        return self.client.patch(path, headers=headers, json=json)

    def test_unauthenticated_requests_to_all_seventeen_operations_are_denied(self):
        operations = (("GET", "/tenant/memberships", None),) + self.operations()
        self.assertEqual(len(operations), 17)
        for method, path, body in operations:
            with self.subTest(method=method, path=path):
                response = self.request(method, path, json=body)
                self.assertEqual(response.status_code, 401, response.text)
                self.assert_no_cross_college_disclosure(response)

    def test_no_inactive_or_suspended_membership_can_access_tenant_data(self):
        for email in (
            "negative-none@example.test",
            "negative-inactive@example.test",
            "negative-suspended-college@example.test",
        ):
            headers = self.headers(email)
            for method, path, body in self.operations():
                with self.subTest(email=email, method=method, path=path):
                    response = self.request(method, path, headers=headers, json=body)
                    self.assertEqual(response.status_code, 403, response.text)
                    self.assert_no_cross_college_disclosure(response)

    def test_membership_discovery_is_self_only_and_does_not_infer_access(self):
        none = self.client.get("/tenant/memberships", headers=self.headers("negative-none@example.test"))
        inactive = self.client.get("/tenant/memberships", headers=self.headers("negative-inactive@example.test"))
        super_admin = self.client.get("/tenant/memberships", headers=self.headers("negative-super@example.test"))
        self.assertEqual((none.status_code, none.json()), (200, []))
        self.assertEqual((inactive.status_code, inactive.json()), (200, []))
        self.assertEqual(super_admin.status_code, 403)
        for response in (none, inactive, super_admin):
            self.assert_no_cross_college_disclosure(response)

    def test_super_admin_and_membership_role_mismatch_do_not_authorize_tenant_operations(self):
        for method, path, body in self.operations():
            with self.subTest(identity="super-admin", method=method, path=path):
                response = self.request(method, path, headers=self.headers("negative-super@example.test"), json=body)
                self.assertEqual(response.status_code, 403, response.text)
                self.assert_no_cross_college_disclosure(response)

        # Teacher membership is permitted to read the basic catalogs, but not
        # the College Admin student directory, attendance, dashboards, or profile PATCH.
        restricted = (
            self.operations()[1],
            self.operations()[8], self.operations()[9],
            self.operations()[10], self.operations()[11],
            self.operations()[12], self.operations()[13],
            self.operations()[14], self.operations()[15],
        )
        for method, path, body in restricted:
            with self.subTest(identity="teacher-role", method=method, path=path):
                response = self.request(method, path, headers=self.headers("negative-role@example.test"), json=body)
                self.assertEqual(response.status_code, 403, response.text)
                self.assert_no_cross_college_disclosure(response)

    def test_ambiguous_and_foreign_college_selection_fail_closed_for_every_tenant_data_operation(self):
        for method, path, body in self.operations():
            without_selection = path.replace("?college_id=731", "")
            with self.subTest(case="ambiguous", method=method, path=path):
                response = self.request(method, without_selection, headers=self.headers("negative-multi@example.test"), json=body)
                self.assertEqual(response.status_code, 409, response.text)
                self.assert_no_cross_college_disclosure(response)
            foreign_selection = path.replace("college_id=731", "college_id=732")
            with self.subTest(case="foreign-selector", method=method, path=foreign_selection):
                response = self.request(method, foreign_selection, headers=self.headers("negative-a@example.test"), json=body)
                self.assertEqual(response.status_code, 403, response.text)
                self.assert_no_cross_college_disclosure(response)


if __name__ == "__main__":
    unittest.main()
