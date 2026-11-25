"""Synthetic SQLite tests for platform College management APIs."""

import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import (
    College,
    CollegeMembership,
    CollegeRegistrationApplication,
    CollegeStatusHistory,
    User,
)
from app.security import create_access_token, get_password_hash


class PlatformCollegeManagementTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.Session.begin() as db:
            db.add_all([
                User(id=1, name="Synthetic Super Admin", email="super@example.test", hashed_password=get_password_hash("Synthetic!Password123"), role="super_admin", is_active=True),
                User(id=2, name="Legacy Admin", email="legacy@example.test", hashed_password=get_password_hash("Synthetic!Password123"), role="admin", is_active=True),
                User(id=3, name="College Admin", email="college-admin@example.test", hashed_password=get_password_hash("Synthetic!Password123"), role="college_admin", is_active=True),
                User(id=4, name="Teacher", email="teacher@example.test", hashed_password=get_password_hash("Synthetic!Password123"), role="teacher", is_active=True),
                User(id=5, name="Student", email="student@example.test", hashed_password=get_password_hash("Synthetic!Password123"), role="student", is_active=True),
                College(id=11, slug="synthetic-active", official_name="Synthetic Active College", status="active"),
                College(id=12, slug="synthetic-suspended", official_name="Synthetic Suspended College", status="suspended"),
                College(id=13, slug="synthetic-pending", official_name="Synthetic Pending College", status="pending"),
                CollegeMembership(id=21, user_id=3, college_id=11, role="college_admin", status="active"),
                CollegeRegistrationApplication(
                    id=31, application_reference="AXR-synthetic-college-reference",
                    tracking_token_digest="a" * 64, status="approved", provisioning_status="pending_activation",
                    college_name="Synthetic Active College", college_type="University", address="1 Example Road",
                    city="Sample City", state="Sample State", postal_code="12345", country="Exampleland",
                    official_email="office@example.test", contact_number="+14155550123", website=None,
                    admin_name="College Admin", admin_email="college-admin@example.test",
                    admin_contact_number="+14155550124", admin_password_hash=None,
                    college_id=11, admin_user_id=3,
                ),
                CollegeStatusHistory(college_id=11, actor_user_id=1, action="provisioned_pending", new_status="pending", reason="Synthetic approved application."),
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

    def headers(self, user_id):
        token = create_access_token({"sub": str(user_id), "role": "forged-super-admin"})
        return {"Authorization": f"Bearer {token}"}

    def test_platform_college_apis_deny_anonymous_and_every_non_super_role(self):
        requests = (
            ("get", "/platform/colleges"),
            ("get", "/platform/colleges/11"),
            ("get", "/platform/colleges/11/history"),
            ("patch", "/platform/colleges/11", {"official_name": "Tampered"}),
            ("post", "/platform/colleges/11/status", {"status": "suspended", "reason": "Synthetic reason."}),
        )
        for method, path, *body in requests:
            anonymous = getattr(self.client, method)(path, json=body[0]) if body else getattr(self.client, method)(path)
            self.assertEqual(anonymous.status_code, 401)
            for user_id in (2, 3, 4, 5):
                response = getattr(self.client, method)(path, headers=self.headers(user_id), json=body[0]) if body else getattr(self.client, method)(path, headers=self.headers(user_id))
                self.assertEqual(response.status_code, 403, (method, path, user_id, response.text))

    def test_search_and_detail_show_persisted_college_application_and_admin_state(self):
        response = self.client.get("/platform/colleges?q=synthetic-active", headers=self.headers(1))
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["id"] for item in response.json()], [11])
        detail = self.client.get("/platform/colleges/11", headers=self.headers(1))
        self.assertEqual(detail.status_code, 200, detail.text)
        body = detail.json()
        self.assertEqual(body["application_reference"], "AXR-synthetic-college-reference")
        self.assertEqual(body["provisioning_status"], "pending_activation")
        self.assertEqual(body["admins"][0]["email"], "college-admin@example.test")
        self.assertEqual(body["admins"][0]["membership_status"], "active")
        history = self.client.get("/platform/colleges/11/history", headers=self.headers(1))
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.json()[0]["action"], "provisioned_pending")

    def test_profile_update_only_accepts_permitted_names(self):
        updated = self.client.patch("/platform/colleges/11", headers=self.headers(1), json={
            "official_name": "Renamed Synthetic College", "display_name": "Synthetic",
            "city": "Updated City", "official_email": "updated@example.test", "contact_number": "+14155550199",
        })
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["official_name"], "Renamed Synthetic College")
        self.assertEqual(updated.json()["slug"], "synthetic-active")
        self.assertEqual(updated.json()["city"], "Updated City")
        self.assertEqual(updated.json()["official_email"], "updated@example.test")
        for payload in ({"slug": "changed-slug"}, {"status": "suspended"}, {"admins": []}, {"official_name": None}, {"owner_user_id": 3}):
            rejected = self.client.patch("/platform/colleges/11", headers=self.headers(1), json=payload)
            self.assertEqual(rejected.status_code, 422, (payload, rejected.text))
        with self.Session() as db:
            self.assertEqual(db.get(College, 11).slug, "synthetic-active")
            self.assertEqual(db.get(College, 11).status, "active")

    def test_suspend_and_reactivate_are_audited_and_suspension_denies_tenant_access(self):
        suspended = self.client.post("/platform/colleges/11/status", headers=self.headers(1), json={"status": "suspended", "reason": "Synthetic policy review."})
        self.assertEqual(suspended.status_code, 200, suspended.text)
        self.assertEqual(suspended.json()["status"], "suspended")
        tenant = self.client.get("/tenant/pilot/college-profile", headers=self.headers(3))
        self.assertEqual(tenant.status_code, 403)
        reactivated = self.client.post("/platform/colleges/11/status", headers=self.headers(1), json={"status": "active", "reason": "Synthetic issue resolved."})
        self.assertEqual(reactivated.status_code, 200, reactivated.text)
        self.assertEqual(reactivated.json()["status"], "active")
        events = self.client.get("/platform/colleges/11/history", headers=self.headers(1)).json()
        self.assertEqual([event["action"] for event in events], ["provisioned_pending", "suspended", "reactivated"])

    def test_invalid_status_transitions_and_missing_college_are_rejected(self):
        cases = (
            (11, {"status": "active", "reason": "No-op active."}),
            (12, {"status": "suspended", "reason": "Already suspended."}),
            (13, {"status": "active", "reason": "Activation bypass."}),
        )
        for college_id, payload in cases:
            response = self.client.post(f"/platform/colleges/{college_id}/status", headers=self.headers(1), json=payload)
            self.assertEqual(response.status_code, 409)
        missing = self.client.get("/platform/colleges/999", headers=self.headers(1))
        self.assertEqual(missing.status_code, 404)


if __name__ == "__main__":
    unittest.main()
