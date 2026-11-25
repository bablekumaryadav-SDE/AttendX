"""Credential and JWT authentication tests isolated from configured databases."""
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import User
from app.security import get_password_hash


class AuthenticationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.Session.begin() as session:
            session.add(User(
                id=77,
                name="Auth Fixture",
                email="auth-fixture@example.org",
                hashed_password=get_password_hash("isolated-test-password"),
                role="student",
                is_active=True,
            ))

        def override_db():
            with self.Session() as session:
                yield session

        app.dependency_overrides.clear()
        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        self.engine.dispose()

    def test_password_login_me_and_database_role_are_enforced(self):
        denied = self.client.post("/auth/login", json={
            "email": "AUTH-FIXTURE@example.org", "password": "wrong-password",
        })
        self.assertEqual(denied.status_code, 401)

        login = self.client.post("/auth/login", json={
            "email": " AUTH-FIXTURE@example.org ", "password": "isolated-test-password",
        })
        self.assertEqual(login.status_code, 200, login.text)
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        profile = self.client.get("/auth/me", headers=headers)
        self.assertEqual(profile.status_code, 200, profile.text)
        self.assertEqual(profile.json()["user_id"], 77)
        self.assertEqual(profile.json()["role"], "student")
        # The legacy dashboard is behind the default-deny gate, so its public
        # tenant-integration status is not a usable role check here.
        self.assertEqual(self.client.get("/admin-dashboard", headers=headers).status_code, 503)

        # Existing JWT role claims do not override the current database role.
        with self.Session.begin() as session:
            session.get(User, 77).role = "admin"
        self.assertEqual(self.client.get("/auth/me", headers=headers).json()["role"], "admin")

        with self.Session.begin() as session:
            session.get(User, 77).is_active = False
        self.assertEqual(self.client.get("/auth/me", headers=headers).status_code, 401)
        inactive_login = self.client.post("/auth/login", json={
            "email": "auth-fixture@example.org", "password": "isolated-test-password",
        })
        self.assertEqual(inactive_login.status_code, 403)

    def test_expired_jwt_is_rejected(self):
        with patch("app.security.ACCESS_TOKEN_EXPIRE_MINUTES", -1):
            login = self.client.post("/auth/login", json={
                "email": "auth-fixture@example.org", "password": "isolated-test-password",
            })
        self.assertEqual(login.status_code, 200)
        response = self.client.get("/auth/me", headers={
            "Authorization": f"Bearer {login.json()['access_token']}"
        })
        self.assertEqual(response.status_code, 401)

    def test_supported_roles_authenticate_and_auth_me_returns_database_role(self):
        role_cases = (
            (78, "auth-super@example.org", "super_admin"),
            (79, "auth-college-admin@example.org", "admin"),
            (80, "auth-teacher@example.org", "teacher"),
            (81, "auth-student@example.org", "student"),
        )
        with self.Session.begin() as session:
            for user_id, email, role in role_cases:
                session.add(User(
                    id=user_id,
                    name=f"Synthetic {role}",
                    email=email,
                    hashed_password=get_password_hash("RoleLogin!Synthetic2026"),
                    role=role,
                    is_active=True,
                ))

        for _, email, role in role_cases:
            with self.subTest(role=role):
                login = self.client.post("/auth/login", json={
                    "email": email,
                    "password": "RoleLogin!Synthetic2026",
                })
                self.assertEqual(login.status_code, 200, login.text)
                self.assertNotIn("hashed_password", login.json())
                profile = self.client.get("/auth/me", headers={
                    "Authorization": f"Bearer {login.json()['access_token']}"
                })
                self.assertEqual(profile.status_code, 200, profile.text)
                self.assertEqual(profile.json()["role"], role)


if __name__ == "__main__":
    unittest.main()
