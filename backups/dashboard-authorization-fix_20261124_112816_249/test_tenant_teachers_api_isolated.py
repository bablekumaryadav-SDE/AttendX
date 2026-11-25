"""Behavior tests for tenant Teachers against synthetic SQLite only."""

import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import Class, College, CollegeMembership, Subject, Teacher, TeacherAssignment, User
from app.security import create_access_token, verify_password


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
            "name": "New Tenant Teacher", "email": "new-teacher@example.com",
            "password": "SyntheticTeacher!2026", "password_confirmation": "SyntheticTeacher!2026",
        })
        self.assertEqual(created.status_code, 201, created.text)
        self.assertRegex(created.json()["employee_id"], r"^TCH-151-[A-F0-9]{32}$")
        self.assertGreater(created.json()["id"], 0)
        self.assertNotIn("password", created.text)
        teacher_login = self.client.post("/auth/login", json={
            "email": "new-teacher@example.com", "password": "SyntheticTeacher!2026",
        })
        self.assertEqual(teacher_login.status_code, 200, teacher_login.text)
        self.assertIn("access_token", teacher_login.json())
        supplied_id = self.client.post("/teachers/?college_id=151", headers=self.headers("college-a-admin@example.test"), json={
            "name": "Second Tenant Teacher", "email": "second-new-teacher@example.com", "employee_id": "CLIENT-CHOSEN",
            "password": "SyntheticTeacher!2026", "password_confirmation": "SyntheticTeacher!2026",
        })
        self.assertEqual(supplied_id.status_code, 422, supplied_id.text)
        requests = (
            self.client.put("/teachers/1511", headers=headers, json={"name": "Changed"}),
            self.client.post("/teachers/1511/activate", headers=headers),
            self.client.get("/assignments/", headers=headers),
        )
        for response in requests:
            self.assertEqual(response.status_code, 503, response.text)
            self.assertEqual(response.json()["detail"], "This business API is unavailable until College-scoped authorization is enabled.")
        self.assertEqual(self.client.delete("/teachers/1511", headers=headers).status_code, 409)
        self.assertEqual(self.client.get("/teachers/1511/assignments", headers=headers).status_code, 409)
        scoped = self.client.get("/teachers/1511/assignments?college_id=151", headers=headers)
        self.assertEqual(scoped.status_code, 200, scoped.text)

    def test_teacher_can_be_created_without_optional_assignments_and_appears_in_list(self):
        password = "SyntheticTeacher!2026"
        response = self.client.post("/teachers/?college_id=151", headers=self.headers("college-a-admin@example.test"), json={
            "name": "No Assignment Teacher",
            "email": "no-assignment-teacher@example.com",
            "password": password,
            "password_confirmation": password,
        })
        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertEqual(set(body), {
            "id", "name", "employee_id", "department", "is_active", "account_activation", "invitation_status",
        })
        self.assertEqual(body["name"], "No Assignment Teacher")
        self.assertRegex(body["employee_id"], r"^TCH-151-[A-F0-9]{32}$")
        self.assertTrue(body["is_active"])
        self.assertEqual(body["account_activation"], "active")
        self.assertEqual(body["invitation_status"], "not_required")
        self.assertNotIn(password, response.text)
        self.assertNotIn("hashed_password", response.text)

        with self.Session() as db:
            account = db.query(User).filter_by(email="no-assignment-teacher@example.com").one()
            teacher = db.query(Teacher).filter_by(email=account.email).one()
            membership = db.query(CollegeMembership).filter_by(user_id=account.id, college_id=151).one()
            self.assertEqual(teacher.id, body["id"])
            self.assertEqual(teacher.college_id, 151)
            self.assertEqual(membership.role, "teacher")
            self.assertEqual(membership.status, "active")
            self.assertTrue(verify_password(password, account.hashed_password))
            self.assertNotEqual(account.hashed_password, password)

        listed = self.client.get("/teachers/?college_id=151", headers=self.headers("college-a-admin@example.test"))
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertIn(body["id"], {item["id"] for item in listed.json()})
        self.assertNotIn(password, listed.text)

    def test_teacher_registration_persists_only_active_same_college_assignments(self):
        with self.Session.begin() as db:
            db.add_all([
                Class(id=1541, college_id=151, name="Active Class", is_active=True),
                Class(id=1542, college_id=151, name="Inactive Class", is_active=False),
                Class(id=1543, college_id=152, name="Foreign Class", is_active=True),
                Subject(id=1544, college_id=151, name="Active Subject", code="A-SUB", is_active=True),
                Subject(id=1545, college_id=151, name="Inactive Subject", code="I-SUB", is_active=False),
                Subject(id=1546, college_id=152, name="Foreign Subject", code="B-SUB", is_active=True),
            ])

        headers = self.headers("college-a-admin@example.test")

        def request(email, class_id, subject_id, duplicate_assignment=False):
            assignment = {
                "class_id": class_id,
                "subject_id": subject_id,
                "academic_year": "2026-27",
                "semester": 1,
            }
            assignments = [assignment, dict(assignment)] if duplicate_assignment else [assignment]
            return self.client.post("/teachers/?college_id=151", headers=headers, json={
                "name": "Assignment Teacher",
                "email": email,
                "password": "SyntheticTeacher!2026",
                "password_confirmation": "SyntheticTeacher!2026",
                "assignments": assignments,
            })

        created = request("assigned-teacher@example.com", 1541, 1544)
        self.assertEqual(created.status_code, 201, created.text)
        self.assertNotIn("password", created.text)
        with self.Session() as db:
            teacher = db.query(Teacher).filter_by(email="assigned-teacher@example.com").one()
            assignment = db.query(TeacherAssignment).filter_by(teacher_id=teacher.id).one()
            self.assertEqual((assignment.college_id, assignment.class_id, assignment.subject_id), (151, 1541, 1544))

        login = self.client.post("/auth/login", json={
            "email": "assigned-teacher@example.com",
            "password": "SyntheticTeacher!2026",
        })
        self.assertEqual(login.status_code, 200, login.text)
        dashboard_assignments = self.client.get(
            "/tenant/attendance/sessions/assignments?college_id=151",
            headers={"Authorization": f"Bearer {login.json()['access_token']}"},
        )
        self.assertEqual(dashboard_assignments.status_code, 200, dashboard_assignments.text)
        self.assertEqual(len(dashboard_assignments.json()), 1)
        self.assertEqual(dashboard_assignments.json()[0]["class_id"], 1541)
        self.assertEqual(dashboard_assignments.json()[0]["subject_id"], 1544)

        duplicate_registration = request("assigned-teacher@example.com", 1541, 1544)
        self.assertEqual(duplicate_registration.status_code, 409, duplicate_registration.text)
        duplicate_assignment = request("duplicate-assignment@example.com", 1541, 1544, duplicate_assignment=True)
        self.assertEqual(duplicate_assignment.status_code, 422, duplicate_assignment.text)
        with self.Session() as db:
            self.assertEqual(db.query(Teacher).filter_by(email="assigned-teacher@example.com").count(), 1)
            self.assertIsNone(db.query(Teacher).filter_by(email="duplicate-assignment@example.com").one_or_none())

        invalid_pairs = (
            ("inactive-class@example.com", 1542, 1544),
            ("inactive-subject@example.com", 1541, 1545),
            ("foreign-class@example.com", 1543, 1544),
            ("foreign-subject@example.com", 1541, 1546),
        )
        for email, class_id, subject_id in invalid_pairs:
            with self.subTest(class_id=class_id, subject_id=subject_id):
                response = request(email, class_id, subject_id)
                self.assertEqual(response.status_code, 404, response.text)
                self.assertEqual(response.json(), {"detail": "An assignment class or subject was not found."})
                with self.Session() as db:
                    self.assertIsNone(db.query(Teacher).filter_by(email=email).one_or_none())
                    self.assertIsNone(db.query(User).filter_by(email=email).one_or_none())

    def test_assignment_registration_fails_closed_when_effective_date_schema_is_missing(self):
        with self.Session.begin() as db:
            db.add_all([
                Class(id=1571, college_id=151, name="Legacy-compatible class", is_active=True),
                Subject(id=1572, college_id=151, name="Legacy-compatible subject", code="LC-SUB", is_active=True),
            ])
        # Model an existing legacy schema before the draft relationship-date
        # migration. This is test-only SQLite DDL, not the application DB.
        with self.engine.begin() as connection:
            connection.execute(text("DROP TABLE teacher_assignments"))
            connection.execute(text(
                "CREATE TABLE teacher_assignments ("
                "id INTEGER PRIMARY KEY, college_id INTEGER, teacher_id INTEGER NOT NULL, "
                "subject_id INTEGER NOT NULL, class_id INTEGER NOT NULL, academic_year VARCHAR(20), "
                "semester INTEGER, is_active BOOLEAN NOT NULL, created_at DATETIME)"
            ))

        response = self.client.post("/teachers/?college_id=151", headers=self.headers("college-a-admin@example.test"), json={
            "name": "Schema-blocked Teacher",
            "email": "schema-blocked-teacher@example.com",
            "password": "SyntheticTeacher!2026",
            "password_confirmation": "SyntheticTeacher!2026",
            "assignments": [{"class_id": 1571, "subject_id": 1572, "academic_year": "2026-27", "semester": 1}],
        })
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(response.json(), {
            "detail": "Date-aware Teacher assignments require the reviewed relationship effective-date migration."
        })
        with self.Session() as db:
            self.assertIsNone(db.query(User).filter_by(email="schema-blocked-teacher@example.com").one_or_none())
            self.assertIsNone(db.query(Teacher).filter_by(email="schema-blocked-teacher@example.com").one_or_none())


if __name__ == "__main__":
    unittest.main()
