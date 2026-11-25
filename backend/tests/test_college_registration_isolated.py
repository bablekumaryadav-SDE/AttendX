"""Synthetic SQLite tests for College application and platform review APIs."""

import hashlib
import unittest
from pathlib import Path

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
    CollegeRegistrationReview,
    CollegeStatusHistory,
    User,
)
from app.security import create_access_token, get_password_hash, verify_password


SYNTHETIC_PASSWORD = "Synthetic!Registration123"


def application_payload(**overrides):
    payload = {
        "college_name": "Example Synthetic College",
        "college_type": "University",
        "address": "100 Example Street",
        "city": "Sample City",
        "state": "Sample State",
        "postal_code": "12345",
        "country": "Exampleland",
        "official_email": "Office@Example.Test",
        "contact_number": "+14155550123",
        "website": "https://college.example.test",
        "admin_name": "Synthetic Applicant",
        "admin_email": "Applicant@Example.org",
        "admin_contact_number": "+14155550124",
        "password": SYNTHETIC_PASSWORD,
        "password_confirmation": SYNTHETIC_PASSWORD,
    }
    payload.update(overrides)
    return payload


class CollegeRegistrationApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.Session.begin() as db:
            for uid, role in enumerate(("super_admin", "admin", "college_admin", "teacher", "student"), start=9101):
                db.add(User(
                    id=uid,
                    name=f"Synthetic {role}",
                    email=("admin@example.org" if role == "admin" else f"{role.replace('_', '.')}@example.test"),
                    hashed_password=get_password_hash("Synthetic!Existing123"),
                    role=role,
                    is_active=True,
                ))

        def override_db():
            with self.Session() as db:
                yield db

        self.db_override = override_db
        app.dependency_overrides.clear()
        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        self.engine.dispose()

    def headers(self, user_id):
        token = create_access_token({"sub": str(user_id), "role": "forged-role-claim"})
        return {"Authorization": f"Bearer {token}"}

    def submit(self, **overrides):
        return self.client.post("/college-registration/applications", json=application_payload(**overrides))

    def test_submit_persists_pending_application_without_provisioning_accounts_or_colleges(self):
        response = self.submit()
        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertEqual(body["status"], "pending")
        self.assertTrue(body["application_reference"].startswith("AXR-"))
        self.assertTrue(body["tracking_token"])
        for private_name in ("password", "admin_password_hash", "tracking_token_digest", "admin_email"):
            self.assertNotIn(private_name, body)
        with self.Session() as db:
            application = db.query(CollegeRegistrationApplication).one()
            self.assertEqual(application.official_email, "office@example.test")
            self.assertEqual(application.admin_email, "applicant@example.org")
            self.assertNotEqual(application.admin_password_hash, SYNTHETIC_PASSWORD)
            self.assertTrue(verify_password(SYNTHETIC_PASSWORD, application.admin_password_hash))
            self.assertNotEqual(application.tracking_token_digest, body["tracking_token"])
            self.assertEqual(application.tracking_token_digest, hashlib.sha256(body["tracking_token"].encode()).hexdigest())
            self.assertEqual(db.query(College).count(), 0)
            self.assertEqual(db.query(User).filter(User.id > 9105).count(), 0)
            self.assertEqual(db.query(CollegeMembership).count(), 0)

    def test_public_status_requires_reference_and_token_and_returns_no_private_details(self):
        submitted = self.submit().json()
        status_body = {"application_reference": submitted["application_reference"], "tracking_token": submitted["tracking_token"]}
        response = self.client.post("/college-registration/status", json=status_body)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "pending")
        serialized = response.text.lower()
        for private_value in ("example synthetic college", "applicant@example.org", "tracking_token", "password"):
            self.assertNotIn(private_value, serialized)

        bad_token = self.client.post("/college-registration/status", json={**status_body, "tracking_token": "x" * 40})
        unknown_ref = self.client.post("/college-registration/status", json={**status_body, "application_reference": "AXR-" + "z" * 32})
        self.assertEqual((bad_token.status_code, unknown_ref.status_code), (404, 404))
        self.assertEqual(bad_token.json(), unknown_ref.json())

    def test_duplicate_active_application_is_rejected_without_disclosing_matching_field(self):
        self.assertEqual(self.submit().status_code, 201)
        duplicate = self.submit(college_name="Different Name")
        self.assertEqual(duplicate.status_code, 409)
        self.assertNotIn("applicant@example.org", duplicate.text)
        self.assertIn("application", duplicate.json()["detail"].lower())
        self.assertIn("already exist", duplicate.json()["detail"].lower())
        self.assertIn("tracking token", duplicate.json()["detail"].lower())

    def test_existing_account_cannot_be_linked_by_public_registration(self):
        response = self.submit(admin_email="admin@example.org")
        self.assertEqual(response.status_code, 409)
        with self.Session() as db:
            self.assertEqual(db.query(CollegeRegistrationApplication).count(), 0)

    def test_invalid_email_phone_password_and_confirmation_fail_without_echoing_password(self):
        cases = (
            {"official_email": "not-an-email"},
            {"admin_contact_number": "555-0100"},
            {"password": "weak", "password_confirmation": "weak"},
            {"password_confirmation": "Different!Synthetic123"},
        )
        for override in cases:
            with self.subTest(case=tuple(override)):
                response = self.submit(**override)
                self.assertEqual(response.status_code, 422)
                self.assertNotIn(SYNTHETIC_PASSWORD, response.text)
        with self.Session() as db:
            self.assertEqual(db.query(CollegeRegistrationApplication).count(), 0)

    def test_required_registration_fields_have_field_specific_validation_errors(self):
        for field in ("college_name", "admin_email"):
            payload = application_payload()
            payload.pop(field)
            with self.subTest(field=field):
                response = self.client.post("/college-registration/applications", json=payload)
                self.assertEqual(response.status_code, 422)
                self.assertIn(field, response.text)
                self.assertNotIn(SYNTHETIC_PASSWORD, response.text)

    def test_missing_application_tables_return_sanitized_service_unavailable(self):
        empty_engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
        # Keep the pre-existing users prerequisite available so the request
        # reaches the application's missing registration table query.
        User.__table__.create(empty_engine)
        EmptySession = sessionmaker(bind=empty_engine)

        def missing_schema_db():
            with EmptySession() as db:
                yield db

        app.dependency_overrides[get_db] = missing_schema_db
        with self.assertLogs("app.api.college_registration", level="ERROR") as captured:
            response = self.submit()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"detail": "College application service is unavailable."})
        self.assertTrue(any("failure_class=schema_missing_table" in line for line in captured.output))
        self.assertTrue(any("OperationalError" in line for line in captured.output))
        self.assertNotIn(SYNTHETIC_PASSWORD, "\n".join(captured.output))
        self.assertNotIn("SELECT", "\n".join(captured.output))
        app.dependency_overrides[get_db] = self.db_override
        empty_engine.dispose()

    def test_missing_application_column_is_classified_without_exposing_sql(self):
        incomplete_engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        User.__table__.create(incomplete_engine)
        with incomplete_engine.begin() as connection:
            connection.exec_driver_sql(
                "CREATE TABLE college_registration_applications (id INTEGER PRIMARY KEY)"
            )
        IncompleteSession = sessionmaker(bind=incomplete_engine)
        with IncompleteSession.begin() as db:
            db.add(User(
                id=9101, name="Synthetic Platform Admin", email="platform@example.test",
                hashed_password=get_password_hash("Synthetic!Existing123"), role="super_admin", is_active=True,
            ))

        def incomplete_schema_db():
            with IncompleteSession() as db:
                yield db

        app.dependency_overrides[get_db] = incomplete_schema_db
        with self.assertLogs("app.api.college_registration", level="ERROR") as captured:
            response = self.client.get("/platform/college-applications", headers=self.headers(9101))
        output = "\n".join(captured.output)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"detail": "College application service is unavailable."})
        self.assertIn("failure_class=schema_missing_column", output)
        self.assertNotIn("SELECT", output)
        self.assertNotIn("college_name", output)
        app.dependency_overrides[get_db] = self.db_override
        incomplete_engine.dispose()

    def test_super_admin_authorization_is_server_side_and_legacy_roles_are_denied(self):
        response = self.submit()
        application_id = 1
        self.assertEqual(self.client.get("/platform/college-applications").status_code, 401)
        for uid in (9102, 9103, 9104, 9105):
            self.assertEqual(self.client.get("/platform/college-applications", headers=self.headers(uid)).status_code, 403)
            self.assertEqual(self.client.post(f"/platform/college-applications/{application_id}/approve", headers=self.headers(uid), json={}).status_code, 403)
        self.assertEqual(self.client.get("/platform/college-applications", headers=self.headers(9101)).status_code, 200)
        searched = self.client.get("/platform/college-applications?q=applicant@example.org", headers=self.headers(9101))
        self.assertEqual(searched.status_code, 200)
        self.assertEqual(len(searched.json()), 1)
        self.assertEqual(response.status_code, 201)

    def test_super_admin_can_filter_search_and_open_applications_across_all_review_states(self):
        cases = (
            ("Pending North College", "north.office@example.test", "north.admin@example.org"),
            ("Approved Central College", "central.office@example.test", "central.admin@example.org"),
            ("Rejected South College", "south.office@example.test", "south.admin@example.org"),
            ("Under Review East College", "east.office@example.test", "east.admin@example.org"),
        )
        references = {}
        for college_name, official_email, admin_email in cases:
            response = self.submit(
                college_name=college_name,
                official_email=official_email,
                admin_email=admin_email,
            )
            self.assertEqual(response.status_code, 201, response.text)
            references[college_name] = response.json()["application_reference"]

        all_pending = self.client.get(
            "/platform/college-applications?status=pending",
            headers=self.headers(9101),
        )
        self.assertEqual(all_pending.status_code, 200, all_pending.text)
        ids_by_name = {row["college_name"]: row["id"] for row in all_pending.json()}
        approved = self.client.post(
            f"/platform/college-applications/{ids_by_name['Approved Central College']}/approve",
            headers=self.headers(9101), json={"reason": "Synthetic approval review."},
        )
        rejected = self.client.post(
            f"/platform/college-applications/{ids_by_name['Rejected South College']}/reject",
            headers=self.headers(9101), json={"reason": "Synthetic rejection review."},
        )
        under_review = self.client.post(
            f"/platform/college-applications/{ids_by_name['Under Review East College']}/start-review",
            headers=self.headers(9101), json={"reason": "Synthetic review started."},
        )
        self.assertEqual(approved.status_code, 200, approved.text)
        self.assertEqual(rejected.status_code, 200, rejected.text)
        self.assertEqual(under_review.status_code, 200, under_review.text)

        for state, expected_name in (
            ("pending", "Pending North College"),
            ("under_review", "Under Review East College"),
            ("approved", "Approved Central College"),
            ("rejected", "Rejected South College"),
        ):
            response = self.client.get(
                "/platform/college-applications", params={"status": state}, headers=self.headers(9101)
            )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual([row["college_name"] for row in response.json()], [expected_name])

        searches = (
            ("central.office@example.test", "Approved Central College"),
            ("central.admin@example.org", "Approved Central College"),
            (references["Rejected South College"], "Rejected South College"),
            ("east.office@example.test", "Under Review East College"),
        )
        for term, expected_name in searches:
            with self.subTest(search=term):
                response = self.client.get(
                    "/platform/college-applications",
                    params={"q": term},
                    headers=self.headers(9101),
                )
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual([row["college_name"] for row in response.json()], [expected_name])

        approved_detail = self.client.get(
            f"/platform/college-applications/{ids_by_name['Approved Central College']}",
            headers=self.headers(9101),
        )
        rejected_detail = self.client.get(
            f"/platform/college-applications/{ids_by_name['Rejected South College']}",
            headers=self.headers(9101),
        )
        review_detail = self.client.get(
            f"/platform/college-applications/{ids_by_name['Under Review East College']}",
            headers=self.headers(9101),
        )
        self.assertEqual(
            (approved_detail.status_code, rejected_detail.status_code, review_detail.status_code),
            (200, 200, 200),
        )
        self.assertEqual(approved_detail.json()["status"], "approved")
        self.assertEqual(rejected_detail.json()["status"], "rejected")
        self.assertEqual(review_detail.json()["status"], "under_review")
        for detail in (approved_detail, rejected_detail, review_detail):
            self.assertNotIn("admin_password_hash", detail.json())
            self.assertNotIn("tracking_token_digest", detail.json())

    def test_college_profile_and_history_draft_can_precede_registration_schema(self):
        draft = (Path(__file__).resolve().parents[2] / "database" / "migrations"
                 / "DRAFT_20261110_add_college_status_history.sql").read_text(encoding="utf-8")
        lowered = draft.lower()
        self.assertIn("status: draft / not applied", lowered)
        self.assertIn("public.users", lowered)
        self.assertIn("public.colleges", lowered)
        self.assertNotIn("public.college_registration_applications", lowered)
        self.assertIn("apply this before enabling", lowered)

    def test_approval_activates_college_admin_immediately_and_is_not_repeatable(self):
        self.submit()
        response = self.client.post(
            "/platform/college-applications/1/approve",
            headers=self.headers(9101),
            json={"reason": "Synthetic review passed."},
        )
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual((result["status"], result["provisioning_status"]), ("approved", "activated"))

        with self.Session() as db:
            application = db.query(CollegeRegistrationApplication).one()
            college = db.query(College).one()
            account = db.query(User).filter(User.id == application.admin_user_id).one()
            membership = db.query(CollegeMembership).one()

            self.assertEqual(college.status, "active")
            self.assertTrue(account.is_active)
            self.assertEqual(account.role, "college_admin")
            self.assertEqual(membership.role, "college_admin")
            self.assertEqual(membership.status, "active")
            self.assertEqual(membership.activated_by_user_id, 9101)
            self.assertIsNotNone(membership.activated_at)
            self.assertTrue(membership.status_reason)
            self.assertTrue(verify_password(SYNTHETIC_PASSWORD, account.hashed_password))
            self.assertIsNone(application.admin_password_hash)
            self.assertEqual(
                db.query(CollegeRegistrationReview).filter_by(decision="approved").count(), 1
            )
            self.assertEqual(
                db.query(CollegeStatusHistory).filter_by(
                    college_id=college.id, action="approved_and_activated"
                ).count(),
                1,
            )

        # The submitted registration email/password should work immediately.
        login = self.client.post(
            "/auth/login",
            json={"email": "applicant@example.org", "password": SYNTHETIC_PASSWORD},
        )
        self.assertEqual(login.status_code, 200, login.text)

        provisioned_token = create_access_token(
            {"sub": str(result["admin_user_id"]), "role": "college_admin"}
        )
        memberships = self.client.get(
            "/tenant/memberships",
            headers={"Authorization": f"Bearer {provisioned_token}"},
        )
        self.assertEqual(memberships.status_code, 200, memberships.text)

        repeated = self.client.post(
            "/platform/college-applications/1/approve",
            headers=self.headers(9101),
            json={},
        )
        self.assertEqual(repeated.status_code, 409)
        with self.Session() as db:
            self.assertEqual(db.query(College).count(), 1)
            self.assertEqual(db.query(CollegeMembership).count(), 1)
            self.assertEqual(
                db.query(CollegeStatusHistory).filter_by(
                    college_id=result["college_id"], action="approved_and_activated"
                ).count(),
                1,
            )

    def test_rejection_requires_reason_and_creates_no_college_or_account(self):
        self.submit()
        missing_reason = self.client.post("/platform/college-applications/1/reject", headers=self.headers(9101), json={})
        self.assertEqual(missing_reason.status_code, 422)
        rejected = self.client.post("/platform/college-applications/1/reject", headers=self.headers(9101), json={"reason": "Synthetic application is incomplete."})
        self.assertEqual(rejected.status_code, 200, rejected.text)
        with self.Session() as db:
            application = db.query(CollegeRegistrationApplication).one()
            self.assertEqual(application.status, "rejected")
            self.assertIsNone(application.admin_password_hash)
            self.assertEqual(db.query(College).count(), 0)
            self.assertEqual(db.query(User).filter(User.id > 9105).count(), 0)
            self.assertEqual(db.query(CollegeMembership).count(), 0)
            self.assertEqual(db.query(CollegeRegistrationReview).filter_by(decision="rejected").count(), 1)
        repeated = self.client.post("/platform/college-applications/1/reject", headers=self.headers(9101), json={"reason": "Again."})
        self.assertEqual(repeated.status_code, 409)

    def test_review_history_and_details_never_contain_password_or_tracking_digest(self):
        self.submit()
        self.client.post("/platform/college-applications/1/start-review", headers=self.headers(9101), json={"reason": "Synthetic review started."})
        detail = self.client.get("/platform/college-applications/1", headers=self.headers(9101))
        history = self.client.get("/platform/college-applications/1/history", headers=self.headers(9101))
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.json()[0]["decision"], "under_review")
        for serialized in (detail.text, history.text):
            self.assertNotIn(SYNTHETIC_PASSWORD, serialized)
            self.assertNotIn("admin_password_hash", serialized)
            self.assertNotIn("tracking_token_digest", serialized)

    def test_application_not_found_does_not_expose_details(self):
        response = self.client.get("/platform/college-applications/999", headers=self.headers(9101))
        self.assertEqual(response.status_code, 404)
        self.assertNotIn("synthetic", response.text.lower())


if __name__ == "__main__":
    unittest.main()
