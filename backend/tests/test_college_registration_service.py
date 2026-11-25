"""Direct registration service tests on a synthetic in-memory SQLite database."""

import hashlib
import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.college_registration import (
    _review_application,
    read_application_status,
    submit_college_application,
)
from app.database import Base
from app.models import (
    College,
    CollegeMembership,
    CollegeRegistrationApplication,
    CollegeStatusHistory,
    User,
)
from app.schemas.college_registration import (
    CollegeRegistrationCreate,
    CollegeRegistrationStatusRequest,
)
from app.security import verify_password


def registration_payload(**overrides):
    values = {
        "college_name": "Synthetic Registration College",
        "college_type": "University",
        "address": "100 Synthetic Road",
        "city": "Test City",
        "state": "Test State",
        "postal_code": "12345",
        "country": "Testland",
        "official_email": "Office@Example.Test",
        "contact_number": "+14155550123",
        "website": None,
        "admin_name": "Synthetic Applicant",
        "admin_email": "Applicant@Example.org",
        "admin_contact_number": "+14155550124",
        "password": "Synthetic!Registration123",
        "password_confirmation": "Synthetic!Registration123",
    }
    values.update(overrides)
    return CollegeRegistrationCreate.model_validate(values)


class CollegeRegistrationServiceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)

    def tearDown(self):
        self.engine.dispose()

    def test_submission_persists_pending_application_and_status_uses_reference_plus_token(self):
        with self.Session() as db:
            submission = submit_college_application(registration_payload(), db)
            self.assertEqual(submission.status, "pending")
            self.assertTrue(submission.application_reference.startswith("AXR-"))
            self.assertNotEqual(submission.application_reference, submission.tracking_token)
            application = db.query(CollegeRegistrationApplication).one()
            self.assertEqual(application.official_email, "office@example.test")
            self.assertEqual(application.admin_email, "applicant@example.org")
            self.assertTrue(verify_password("Synthetic!Registration123", application.admin_password_hash))
            self.assertEqual(
                application.tracking_token_digest,
                hashlib.sha256(submission.tracking_token.encode("utf-8")).hexdigest(),
            )
            self.assertEqual(db.query(College).count(), 0)
            self.assertEqual(db.query(CollegeMembership).count(), 0)

            status_result = read_application_status(
                CollegeRegistrationStatusRequest(
                    application_reference=submission.application_reference,
                    tracking_token=submission.tracking_token,
                ),
                db,
            )
            self.assertEqual(status_result.application_reference, submission.application_reference)
            self.assertEqual(status_result.status, "pending")
            with self.assertRaises(HTTPException) as wrong_reference:
                read_application_status(
                    CollegeRegistrationStatusRequest(
                        application_reference="AXR-" + "z" * 32,
                        tracking_token=submission.tracking_token,
                    ),
                    db,
                )
            self.assertEqual(wrong_reference.exception.status_code, 404)

    def test_duplicate_application_returns_409_without_creating_second_record(self):
        with self.Session() as db:
            submit_college_application(registration_payload(), db)
            with self.assertRaises(HTTPException) as duplicate:
                submit_college_application(registration_payload(college_name="Different College Name"), db)
            self.assertEqual(duplicate.exception.status_code, 409)
            self.assertNotIn("applicant@example.org", duplicate.exception.detail)
            self.assertEqual(db.query(CollegeRegistrationApplication).count(), 1)

    def test_approval_activates_college_admin_and_membership_in_one_transaction(self):
        with self.Session() as db:
            submission = submit_college_application(registration_payload(), db)
            reviewer = User(
                id=8801,
                name="Synthetic Super Admin",
                email="reviewer@example.test",
                hashed_password="synthetic-only",
                role="super_admin",
                is_active=True,
            )
            db.add(reviewer)
            db.commit()
            application = db.query(CollegeRegistrationApplication).one()
            result = _review_application(
                db,
                application.id,
                reviewer.id,
                decision="approved",
                reason="Synthetic review",
            )
            self.assertEqual(result.status, "approved")
            self.assertEqual(result.provisioning_status, "activated")
            college = db.query(College).one()
            admin = db.query(User).filter(User.id == result.admin_user_id).one()
            membership = db.query(CollegeMembership).filter_by(user_id=admin.id).one()
            self.assertEqual(college.status, "active")
            self.assertTrue(admin.is_active)
            self.assertEqual(membership.role, "college_admin")
            self.assertEqual(membership.status, "active")
            self.assertIsNotNone(membership.activated_at)
            self.assertTrue(verify_password("Synthetic!Registration123", admin.hashed_password))
            self.assertIsNone(application.admin_password_hash)
            self.assertEqual(db.query(CollegeStatusHistory).count(), 1)
            with self.assertRaises(HTTPException) as repeated_decision:
                _review_application(
                    db,
                    application.id,
                    reviewer.id,
                    decision="approved",
                    reason=None,
                )
            self.assertEqual(repeated_decision.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
