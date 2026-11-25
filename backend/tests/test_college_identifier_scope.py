"""Synthetic SQLite checks for College-local academic identifiers."""

import unittest

from sqlalchemy.exc import IntegrityError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.tenant_students import _student_identity_conflict
from app.api.tenant_teachers import _teacher_identity_conflict
from app.database import Base
from app.models import College, Student, Subject, Teacher


class CollegeIdentifierScopeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine("sqlite://")
        Base.metadata.create_all(cls.engine)
        cls.Session = sessionmaker(bind=cls.engine, expire_on_commit=False)

    @classmethod
    def tearDownClass(cls):
        cls.engine.dispose()

    def setUp(self):
        with self.Session.begin() as db:
            db.add_all([
                College(id=101, slug="north-test", official_name="North Test", status="active"),
                College(id=102, slug="south-test", official_name="South Test", status="active"),
                College(id=103, slug="west-test", official_name="West Test", status="active"),
            ])

    def tearDown(self):
        with self.Session.begin() as db:
            for model in (Subject, Teacher, Student, College):
                db.query(model).delete(synchronize_session=False)

    def test_student_roll_number_is_scoped_but_login_email_remains_global(self):
        with self.Session.begin() as db:
            db.add_all([
                Student(id=1011, college_id=101, student_code="N-1011", name="North Student", email="north@example.test", roll_number="001"),
                Student(id=1021, college_id=102, student_code="S-1021", name="South Student", email="south@example.test", roll_number="001"),
            ])
        with self.Session() as db:
            self.assertFalse(_student_identity_conflict(db, 103, "new@example.test", "001"))
            self.assertTrue(_student_identity_conflict(db, 101, "new@example.test", "001"))
            self.assertTrue(_student_identity_conflict(db, 103, "north@example.test", "new-roll"))

    def test_teacher_employee_id_is_scoped_but_login_email_remains_global(self):
        with self.Session.begin() as db:
            db.add_all([
                Teacher(id=1011, college_id=101, name="North Teacher", email="north-teacher@example.test", employee_id="T-01"),
                Teacher(id=1021, college_id=102, name="South Teacher", email="south-teacher@example.test", employee_id="T-01"),
            ])
        with self.Session() as db:
            self.assertFalse(_teacher_identity_conflict(db, 103, "new@example.test", "T-01"))
            self.assertTrue(_teacher_identity_conflict(db, 101, "new@example.test", "T-01"))
            self.assertTrue(_teacher_identity_conflict(db, 103, "north-teacher@example.test", "new-id"))

    def test_subject_code_is_scoped_and_unknown_legacy_code_remains_globally_unique(self):
        with self.Session.begin() as db:
            db.add_all([
                Subject(id=1011, college_id=101, name="Mathematics", code="MATH-1"),
                Subject(id=1021, college_id=102, name="Mathematics", code="MATH-1"),
                Subject(id=1099, college_id=None, name="Legacy Subject", code="LEGACY-1"),
            ])

        with self.Session() as db:
            self.assertEqual(db.query(Subject).filter(Subject.code == "MATH-1").count(), 2)
            db.add(Subject(name="Duplicate Legacy", code="LEGACY-1"))
            with self.assertRaises(IntegrityError):
                db.flush()
