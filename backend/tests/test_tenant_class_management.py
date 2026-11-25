"""Direct-handler tests for tenant-scoped Class management on synthetic SQLite."""

import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.tenant_classes import (
    create_tenant_class,
    deactivate_tenant_class,
    read_tenant_class,
    update_tenant_class,
)
from app.database import Base
from app.models import Class, College, CollegeMembership, User
from app.schemas.class_ import ClassCreate, ClassUpdate


class TenantClassManagementTests(unittest.TestCase):
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
                College(id=301, slug="class-a", official_name="Class College A", status="active"),
                College(id=302, slug="class-b", official_name="Class College B", status="active"),
                User(id=3011, name="A Admin", email="a-admin@example.test", hashed_password="synthetic", role="admin", is_active=True),
                User(id=3021, name="B Admin", email="b-admin@example.test", hashed_password="synthetic", role="admin", is_active=True),
                User(id=3031, name="A Teacher", email="a-teacher@example.test", hashed_password="synthetic", role="teacher", is_active=True),
            ])
            db.add_all([
                CollegeMembership(user_id=3011, college_id=301, role="college_admin", status="active"),
                CollegeMembership(user_id=3021, college_id=302, role="college_admin", status="active"),
                CollegeMembership(user_id=3031, college_id=301, role="teacher", status="active"),
            ])
            db.add_all([
                Class(id=30101, college_id=301, name="A Existing", is_active=True, radius_m=100),
                Class(id=30201, college_id=302, name="B Existing", is_active=True, radius_m=100),
            ])

    def tearDown(self):
        with self.Session.begin() as db:
            db.query(Class).delete(synchronize_session=False)
            db.query(CollegeMembership).delete(synchronize_session=False)
            db.query(User).delete(synchronize_session=False)
            db.query(College).delete(synchronize_session=False)

    def test_college_admin_create_binds_server_context_and_update_and_deactivate_are_scoped(self):
        with self.Session() as db:
            created = create_tenant_class(
                ClassCreate(name="A New Class", section="A"),
                college_id=301,
                db=db,
                current_user={"id": 3011},
            )
            self.assertEqual(created.college_id, 301)
            updated = update_tenant_class(
                created.id,
                ClassUpdate(name="A Updated"),
                college_id=301,
                db=db,
                current_user={"id": 3011},
            )
            self.assertEqual(updated.name, "A Updated")
            inactive = deactivate_tenant_class(
                created.id,
                college_id=301,
                db=db,
                current_user={"id": 3011},
            )
            self.assertFalse(inactive.is_active)
            self.assertIsNotNone(db.query(Class).filter(Class.id == created.id).one_or_none())

    def test_foreign_college_class_is_not_disclosed_to_other_admin(self):
        with self.Session() as db:
            with self.assertRaises(HTTPException) as raised:
                update_tenant_class(
                    30201,
                    ClassUpdate(name="Attempted Change"),
                    college_id=301,
                    db=db,
                    current_user={"id": 3011},
                )
            self.assertEqual(raised.exception.status_code, 404)
            with self.assertRaises(HTTPException) as read_error:
                read_tenant_class(30201, college_id=301, db=db, current_user={"id": 3011})
            self.assertEqual(read_error.exception.status_code, 404)

    def test_non_admin_membership_cannot_create_and_payload_cannot_set_college(self):
        with self.Session() as db:
            with self.assertRaises(HTTPException) as raised:
                create_tenant_class(
                    ClassCreate(name="Teacher Attempt"),
                    college_id=301,
                    db=db,
                    current_user={"id": 3031},
                )
            self.assertEqual(raised.exception.status_code, 403)
        with self.assertRaises(ValueError):
            ClassCreate.model_validate({"name": "Forged Tenant", "college_id": 301})

    def test_location_coordinates_must_remain_a_valid_pair(self):
        with self.Session() as db:
            with self.assertRaises(HTTPException) as raised:
                update_tenant_class(
                    30101,
                    ClassUpdate(latitude=12.5),
                    college_id=301,
                    db=db,
                    current_user={"id": 3011},
                )
            self.assertEqual(raised.exception.status_code, 422)


if __name__ == "__main__":
    unittest.main()
