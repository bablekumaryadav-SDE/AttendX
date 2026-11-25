"""Direct tenant Subject management tests on synthetic SQLite only."""

import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.tenant_subjects import (
    create_tenant_subject,
    deactivate_tenant_subject,
    update_tenant_subject,
)
from app.database import Base
from app.models import College, CollegeMembership, Subject, User
from app.schemas.subject import SubjectCreate, SubjectUpdate


class TenantSubjectManagementTests(unittest.TestCase):
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
                College(id=701, slug="subject-write-a", official_name="Subject Write A", status="active"),
                College(id=702, slug="subject-write-b", official_name="Subject Write B", status="active"),
                User(id=7011, name="A Admin", email="subject-write-a@example.test", hashed_password="synthetic", role="admin", is_active=True),
                User(id=7021, name="B Admin", email="subject-write-b@example.test", hashed_password="synthetic", role="admin", is_active=True),
                User(id=7031, name="A Teacher", email="subject-write-teacher@example.test", hashed_password="synthetic", role="teacher", is_active=True),
            ])
            db.add_all([
                CollegeMembership(user_id=7011, college_id=701, role="college_admin", status="active"),
                CollegeMembership(user_id=7021, college_id=702, role="college_admin", status="active"),
                CollegeMembership(user_id=7031, college_id=701, role="teacher", status="active"),
                Subject(id=7101, college_id=701, name="A Algebra", code="ALG", is_active=True),
                Subject(id=7201, college_id=702, name="B Algebra", code="ALG", is_active=True),
            ])

    def tearDown(self):
        with self.Session.begin() as db:
            db.query(Subject).delete(synchronize_session=False)
            db.query(CollegeMembership).delete(synchronize_session=False)
            db.query(User).delete(synchronize_session=False)
            db.query(College).delete(synchronize_session=False)

    def test_admin_create_binds_context_scopes_code_and_update_deactivates(self):
        with self.Session() as db:
            created = create_tenant_subject(
                SubjectCreate(name="A Physics", code="PHY"),
                college_id=701,
                db=db,
                current_user={"id": 7011},
            )
            self.assertEqual(created.college_id, 701)
            with self.assertRaises(HTTPException) as duplicate:
                create_tenant_subject(
                    SubjectCreate(name="Another Algebra", code="ALG"),
                    college_id=701,
                    db=db,
                    current_user={"id": 7011},
                )
            self.assertEqual(duplicate.exception.status_code, 409)

            updated = update_tenant_subject(
                created.id,
                SubjectUpdate(name="A Physics 2"),
                college_id=701,
                db=db,
                current_user={"id": 7011},
            )
            self.assertEqual(updated.name, "A Physics 2")
            inactive = deactivate_tenant_subject(
                created.id,
                college_id=701,
                db=db,
                current_user={"id": 7011},
            )
            self.assertFalse(inactive.is_active)
            self.assertIsNotNone(db.query(Subject).filter(Subject.id == created.id).one_or_none())

    def test_non_admin_and_foreign_subject_write_are_denied_without_disclosure(self):
        with self.Session() as db:
            with self.assertRaises(HTTPException) as denied:
                create_tenant_subject(
                    SubjectCreate(name="Teacher Attempt", code="T"),
                    college_id=701,
                    db=db,
                    current_user={"id": 7031},
                )
            self.assertEqual(denied.exception.status_code, 403)
            with self.assertRaises(HTTPException) as foreign:
                update_tenant_subject(
                    7201,
                    SubjectUpdate(name="Injected"),
                    college_id=701,
                    db=db,
                    current_user={"id": 7011},
                )
            self.assertEqual(foreign.exception.status_code, 404)

    def test_client_cannot_supply_college_id_and_empty_patch_is_invalid(self):
        with self.assertRaises(ValueError):
            SubjectCreate.model_validate({"name": "Forged", "code": "FG", "college_id": 701})
        with self.assertRaises(ValueError):
            SubjectUpdate.model_validate({})


if __name__ == "__main__":
    unittest.main()
