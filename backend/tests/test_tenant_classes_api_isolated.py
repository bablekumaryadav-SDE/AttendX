"""Behavior tests for read-only tenant Classes routes on synthetic SQLite only."""

import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import Class, College, CollegeMembership, Student, StudentClassAssignment, User
from app.security import create_access_token


class TenantClassesApiTests(unittest.TestCase):
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
                User(id=4101, name="College A Teacher", email="class-a@example.test", hashed_password="x", role="teacher"),
                User(id=4102, name="No Membership Admin", email="class-admin@example.test", hashed_password="x", role="admin"),
                User(id=4103, name="Suspended Member", email="class-suspended@example.test", hashed_password="x", role="teacher"),
                User(id=4104, name="Super Admin", email="class-super@example.test", hashed_password="x", role="super_admin"),
                User(id=4105, name="Multi Member", email="class-multi@example.test", hashed_password="x", role="teacher"),
                User(id=4106, name="College B Student", email="class-b-student@example.test", hashed_password="x", role="student"),
                User(id=4107, name="College A Admin", email="class-a-admin@example.test", hashed_password="x", role="admin"),
                College(id=111, slug="classes-a", official_name="Classes College A", status="active"),
                College(id=112, slug="classes-b", official_name="Classes College B", status="active"),
                College(id=113, slug="classes-suspended", official_name="Suspended College", status="suspended"),
            ])
            db.flush()
            db.add_all([
                CollegeMembership(user_id=4101, college_id=111, role="teacher", status="active"),
                CollegeMembership(user_id=4103, college_id=111, role="teacher", status="suspended"),
                CollegeMembership(user_id=4105, college_id=111, role="teacher", status="active"),
                CollegeMembership(user_id=4105, college_id=112, role="college_admin", status="active"),
                CollegeMembership(user_id=4106, college_id=113, role="student", status="active"),
                CollegeMembership(user_id=4107, college_id=111, role="college_admin", status="active"),
                Class(id=1111, college_id=111, name="A Mathematics", section="A", is_active=True),
                Class(id=1112, college_id=112, name="B Mathematics", section="B", is_active=True),
                Class(id=1113, college_id=None, name="Legacy Unknown", section="?", is_active=True),
                Student(id=4111, college_id=112, name="B Student", email="b-student@example.test", roll_number="B-1", is_active=True),
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
        return {"Authorization": f"Bearer {create_access_token({'sub': email, 'role': 'untrusted'})}"}

    def test_unauthenticated_reads_are_denied(self):
        self.assertEqual(self.client.get("/classes/").status_code, 401)
        self.assertEqual(self.client.get("/classes/1111").status_code, 401)

    def test_membership_scoped_list_excludes_unknown_ownership_and_orders_by_id(self):
        response = self.client.get("/classes/?college_id=111", headers=self.headers("class-a@example.test"))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([row["id"] for row in response.json()], [1111])
        self.assertNotIn("college_id", response.json()[0])

    def test_detail_hides_foreign_unknown_and_missing_ids_with_same_404(self):
        headers = self.headers("class-a@example.test")
        responses = [self.client.get(f"/classes/{class_id}?college_id=111", headers=headers) for class_id in (1112, 1113, 9999)]
        for response in responses:
            self.assertEqual(response.status_code, 404, response.text)
            self.assertEqual(response.json(), {"detail": "Record not found."})

    def test_no_inactive_or_implicit_global_role_membership_is_granted(self):
        for email in ("class-admin@example.test", "class-suspended@example.test", "class-super@example.test", "class-b-student@example.test"):
            with self.subTest(email=email):
                response = self.client.get("/classes/", headers=self.headers(email))
                self.assertEqual(response.status_code, 403, response.text)

    def test_foreign_and_invalid_college_selectors_are_denied(self):
        headers = self.headers("class-a@example.test")
        for path in ("/classes/?college_id=112", "/classes/?college_id=999"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path, headers=headers).status_code, 403)
        self.assertEqual(self.client.get("/classes/?college_id=0", headers=headers).status_code, 422)

    def test_multiple_memberships_require_selection_then_resolve_selected_college(self):
        headers = self.headers("class-multi@example.test")
        self.assertEqual(self.client.get("/classes/", headers=headers).status_code, 409)
        selected = self.client.get("/classes/?college_id=112", headers=headers)
        self.assertEqual(selected.status_code, 200, selected.text)
        self.assertEqual([row["id"] for row in selected.json()], [1112])
        detail = self.client.get("/classes/1112?college_id=112", headers=headers)
        self.assertEqual(detail.status_code, 200, detail.text)

    def test_cross_college_parent_link_is_rejected_by_declared_composite_fk(self):
        with self.Session() as db:
            db.add(StudentClassAssignment(
                college_id=111,
                student_id=4111,  # College B student
                class_id=1111,  # College A class
                is_active=True,
            ))
            with self.assertRaises(IntegrityError):
                db.commit()
            db.rollback()

    def test_missing_class_table_fails_closed_for_list_and_detail(self):
        with self.engine.begin() as connection:
            connection.execute(text("DROP TABLE classes"))
        headers = self.headers("class-a@example.test")
        for response in (self.client.get("/classes/", headers=headers), self.client.get("/classes/1111", headers=headers)):
            self.assertEqual(response.status_code, 503, response.text)
            self.assertEqual(response.json(), {"detail": "College-scoped Class catalog is unavailable."})

    def test_missing_class_ownership_column_fails_closed(self):
        with self.engine.begin() as connection:
            connection.execute(text("DROP TABLE classes"))
            connection.execute(text("CREATE TABLE classes (id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL)"))
        response = self.client.get("/classes/", headers=self.headers("class-a@example.test"))
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(response.json(), {"detail": "College-scoped Class catalog is unavailable."})

    def test_tenant_class_writes_are_scoped_and_other_legacy_routes_remain_blocked(self):
        headers = self.headers("class-a-admin@example.test")
        created = self.client.post("/classes/?college_id=111", headers=headers, json={"name": "New", "radius_m": 100})
        self.assertEqual(created.status_code, 201, created.text)
        self.assertNotIn("college_id", created.json())

        updated = self.client.patch(
            f"/classes/{created.json()['id']}?college_id=111",
            headers=headers,
            json={"name": "Changed"},
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["name"], "Changed")

        deactivated = self.client.delete(f"/classes/{created.json()['id']}?college_id=111", headers=headers)
        self.assertEqual(deactivated.status_code, 200, deactivated.text)
        self.assertFalse(deactivated.json()["is_active"])

        attempts = (
            self.client.put("/classes/1111", headers=headers, json={"name": "Changed"}),
            self.client.get("/assignments/", headers=headers),
        )
        for response in attempts:
            self.assertEqual(response.status_code, 503, response.text)
            self.assertEqual(response.json()["detail"], "This business API is unavailable until College-scoped authorization is enabled.")


if __name__ == "__main__":
    unittest.main()
