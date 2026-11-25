"""Behavioral tenant Subject API tests against synthetic SQLite only."""

import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import College, CollegeMembership, Subject, User
from app.security import create_access_token


class TenantSubjectsApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )

        @event.listens_for(self.engine, "connect")
        def _enable_sqlite_fks(dbapi_connection, _connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.Session.begin() as db:
            db.add_all([
                User(id=2101, name="A Teacher", email="subject-a@example.test", hashed_password="x", role="teacher"),
                User(id=2102, name="B Teacher", email="subject-b@example.test", hashed_password="x", role="student"),
                User(id=2103, name="No Membership Admin", email="subject-admin@example.test", hashed_password="x", role="admin"),
                User(id=2104, name="Suspended Member", email="subject-suspended@example.test", hashed_password="x", role="teacher"),
                User(id=2105, name="Suspended College Member", email="subject-college-suspended@example.test", hashed_password="x", role="student"),
                User(id=2106, name="Super Admin", email="subject-super@example.test", hashed_password="x", role="super_admin"),
                User(id=2107, name="Multi College Member", email="subject-multi@example.test", hashed_password="x", role="teacher"),
                College(id=81, slug="subjects-a", official_name="Subjects College A", status="active"),
                College(id=82, slug="subjects-b", official_name="Subjects College B", status="active"),
                College(id=83, slug="subjects-suspended", official_name="Suspended Subjects College", status="suspended"),
            ])
            db.flush()
            db.add_all([
                CollegeMembership(user_id=2101, college_id=81, role="teacher", status="active"),
                CollegeMembership(user_id=2102, college_id=82, role="student", status="active"),
                CollegeMembership(user_id=2104, college_id=81, role="teacher", status="suspended"),
                CollegeMembership(user_id=2105, college_id=83, role="student", status="active"),
                CollegeMembership(user_id=2107, college_id=81, role="teacher", status="active"),
                CollegeMembership(user_id=2107, college_id=82, role="teacher", status="active"),
                Subject(id=801, college_id=81, name="A Mathematics", code="A-MATH", department="Math"),
                Subject(id=802, college_id=82, name="B Mathematics", code="B-MATH", department="Math"),
                Subject(id=803, college_id=81, name="A Physics", code="A-PHY", department="Science"),
                Subject(id=804, college_id=None, name="Legacy Unknown", code="OLD-UNKNOWN", department=None),
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
    def _headers(email):
        return {
            "Authorization": f"Bearer {create_access_token({'sub': email, 'role': 'untrusted-claim'})}"
        }

    def test_unauthenticated_subject_reads_are_denied(self):
        self.assertEqual(self.client.get("/subjects/").status_code, 401)
        self.assertEqual(self.client.get("/subjects/801").status_code, 401)

    def test_active_college_membership_gets_only_its_ordered_subjects(self):
        headers = self._headers("subject-a@example.test")
        response = self.client.get("/subjects/", headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([row["id"] for row in response.json()], [801, 803])
        self.assertEqual([row["name"] for row in response.json()], ["A Mathematics", "A Physics"])
        detail = self.client.get("/subjects/801", headers=headers)
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()["id"], 801)

    def test_foreign_and_unknown_subject_ids_are_indistinguishable(self):
        headers = self._headers("subject-a@example.test")
        foreign = self.client.get("/subjects/802", headers=headers)
        unknown = self.client.get("/subjects/804", headers=headers)
        missing = self.client.get("/subjects/999", headers=headers)
        for response in (foreign, unknown, missing):
            self.assertEqual(response.status_code, 404, response.text)
            self.assertEqual(response.json(), {"detail": "Record not found."})

    def test_foreign_explicit_college_selection_is_denied(self):
        headers = self._headers("subject-a@example.test")
        response = self.client.get("/subjects/?college_id=82", headers=headers)
        self.assertEqual(response.status_code, 403, response.text)
        foreign_detail = self.client.get("/subjects/802?college_id=82", headers=headers)
        self.assertEqual(foreign_detail.status_code, 403, foreign_detail.text)
        invalid = self.client.get("/subjects/?college_id=999", headers=headers)
        self.assertEqual(invalid.status_code, 403, invalid.text)

    def test_membership_is_required_and_must_be_active_and_college_active(self):
        for email in (
            "subject-admin@example.test",  # global Admin alone is not membership
            "subject-suspended@example.test",
            "subject-college-suspended@example.test",
            "subject-super@example.test",
        ):
            with self.subTest(email=email):
                response = self.client.get("/subjects/", headers=self._headers(email))
                self.assertEqual(response.status_code, 403, response.text)

    def test_multiple_memberships_are_not_silently_selected(self):
        headers = self._headers("subject-multi@example.test")
        for path in ("/subjects/",):
            with self.subTest(path=path):
                response = self.client.get(path, headers=headers)
                self.assertEqual(response.status_code, 409, response.text)
        selected = self.client.get("/subjects/?college_id=82", headers=headers)
        self.assertEqual(selected.status_code, 200, selected.text)
        self.assertEqual([row["id"] for row in selected.json()], [802])
        selected_detail = self.client.get("/subjects/802?college_id=82", headers=headers)
        self.assertEqual(selected_detail.status_code, 200, selected_detail.text)
        ambiguous_detail = self.client.get("/subjects/801", headers=headers)
        self.assertEqual(ambiguous_detail.status_code, 409, ambiguous_detail.text)

    def test_missing_subject_table_fails_closed_with_sanitized_503(self):
        with self.engine.begin() as connection:
            connection.execute(text("DROP TABLE subjects"))
        response = self.client.get("/subjects/", headers=self._headers("subject-a@example.test"))
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(
            response.json(),
            {"detail": "College-scoped Subject catalog is unavailable."},
        )
        detail = self.client.get("/subjects/801", headers=self._headers("subject-a@example.test"))
        self.assertEqual(detail.status_code, 503, detail.text)
        self.assertEqual(detail.json(), {"detail": "College-scoped Subject catalog is unavailable."})

    def test_missing_subject_ownership_column_fails_closed_with_sanitized_503(self):
        with self.engine.begin() as connection:
            connection.execute(text("DROP TABLE subjects"))
            connection.execute(text(
                "CREATE TABLE subjects (id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL, "
                "code VARCHAR(50) NOT NULL, department VARCHAR(100), is_active BOOLEAN NOT NULL, "
                "created_at DATETIME)"
            ))
        response = self.client.get("/subjects/", headers=self._headers("subject-a@example.test"))
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(
            response.json(),
            {"detail": "College-scoped Subject catalog is unavailable."},
        )
        detail = self.client.get("/subjects/801", headers=self._headers("subject-a@example.test"))
        self.assertEqual(detail.status_code, 503, detail.text)
        self.assertEqual(detail.json(), {"detail": "College-scoped Subject catalog is unavailable."})

    def test_missing_membership_schema_fails_closed_with_sanitized_503(self):
        with self.engine.begin() as connection:
            connection.execute(text("DROP TABLE college_memberships"))
        response = self.client.get("/subjects/", headers=self._headers("subject-a@example.test"))
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(
            response.json(),
            {"detail": "College-scoped Subject catalog is unavailable."},
        )

    def test_subject_writes_are_college_admin_scoped_and_legacy_put_stays_blocked(self):
        teacher_headers = self._headers("subject-a@example.test")
        denied = self.client.post(
            "/subjects/?college_id=81",
            headers=teacher_headers,
            json={"name": "Teacher Attempt", "code": "T-ATTEMPT"},
        )
        self.assertEqual(denied.status_code, 403, denied.text)

        with self.Session.begin() as db:
            db.add(User(id=2108, name="College Admin", email="subject-college-admin@example.test", hashed_password="x", role="admin"))
            db.flush()
            db.add(CollegeMembership(user_id=2108, college_id=81, role="college_admin", status="active"))
        admin_headers = self._headers("subject-college-admin@example.test")
        created = self.client.post(
            "/subjects/?college_id=81",
            headers=admin_headers,
            json={"name": "A Chemistry", "code": "A-CHEM"},
        )
        self.assertEqual(created.status_code, 201, created.text)
        self.assertNotIn("college_id", created.json())

        updated = self.client.patch(
            f"/subjects/{created.json()['id']}?college_id=81",
            headers=admin_headers,
            json={"name": "A Chemistry II"},
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["name"], "A Chemistry II")

        deactivated = self.client.delete(f"/subjects/{created.json()['id']}?college_id=81", headers=admin_headers)
        self.assertEqual(deactivated.status_code, 200, deactivated.text)
        self.assertFalse(deactivated.json()["is_active"])

        legacy_put = self.client.put("/subjects/801", headers=admin_headers, json={"name": "Legacy"})
        self.assertEqual(legacy_put.status_code, 503, legacy_put.text)


if __name__ == "__main__":
    unittest.main()
