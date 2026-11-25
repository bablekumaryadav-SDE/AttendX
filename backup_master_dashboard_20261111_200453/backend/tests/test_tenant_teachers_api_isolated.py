"""Behavior tests for tenant Teachers against synthetic SQLite only."""

import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import College, CollegeMembership, Teacher, User
from app.security import create_access_token


class TenantTeachersApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.Session.begin() as db:
            db.add_all([
                User(id=5101, name="A teacher principal", email="shared@example.test", hashed_password="never-return-this", role="admin"),
                User(id=5102, name="B member", email="b-member@example.test", hashed_password="x", role="student"),
                User(id=5103, name="No membership", email="no-member@example.test", hashed_password="x", role="admin"),
                User(id=5104, name="Suspended member", email="suspended@example.test", hashed_password="x", role="teacher"),
                User(id=5105, name="Super admin", email="super@example.test", hashed_password="x", role="super_admin"),
                User(id=5106, name="Multi member", email="multi@example.test", hashed_password="x", role="teacher"),
                User(id=5107, name="College A admin", email="college-a-admin@example.test", hashed_password="x", role="admin"),
                College(id=151, slug="teacher-a", official_name="Teacher College A", status="active"),
                College(id=152, slug="teacher-b", official_name="Teacher College B", status="active"),
                College(id=153, slug="teacher-suspended", official_name="Suspended College", status="suspended"),
            ])
            db.flush()
            db.add_all([
                CollegeMembership(user_id=5101, college_id=151, role="teacher", status="active"),
                CollegeMembership(user_id=5101, college_id=152, role="student", status="active"),
                CollegeMembership(user_id=5102, college_id=152, role="college_admin", status="active"),
                CollegeMembership(user_id=5104, college_id=151, role="teacher", status="suspended"),
                CollegeMembership(user_id=5106, college_id=151, role="teacher", status="active"),
                CollegeMembership(user_id=5106, college_id=152, role="student", status="active"),
                CollegeMembership(user_id=5107, college_id=151, role="college_admin", status="active"),
                CollegeMembership(user_id=5102, college_id=153, role="student", status="active"),
                Teacher(id=1511, college_id=151, name="A profile", email="shared@example.test", employee_id="A-1", department="Science", is_active=True),
                Teacher(id=1521, college_id=152, name="B profile", email="b-profile@example.test", employee_id="B-1", department="Arts", is_active=True),
                Teacher(id=1531, college_id=None, name="Unknown legacy", email="unknown@example.test", employee_id="U-1", department="Legacy", is_active=True),
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
        return {"Authorization": f"Bearer {create_access_token({'sub': email, 'role': 'college_admin'})}"}

    def test_unauthenticated_list_and_detail_are_denied(self):
        self.assertEqual(self.client.get("/teachers/").status_code, 401)
        self.assertEqual(self.client.get("/teachers/1511").status_code, 401)

    def test_list_filters_by_active_membership_and_exposes_minimal_profile(self):
        response = self.client.get("/teachers/?college_id=151", headers=self.headers("shared@example.test"))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([row["id"] for row in response.json()], [1511])
        self.assertEqual(set(response.json()[0]), {"id", "name", "department", "is_active", "created_at"})
        encoded = response.text
        for private_value in ("shared@example.test", "A-1", "never-return-this", "hashed_password", "role"):
            self.assertNotIn(private_value, encoded)

    def test_foreign_null_and_missing_details_are_same_sanitized_404(self):
        headers = self.headers("shared@example.test")
        results = [self.client.get(f"/teachers/{item}?college_id=151", headers=headers) for item in (1521, 1531, 9999)]
        self.assertEqual({r.status_code for r in results}, {404})
        self.assertEqual({r.text for r in results}, {'{"detail":"Record not found."}'})

    def test_membership_and_college_status_are_required_not_global_role(self):
        for email in ("no-member@example.test", "suspended@example.test", "super@example.test"):
            with self.subTest(email=email):
                self.assertEqual(self.client.get("/teachers/", headers=self.headers(email)).status_code, 403)
        self.assertEqual(self.client.get("/teachers/?college_id=153", headers=self.headers("b-member@example.test")).status_code, 403)

    def test_caller_cannot_override_tenant_with_foreign_selection(self):
        response = self.client.get("/teachers/?college_id=151", headers=self.headers("b-member@example.test"))
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client.get("/teachers/?college_id=0", headers=self.headers("shared@example.test")).status_code, 422)

    def test_multiple_memberships_require_explicit_selection(self):
        headers = self.headers("multi@example.test")
        self.assertEqual(self.client.get("/teachers/", headers=headers).status_code, 409)
        selected = self.client.get("/teachers/?college_id=152", headers=headers)
        self.assertEqual(selected.status_code, 200, selected.text)
        self.assertEqual([item["id"] for item in selected.json()], [1521])

    def test_global_user_with_multiple_college_memberships_sees_only_selected_profiles(self):
        headers = self.headers("shared@example.test")
        college_b = self.client.get("/teachers/?college_id=152", headers=headers)
        self.assertEqual(college_b.status_code, 200, college_b.text)
        self.assertEqual([item["id"] for item in college_b.json()], [1521])
        self.assertNotIn("A profile", college_b.text)
        self.assertNotIn("shared@example.test", college_b.text)

    def test_missing_tenant_or_ownership_schema_fails_closed(self):
        with self.engine.begin() as connection:
            connection.execute(text("DROP TABLE teachers"))
        response = self.client.get("/teachers/?college_id=151", headers=self.headers("shared@example.test"))
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"detail": "College-scoped Teacher catalog is unavailable."})

    def test_missing_teacher_ownership_column_fails_closed(self):
        with self.engine.begin() as connection:
            connection.execute(text("DROP TABLE teachers"))
            connection.execute(text("CREATE TABLE teachers (id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL)"))
        headers = self.headers("shared@example.test")
        for response in (self.client.get("/teachers/?college_id=151", headers=headers), self.client.get("/teachers/1511?college_id=151", headers=headers)):
            self.assertEqual(response.status_code, 503, response.text)
            self.assertEqual(response.json(), {"detail": "College-scoped Teacher catalog is unavailable."})

    def test_teacher_writes_assignments_and_other_legacy_routes_remain_blocked(self):
        headers = self.headers("shared@example.test")
        created = self.client.post("/teachers/?college_id=151", headers=self.headers("college-a-admin@example.test"), json={
            "name": "New Tenant Teacher", "email": "new-teacher@example.com", "employee_id": "NEW-1",
        })
        self.assertEqual(created.status_code, 201, created.text)
        requests = (
            self.client.put("/teachers/1511", headers=headers, json={"name": "Changed"}),
            self.client.delete("/teachers/1511", headers=headers),
            self.client.post("/teachers/1511/activate", headers=headers),
            self.client.get("/teachers/1511/assignments", headers=headers),
            self.client.get("/assignments/", headers=headers),
        )
        for response in requests:
            self.assertEqual(response.status_code, 503, response.text)
            self.assertEqual(response.json()["detail"], "This business API is unavailable until College-scoped authorization is enabled.")


if __name__ == "__main__":
    unittest.main()
