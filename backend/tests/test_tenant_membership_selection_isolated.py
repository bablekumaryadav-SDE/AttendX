"""Behavior tests for College selection using synthetic in-memory SQLite only."""

import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import College, CollegeMembership, User
from app.security import create_access_token
from app.tenant_context import resolve_tenant_context


class TenantMembershipSelectionTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.Session.begin() as db:
            db.add_all([
                User(id=3101, name="Multi Member", email="multi-select@example.test", hashed_password="x", role="teacher"),
                User(id=3102, name="No Membership Admin", email="selection-admin@example.test", hashed_password="x", role="admin"),
                User(id=3103, name="Platform Admin", email="selection-super@example.test", hashed_password="x", role="super_admin"),
                College(id=91, slug="select-a", official_name="Official A", display_name="A Display", status="active"),
                College(id=92, slug="select-b", official_name="Official B", display_name="B Display", status="active"),
                College(id=93, slug="select-suspended", official_name="Suspended", status="suspended"),
                College(id=94, slug="select-c", official_name="Official C", display_name="C Display", status="active"),
            ])
            db.flush()
            db.add_all([
                CollegeMembership(user_id=3101, college_id=91, role="teacher", status="active"),
                CollegeMembership(user_id=3101, college_id=92, role="college_admin", status="active"),
                CollegeMembership(user_id=3101, college_id=93, role="student", status="active"),
                CollegeMembership(user_id=3101, college_id=94, role="student", status="suspended"),
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

    def test_membership_discovery_returns_only_safe_active_current_user_rows(self):
        response = self.client.get("/tenant/memberships", headers=self.headers("multi-select@example.test"))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), [
            {"college_id": 91, "college_name": "A Display", "membership_role": "teacher"},
            {"college_id": 92, "college_name": "B Display", "membership_role": "college_admin"},
        ])
        self.assertEqual(set(response.json()[0]), {"college_id", "college_name", "membership_role"})

    def test_missing_membership_is_empty_and_global_admin_does_not_gain_access(self):
        response = self.client.get("/tenant/memberships", headers=self.headers("selection-admin@example.test"))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), [])

    def test_super_admin_does_not_receive_implicit_college_membership(self):
        response = self.client.get("/tenant/memberships", headers=self.headers("selection-super@example.test"))
        self.assertEqual(response.status_code, 403, response.text)

    def test_unauthenticated_membership_discovery_is_denied(self):
        self.assertEqual(self.client.get("/tenant/memberships").status_code, 401)

    def test_missing_membership_schema_fails_closed_with_sanitized_503(self):
        with self.engine.begin() as connection:
            connection.execute(text("DROP TABLE college_memberships"))
        response = self.client.get("/tenant/memberships", headers=self.headers("multi-select@example.test"))
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(response.json(), {"detail": "College membership selection is unavailable."})

    def test_missing_college_schema_fails_closed_with_sanitized_503(self):
        with self.engine.begin() as connection:
            connection.execute(text("DROP TABLE colleges"))
        response = self.client.get("/tenant/memberships", headers=self.headers("multi-select@example.test"))
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(response.json(), {"detail": "College membership selection is unavailable."})

    def test_membership_discovery_does_not_select_unneeded_new_college_columns(self):
        # Simulate the pre-GPS College schema while keeping the required tenant
        # identity columns. This protects membership discovery from unrelated
        # optional College fields added to the ORM before their migration.
        with self.engine.begin() as connection:
            connection.execute(text("CREATE TABLE colleges_legacy (id INTEGER PRIMARY KEY, official_name VARCHAR(200) NOT NULL, display_name VARCHAR(120), status VARCHAR(20) NOT NULL)"))
            connection.execute(text("INSERT INTO colleges_legacy (id, official_name, display_name, status) VALUES (91, 'Official A', 'A Display', 'active'), (92, 'Official B', 'B Display', 'active'), (93, 'Suspended', NULL, 'suspended'), (94, 'Official C', 'C Display', 'active')"))
            connection.execute(text("DROP TABLE colleges"))
            connection.execute(text("ALTER TABLE colleges_legacy RENAME TO colleges"))
        response = self.client.get("/tenant/memberships", headers=self.headers("multi-select@example.test"))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), [
            {"college_id": 91, "college_name": "A Display", "membership_role": "teacher"},
            {"college_id": 92, "college_name": "B Display", "membership_role": "college_admin"},
        ])

    def test_tenant_context_does_not_select_unneeded_new_college_columns(self):
        with self.engine.begin() as connection:
            connection.execute(text("CREATE TABLE colleges_legacy (id INTEGER PRIMARY KEY, official_name VARCHAR(200) NOT NULL, display_name VARCHAR(120), status VARCHAR(20) NOT NULL)"))
            connection.execute(text("INSERT INTO colleges_legacy (id, official_name, display_name, status) VALUES (91, 'Official A', 'A Display', 'active'), (92, 'Official B', 'B Display', 'active'), (93, 'Suspended', NULL, 'suspended'), (94, 'Official C', 'C Display', 'active')"))
            connection.execute(text("DROP TABLE colleges"))
            connection.execute(text("ALTER TABLE colleges_legacy RENAME TO colleges"))
        with self.Session() as db:
            context = resolve_tenant_context(
                db,
                {"id": 3101},
                allowed_roles=frozenset({"teacher"}),
                requested_college_id=91,
            )
        self.assertEqual((context.user_id, context.college_id, context.membership_role), (3101, 91, "teacher"))


if __name__ == "__main__":
    unittest.main()
