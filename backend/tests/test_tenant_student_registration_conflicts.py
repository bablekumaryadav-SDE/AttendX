"""Synthetic SQLite regressions for Student registration duplicate handling."""

import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from app.api.tenant_students import create_tenant_student
from app.database import Base
from app.models import (
    Class, College, CollegeMembership, Student, StudentAcademicHistory,
    StudentClassAssignment, StudentGuardian, StudentIdCounter, User,
)
from app.schemas.tenant_registration import TenantStudentCreate
from app.services.student_module import next_student_code


class TenantStudentRegistrationConflictTests(unittest.TestCase):
    PASSWORD = "SyntheticStudent!2026"

    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.Session.begin() as db:
            db.add_all([
                College(id=951, slug="registration-a", official_name="Registration A", status="active"),
                College(id=952, slug="registration-b", official_name="Registration B", status="active"),
                Class(id=9591, college_id=951, name="Synthetic class", is_active=True),
                User(id=9511, name="Admin A", email="student-admin-a@example.org", hashed_password="synthetic", role="admin", is_active=True),
                User(id=9521, name="Admin B", email="student-admin-b@example.org", hashed_password="synthetic", role="admin", is_active=True),
                CollegeMembership(user_id=9511, college_id=951, role="college_admin", status="active"),
                CollegeMembership(user_id=9521, college_id=952, role="college_admin", status="active"),
            ])

    def tearDown(self):
        self.engine.dispose()

    def payload(self, *, email="new-student@example.org", roll="R-1", enrollment=None, mobile=None, **extra):
        return TenantStudentCreate(
            name="Synthetic Student", email=email, roll_number=roll,
            enrollment_number=enrollment, mobile=mobile,
            password=self.PASSWORD, password_confirmation=self.PASSWORD,
            **extra,
        )

    def create(self, db, payload=None, *, college_id=951, admin_id=9511):
        return create_tenant_student(
            payload or self.payload(), college_id=college_id, db=db, current_user={"id": admin_id}
        )

    def assert_conflict(self, payload, expected_field, *, college_id=951, admin_id=9511):
        with self.Session() as db:
            with self.assertRaises(HTTPException) as raised:
                self.create(db, payload, college_id=college_id, admin_id=admin_id)
        self.assertEqual(raised.exception.status_code, 409)
        detail = raised.exception.detail
        self.assertEqual(detail["field"], expected_field)
        self.assertTrue(detail["code"])
        self.assertNotIn("IntegrityError", detail["message"])
        self.assertNotIn("SELECT", detail["message"])
        return detail

    def test_case_insensitive_global_account_email_conflict_is_field_specific(self):
        detail = self.assert_conflict(
            self.payload(email="STUDENT-ADMIN-A@EXAMPLE.ORG", roll="NEW-1"), "email"
        )
        self.assertEqual(detail["code"], "email_already_registered")

    def test_duplicate_roll_and_enrollment_have_distinct_field_errors(self):
        with self.Session.begin() as db:
            db.add(Student(
                id=9531, college_id=951, student_code="ATX-2026-9501", name="Existing",
                email="existing-student@example.org", roll_number="DUP-ROLL",
                enrollment_number="DUP-ENROLL", is_active=False,
            ))
        roll_detail = self.assert_conflict(self.payload(email="roll-new@example.org", roll="DUP-ROLL"), "roll_number")
        enrollment_detail = self.assert_conflict(
            self.payload(email="enrollment-new@example.org", roll="NEW-ROLL", enrollment="DUP-ENROLL"),
            "enrollment_number",
        )
        self.assertEqual(roll_detail["code"], "roll_number_already_used")
        self.assertEqual(enrollment_detail["code"], "enrollment_number_already_used")

    def test_same_roll_and_enrollment_are_allowed_in_a_different_college(self):
        with self.Session.begin() as db:
            db.add(Student(
                id=9541, college_id=952, student_code="ATX-2026-9502", name="Foreign",
                email="foreign-student@example.org", roll_number="SAME-ROLL",
                enrollment_number="SAME-ENROLL", is_active=True,
            ))
        with self.Session() as db:
            created = self.create(
                db,
                self.payload(email="local-student@example.org", roll="SAME-ROLL", enrollment="SAME-ENROLL"),
            )
        self.assertEqual(created["roll_number"], "SAME-ROLL")
        self.assertEqual(created["enrollment_number"], "SAME-ENROLL")
        with self.Session() as db:
            self.assertEqual(db.query(Student).filter_by(college_id=951, roll_number="SAME-ROLL").count(), 1)

    def test_student_code_collision_is_mapped_and_rolls_back_all_linked_records(self):
        with self.Session.begin() as db:
            db.add(Student(
                id=9551, college_id=951, student_code="ATX-2026-0001", name="Existing",
                email="existing-code@example.org", roll_number="OLD-1", is_active=True,
            ))
        payload = self.payload(email="code-collision@example.org", roll="NEW-CODE")
        with patch("app.api.tenant_students.next_student_code", return_value="ATX-2026-0001"):
            with self.Session() as db:
                with self.assertRaises(HTTPException) as raised:
                    self.create(db, payload)
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(raised.exception.detail["field"], "student_code")
        with self.Session() as db:
            self.assertIsNone(db.query(User).filter_by(email="code-collision@example.org").one_or_none())
            self.assertIsNone(db.query(Student).filter_by(email="code-collision@example.org").one_or_none())
            self.assertEqual(db.query(CollegeMembership).filter_by(user_id=9511, college_id=951).count(), 1)

    def test_repeated_submission_returns_conflict_without_creating_a_second_account(self):
        payload = self.payload(email="repeat-submit@example.org", roll="REPEAT-1")
        with self.Session() as db:
            created = self.create(db, payload)
        self.assertTrue(created["student_code"].startswith("ATX-"))
        detail = self.assert_conflict(payload, "email")
        self.assertEqual(detail["code"], "email_already_registered")
        with self.Session() as db:
            self.assertEqual(db.query(User).filter_by(email="repeat-submit@example.org").count(), 1)
            self.assertEqual(db.query(Student).filter_by(email="repeat-submit@example.org").count(), 1)
            self.assertEqual(db.query(CollegeMembership).join(User, CollegeMembership.user_id == User.id).filter(
                User.email == "repeat-submit@example.org", CollegeMembership.college_id == 951
            ).count(), 1)

    def test_unique_email_constraint_closes_the_race_after_duplicate_precheck(self):
        payload = self.payload(email="email-race@example.org", roll="EMAIL-RACE")

        def insert_competing_user(_mapper, connection, _target):
            connection.execute(User.__table__.insert().values(
                name="Concurrent synthetic account", email="email-race@example.org",
                hashed_password="synthetic-hash", role="student", is_active=True,
            ))

        event.listen(User, "before_insert", insert_competing_user)
        try:
            with self.Session() as db:
                with self.assertRaises(HTTPException) as raised:
                    self.create(db, payload)
        finally:
            event.remove(User, "before_insert", insert_competing_user)
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(raised.exception.detail["field"], "email")
        with self.Session() as db:
            self.assertEqual(db.query(User).filter_by(email="email-race@example.org").count(), 0)
            self.assertEqual(db.query(Student).filter_by(email="email-race@example.org").count(), 0)

    def test_college_scoped_unique_constraints_close_roll_and_enrollment_races(self):
        cases = (
            ("roll_number", "roll-race@example.org", "RACE-ROLL", None),
            ("enrollment_number", "enrollment-race@example.org", "OTHER-ROLL", "RACE-ENROLL"),
        )
        for field, email, roll, enrollment in cases:
            with self.subTest(field=field):
                payload = self.payload(email=email, roll=roll, enrollment=enrollment)

                def insert_competing_student(_mapper, connection, target):
                    values = {
                        "college_id": 951,
                        "student_code": f"ATX-2026-RACE-{field}",
                        "name": "Concurrent synthetic Student",
                        "email": f"competitor-{field}@example.org",
                        "roll_number": roll if field == "roll_number" else "COMPETITOR-ROLL",
                        "enrollment_number": enrollment if field == "enrollment_number" else None,
                        "is_active": True,
                    }
                    connection.execute(Student.__table__.insert().values(**values))

                event.listen(Student, "before_insert", insert_competing_student)
                try:
                    with self.Session() as db:
                        with self.assertRaises(HTTPException) as raised:
                            self.create(db, payload)
                finally:
                    event.remove(Student, "before_insert", insert_competing_student)
                self.assertEqual(raised.exception.status_code, 409)
                self.assertEqual(raised.exception.detail["field"], field)
                with self.Session() as db:
                    self.assertEqual(db.query(Student).filter_by(email=email).count(), 0)
                    self.assertEqual(db.query(User).filter_by(email=email).count(), 0)

    def test_failure_at_each_linked_insert_rolls_back_user_student_membership_and_history(self):
        failures = (
            (User, {}),
            (Student, {}),
            (CollegeMembership, {}),
            (StudentGuardian, {"father_name": "Synthetic parent"}),
            (StudentClassAssignment, {"initial_class_id": 9591}),
            (StudentAcademicHistory, {}),
        )
        for failed_model, extra_payload in failures:
            with self.subTest(model=failed_model.__name__):
                email = f"rollback-{failed_model.__name__.lower()}@example.org"

                def fail_insert(_mapper, _connection, _target):
                    raise SQLAlchemyError("synthetic persistence failure")

                event.listen(failed_model, "before_insert", fail_insert)
                try:
                    with self.Session() as db:
                        with self.assertRaises(HTTPException) as raised:
                            self.create(db, self.payload(email=email, roll=f"ROLL-{failed_model.__name__}", **extra_payload))
                    self.assertEqual(raised.exception.status_code, 503)
                finally:
                    event.remove(failed_model, "before_insert", fail_insert)

                with self.Session() as db:
                    self.assertIsNone(db.query(User).filter_by(email=email).one_or_none())
                    self.assertIsNone(db.query(Student).filter_by(email=email).one_or_none())
                    self.assertEqual(db.query(CollegeMembership).filter_by(college_id=951, role="student").count(), 0)

    def test_student_code_counter_reconciles_existing_codes_before_allocating(self):
        year = datetime.now(timezone.utc).year
        with self.Session.begin() as db:
            db.add_all([
                Student(
                    id=9561, college_id=951, student_code=f"ATX-{year}-0042", name="Imported",
                    email="imported-code@example.org", roll_number="IMPORTED", is_active=True,
                ),
                StudentIdCounter(year=year, last_number=4),
            ])
        with self.Session.begin() as db:
            self.assertEqual(next_student_code(db), f"ATX-{year}-0043")
            self.assertEqual(next_student_code(db), f"ATX-{year}-0044")

    def test_phone_is_not_a_duplicate_key_under_current_model_policy(self):
        with self.Session() as db:
            first = self.create(db, self.payload(email="phone-one@example.org", roll="PHONE-1", mobile="+1 (555) 123-4567"))
        with self.Session() as db:
            second = self.create(db, self.payload(email="phone-two@example.org", roll="PHONE-2", mobile="+1 (555) 123-4567"))
        self.assertNotEqual(first["id"], second["id"])


if __name__ == "__main__":
    unittest.main()
