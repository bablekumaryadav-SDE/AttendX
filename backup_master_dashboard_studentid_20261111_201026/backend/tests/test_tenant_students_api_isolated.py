"""Behavior tests for tenant Students against synthetic SQLite only."""

import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import College, CollegeMembership, Student, User
from app.security import create_access_token


class TenantStudentsApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

        @event.listens_for(self.engine, "connect")
        def _enable_sqlite_fks(connection, _record):
            cursor = connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.Session.begin() as db:
            db.add_all([
                User(id=6101, name="Global account label", email="student-a@example.test", hashed_password="account-secret", role="student"),
                User(id=6102, name="College B admin", email="b-admin@example.test", hashed_password="x", role="admin"),
                User(id=6103, name="No membership admin", email="no-membership@example.test", hashed_password="x", role="admin"),
                User(id=6104, name="Suspended member", email="suspended@example.test", hashed_password="x", role="college_admin"),
                User(id=6105, name="Suspended College member", email="suspended-college@example.test", hashed_password="x", role="college_admin"),
                User(id=6106, name="Multi College admin", email="multi@example.test", hashed_password="x", role="admin"),
                User(id=6107, name="Platform Super Admin", email="super@example.test", hashed_password="x", role="super_admin"),
                College(id=161, slug="students-a", official_name="Students College A", status="active"),
                College(id=162, slug="students-b", official_name="Students College B", status="active"),
                College(id=163, slug="students-suspended", official_name="Suspended Students College", status="suspended"),
            ])
            db.flush()
            db.add_all([
                CollegeMembership(user_id=6101, college_id=161, role="college_admin", status="active"),
                CollegeMembership(user_id=6102, college_id=162, role="college_admin", status="active"),
                CollegeMembership(user_id=6104, college_id=161, role="college_admin", status="suspended"),
                CollegeMembership(user_id=6105, college_id=163, role="college_admin", status="active"),
                CollegeMembership(user_id=6106, college_id=161, role="college_admin", status="active"),
                CollegeMembership(user_id=6106, college_id=162, role="college_admin", status="active"),
                CollegeMembership(user_id=6107, college_id=161, role="college_admin", status="active"),
                Student(id=1611, college_id=161, student_code="ST-A", name="Asha Student", email="student-a@example.test", roll_number="A-01", department="Science", is_active=True),
                Student(id=1612, college_id=161, student_code="ST-A2", name="Aman Student", email="aman-a@example.test", roll_number="A-02", department="Arts", is_active=False),
                Student(id=1621, college_id=162, student_code="ST-B", name="Bina Student", email="bina-b@example.test", roll_number="B-01", department="Science", is_active=True),
                Student(id=1631, college_id=None, student_code="ST-UNKNOWN", name="Legacy Unknown", email="unknown@example.test", roll_number="U-01", department="Legacy", is_active=True),
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

    def test_selected_active_membership_lists_only_its_college_and_minimal_fields(self):
        response = self.client.get("/students/?college_id=161", headers=self.headers("student-a@example.test"))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([row["id"] for row in response.json()["items"]], [1612, 1611])
        self.assertEqual(response.json()["total"], 2)
        self.assertEqual(set(response.json()["items"][0]), {
            "id", "student_code", "name", "email", "roll_number", "department", "date_of_birth", "gender",
            "enrollment_number", "admission_year", "admission_session", "program_duration_years",
            "current_academic_year", "current_semester", "section", "course", "mobile", "address", "city",
            "state", "postal_code", "is_active", "created_at",
        })
        body = response.text
        for secret_or_related in ("account-secret", "hashed_password", "face_registration", "embedding_json", "guardian_mobile", "class_id", '"role"'):
            self.assertNotIn(secret_or_related, body)

    def test_foreign_unknown_and_missing_details_share_sanitized_404(self):
        headers = self.headers("student-a@example.test")
        responses = [
            self.client.get(f"/students/{student_id}?college_id=161", headers=headers)
            for student_id in (1621, 1631, 9999)
        ]
        self.assertEqual({response.status_code for response in responses}, {404})
        self.assertEqual({response.text for response in responses}, {'{"detail":"Record not found."}'})

    def test_inactive_membership_suspended_college_and_missing_membership_are_denied(self):
        for email in ("no-membership@example.test", "suspended@example.test", "suspended-college@example.test"):
            with self.subTest(email=email):
                response = self.client.get("/students/?college_id=161", headers=self.headers(email))
                self.assertEqual(response.status_code, 403, response.text)

    def test_global_user_role_is_not_tenant_authorization(self):
        # This principal has global role=student; only its active membership role grants access.
        allowed = self.client.get("/students/?college_id=161", headers=self.headers("student-a@example.test"))
        self.assertEqual(allowed.status_code, 200, allowed.text)
        # A global admin without any CollegeMembership gets no directory access.
        denied = self.client.get("/students/", headers=self.headers("no-membership@example.test"))
        self.assertEqual(denied.status_code, 403)
        # Super Admin never inherits College access from a claimed or stored role.
        self.assertEqual(self.client.get("/students/?college_id=161", headers=self.headers("super@example.test")).status_code, 403)

    def test_foreign_or_invalid_college_selection_is_denied(self):
        headers = self.headers("student-a@example.test")
        self.assertEqual(self.client.get("/students/?college_id=162", headers=headers).status_code, 403)
        self.assertEqual(self.client.get("/students/?college_id=999", headers=headers).status_code, 403)
        self.assertEqual(self.client.get("/students/?college_id=0", headers=headers).status_code, 422)

    def test_multiple_active_memberships_require_explicit_selection(self):
        headers = self.headers("multi@example.test")
        self.assertEqual(self.client.get("/students/", headers=headers).status_code, 409)
        selected = self.client.get("/students/?college_id=162", headers=headers)
        self.assertEqual(selected.status_code, 200, selected.text)
        self.assertEqual([row["id"] for row in selected.json()], [1621])

    def test_search_and_active_filter_remain_within_resolved_college(self):
        headers = self.headers("student-a@example.test")
        search = self.client.get("/students/?college_id=161&search=A-02", headers=headers)
        self.assertEqual([row["id"] for row in search.json()["items"]], [1612])
        active = self.client.get("/students/?college_id=161&active_only=true", headers=headers)
        self.assertEqual([row["id"] for row in active.json()["items"]], [1611])

    def test_missing_student_table_or_ownership_column_returns_sanitized_503(self):
        headers = self.headers("student-a@example.test")
        with self.engine.begin() as connection:
            connection.execute(text("DROP TABLE students"))
        response = self.client.get("/students/?college_id=161", headers=headers)
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(response.json(), {"detail": "College-scoped Student directory is unavailable."})

        with self.engine.begin() as connection:
            connection.execute(text("CREATE TABLE students (id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL)"))
        for response in (
            self.client.get("/students/?college_id=161", headers=headers),
            self.client.get("/students/1611?college_id=161", headers=headers),
        ):
            self.assertEqual(response.status_code, 503, response.text)
            self.assertEqual(response.json(), {"detail": "College-scoped Student directory is unavailable."})

    def test_student_registration_is_tenant_scoped_and_other_writes_remain_default_denied(self):
        headers = self.headers("student-a@example.test")
        created = self.client.post("/students/?college_id=161", headers=headers, json={
            "name": "New Tenant Student", "email": "new-student@example.com", "roll_number": "NEW-1",
            "password": "SyntheticStudent!2026", "password_confirmation": "SyntheticStudent!2026",
        })
        self.assertEqual(created.status_code, 201, created.text)
        requests = (
            self.client.put("/students/1611", headers=headers, json={"name": "Changed"}),
            self.client.delete("/students/1611", headers=headers),
            self.client.post("/students/1611/activate", headers=headers),
            self.client.put("/students/1611/class-assignment", headers=headers, json={"class_id": 10}),
            self.client.post("/students/1611/face", headers=headers),
            self.client.delete("/students/1611/face", headers=headers),
            self.client.put("/students/1611/guardian", headers=headers, json={"guardian_name": "X"}),
            self.client.get("/students/1611/guardian", headers=headers),
            self.client.get("/students/1611/class-assignment", headers=headers),
            self.client.get("/assignments/", headers=headers),
        )
        for response in requests:
            with self.subTest(status=response.status_code, body=response.text):
                self.assertEqual(response.status_code, 503, response.text)
                self.assertEqual(response.json()["detail"], "This business API is unavailable until College-scoped authorization is enabled.")

    def test_unauthenticated_reads_are_denied(self):
        self.assertEqual(self.client.get("/students/").status_code, 401)
        self.assertEqual(self.client.get("/students/1611").status_code, 401)


if __name__ == "__main__":
    unittest.main()
