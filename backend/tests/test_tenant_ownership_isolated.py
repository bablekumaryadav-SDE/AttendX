"""Synthetic SQLite tests for the tenant ownership foundation, not PostgreSQL."""

import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    Attendance,
    AttendanceAuditLog,
    AttendanceEvent,
    AttendanceRecord,
    AttendanceSession,
    Class,
    College,
    NotificationEvent,
    Student,
    StudentClassAssignment,
    StudentGuardian,
    Subject,
    Teacher,
    TeacherAssignment,
)
from app.tenant_context import TenantContext
from app.tenant_ownership import (
    bind_new_record_to_context,
    reject_college_payload,
    require_same_college,
    resolve_college_record,
)


TENANT_DIRECT_MODELS = (
    Student,
    Teacher,
    Class,
    Subject,
    TeacherAssignment,
    StudentClassAssignment,
    Attendance,
    AttendanceRecord,
    AttendanceSession,
    AttendanceEvent,
    AttendanceAuditLog,
    NotificationEvent,
)


class TenantOwnershipTests(unittest.TestCase):
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
        self.context_a = TenantContext(user_id=1, college_id=101, membership_id=1, membership_role="college_admin")
        self.context_b = TenantContext(user_id=2, college_id=202, membership_id=2, membership_role="college_admin")
        with self.Session.begin() as db:
            db.add_all([
                College(id=101, slug="tenant-a", official_name="Tenant A", status="active"),
                College(id=202, slug="tenant-b", official_name="Tenant B", status="active"),
            ])
            db.flush()
            db.add_all([
                Student(id=11, college_id=101, name="A Student", email="a@example.test", roll_number="A-1"),
                Student(id=22, college_id=202, name="B Student", email="b@example.test", roll_number="B-1"),
                Student(id=33, college_id=None, name="Unknown Student", email="unknown@example.test", roll_number="U-1"),
                Teacher(id=41, college_id=101, name="A Teacher", email="ta@example.test", employee_id="TA-1"),
                Teacher(id=42, college_id=202, name="B Teacher", email="tb@example.test", employee_id="TB-1"),
                Subject(id=51, college_id=101, name="A Subject", code="AS-1"),
                Subject(id=52, college_id=202, name="B Subject", code="BS-1"),
                Class(id=61, college_id=101, name="A Class"),
                Class(id=62, college_id=202, name="B Class"),
            ])

    def tearDown(self):
        self.engine.dispose()

    def test_direct_college_ownership_is_nullable_only_for_unknown_legacy_rows(self):
        for model in TENANT_DIRECT_MODELS:
            with self.subTest(model=model.__name__):
                column = model.__table__.c.college_id
                self.assertTrue(column.nullable)
                self.assertTrue(column.foreign_keys)
                targets = {fk.target_fullname for fk in column.foreign_keys}
                self.assertIn("colleges.id", targets)
        # Dependent/sensitive entities derive ownership from their sole parent.
        self.assertNotIn("college_id", StudentGuardian.__table__.columns)

    def test_resolver_scopes_records_and_hides_foreign_or_unknown_rows(self):
        with self.Session() as db:
            self.assertEqual(resolve_college_record(db, Student, 11, self.context_a).name, "A Student")
            for record_id in (22, 33, 999):
                with self.subTest(record_id=record_id), self.assertRaises(HTTPException) as caught:
                    resolve_college_record(db, Student, record_id, self.context_a)
                self.assertEqual(caught.exception.status_code, 404)
                self.assertEqual(caught.exception.detail, "Record not found.")

    def test_resolver_fails_closed_when_tenant_column_is_not_deployed(self):
        legacy_engine = create_engine("sqlite://")
        with legacy_engine.begin() as connection:
            connection.execute(text("CREATE TABLE students (id INTEGER PRIMARY KEY)"))
        LegacySession = sessionmaker(bind=legacy_engine)
        try:
            with LegacySession() as db, self.assertRaises(HTTPException) as caught:
                resolve_college_record(db, Student, 11, self.context_a)
            self.assertEqual(caught.exception.status_code, 503)
            self.assertEqual(caught.exception.detail, "College-owned data is unavailable.")
        finally:
            legacy_engine.dispose()

    def test_parent_child_college_mismatch_is_rejected(self):
        with self.Session() as db:
            student_a = db.get(Student, 11)
            class_b = db.get(Class, 62)
            with self.assertRaises(HTTPException) as caught:
                require_same_college(self.context_a, student_a, class_b)
            self.assertEqual(caught.exception.status_code, 404)

    def test_composite_foreign_keys_reject_cross_college_assignment(self):
        invalid_parent_pairs = (
            (52, 61),  # College B Subject with College A assignment.
            (51, 62),  # College A Subject with College B Class.
        )
        for subject_id, class_id in invalid_parent_pairs:
            with self.subTest(subject_id=subject_id, class_id=class_id):
                with self.assertRaises(IntegrityError):
                    with self.Session.begin() as db:
                        db.add(TeacherAssignment(
                            college_id=101,
                            teacher_id=41,
                            subject_id=subject_id,
                            class_id=class_id,
                            is_active=True,
                        ))

    def test_missing_or_null_ownership_never_passes_same_college_check(self):
        with self.Session() as db:
            unknown = db.get(Student, 33)
            with self.assertRaises(HTTPException):
                require_same_college(self.context_a, unknown)
            with self.assertRaises(HTTPException):
                require_same_college(self.context_a, None)

    def test_payload_cannot_select_or_change_college(self):
        for payload in ({"name": "value", "college_id": 101}, {"college_id": 202}):
            with self.subTest(payload=payload), self.assertRaises(HTTPException) as caught:
                reject_college_payload(payload)
            self.assertEqual(caught.exception.status_code, 422)

    def test_new_record_binds_to_server_context_only(self):
        record = Student(name="New Student", email="new@example.test", roll_number="N-1")
        self.assertIsNone(record.id)
        bind_new_record_to_context(record, self.context_a, payload={"name": "New Student"})
        self.assertEqual(record.college_id, 101)
        with self.assertRaises(HTTPException):
            bind_new_record_to_context(
                Student(name="Rejected", email="r@example.test", roll_number="R-1"),
                self.context_a,
                payload={"college_id": 202},
            )


if __name__ == "__main__":
    unittest.main()
