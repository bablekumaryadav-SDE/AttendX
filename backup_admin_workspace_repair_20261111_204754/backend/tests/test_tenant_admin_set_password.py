"""Synthetic SQLite checks for College Admin-set permanent account passwords."""

import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.auth import login
from app.api.tenant_students import create_tenant_student, reset_tenant_student_password
from app.api.tenant_teachers import create_tenant_teacher, reset_tenant_teacher_password
from app.database import Base
from app.models import AttendanceAuditLog, College, CollegeMembership, Student, Teacher, User
from app.password_policy import is_password_policy_valid
from app.schemas.auth import LoginRequest
from app.schemas.tenant_registration import TenantPasswordReset, TenantStudentCreate, TenantTeacherCreate
from app.security import get_password_hash, verify_password


class TenantAdminSetPasswordTests(unittest.TestCase):
    STUDENT_PASSWORD = "SynthStudent!2026"
    TEACHER_PASSWORD = "SynthTeacher!2026"

    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.Session.begin() as db:
            db.add_all([
                College(id=9401, slug="admin-password-a", official_name="Password College", status="active"),
                User(id=94011, name="College Admin", email="password-admin@example.test", hashed_password=get_password_hash("SyntheticAdmin!2026"), role="admin", is_active=True),
                User(id=94012, name="Super Admin", email="password-super@example.org", hashed_password=get_password_hash("SyntheticSuper!2026"), role="super_admin", is_active=True),
                CollegeMembership(user_id=94011, college_id=9401, role="college_admin", status="active"),
            ])

    def tearDown(self):
        self.engine.dispose()

    def test_college_admin_student_creation_hashes_password_and_immediate_login_works(self):
        payload = TenantStudentCreate(
            name="Synthetic Student", email="password-student@example.org", roll_number="P-1",
            password=self.STUDENT_PASSWORD, password_confirmation=self.STUDENT_PASSWORD,
        )
        self.assertNotIn(self.STUDENT_PASSWORD, repr(payload))
        with self.Session() as db:
            result = create_tenant_student(payload, college_id=9401, db=db, current_user={"id": 94011})
            user = db.query(User).filter_by(email="password-student@example.org").one()
            student = db.query(Student).filter_by(email=user.email).one()
            membership = db.query(CollegeMembership).filter_by(user_id=user.id, college_id=9401).one()
            self.assertTrue(user.is_active)
            self.assertTrue(student.is_active)
            self.assertEqual(membership.status, "active")
            self.assertTrue(verify_password(self.STUDENT_PASSWORD, user.hashed_password))
            self.assertNotEqual(user.hashed_password, self.STUDENT_PASSWORD)
            self.assertEqual(result["account_activation"], "active")
            self.assertEqual(result["invitation_status"], "not_required")
            self.assertNotIn("hashed_password", result)
            self.assertEqual(login(LoginRequest(email=user.email, password=self.STUDENT_PASSWORD), db)["token_type"], "bearer")
            new_password = "ResetStudent!2026"
            reset_result = reset_tenant_student_password(1, TenantPasswordReset(password=new_password, password_confirmation=new_password), college_id=9401, db=db, current_user={"id": 94011})
            self.assertEqual(reset_result, {"id": 1, "password_reset": True})
            self.assertNotIn("hashed_password", reset_result)
            self.assertTrue(verify_password(new_password, user.hashed_password))
            self.assertEqual(db.query(AttendanceAuditLog).filter_by(action="college_admin_password_reset").count(), 1)
            audit = db.query(AttendanceAuditLog).filter_by(action="college_admin_password_reset").one()
            self.assertNotIn(new_password, str(audit.event_metadata))

    def test_college_admin_teacher_creation_hashes_password_and_immediate_login_works(self):
        payload = TenantTeacherCreate(
            name="Synthetic Teacher", email="password-teacher@example.org", employee_id="P-T-1",
            password=self.TEACHER_PASSWORD, password_confirmation=self.TEACHER_PASSWORD,
        )
        with self.Session() as db:
            result = create_tenant_teacher(payload, college_id=9401, db=db, current_user={"id": 94011})
            user = db.query(User).filter_by(email="password-teacher@example.org").one()
            teacher = db.query(Teacher).filter_by(email=user.email).one()
            membership = db.query(CollegeMembership).filter_by(user_id=user.id, college_id=9401).one()
            self.assertTrue(user.is_active)
            self.assertTrue(teacher.is_active)
            self.assertEqual(membership.status, "active")
            self.assertTrue(verify_password(self.TEACHER_PASSWORD, user.hashed_password))
            self.assertEqual(result["account_activation"], "active")
            self.assertNotIn("hashed_password", result)
            self.assertEqual(login(LoginRequest(email=user.email, password=self.TEACHER_PASSWORD), db)["token_type"], "bearer")
            new_password = "ResetTeacher!2026"
            reset_result = reset_tenant_teacher_password(teacher.id, TenantPasswordReset(password=new_password, password_confirmation=new_password), college_id=9401, db=db, current_user={"id": 94011})
            self.assertEqual(reset_result, {"id": teacher.id, "password_reset": True})
            self.assertNotIn("hashed_password", reset_result)
            self.assertTrue(verify_password(new_password, user.hashed_password))

    def test_password_policy_and_confirmation_are_enforced_without_revealing_password(self):
        for password in ("short", "NoDigitsOrSymbol", "NOLOWERCASE1!", "toolong" + "A1!" + ("x" * 70)):
            self.assertFalse(is_password_policy_valid(password))
        for model, values in (
            (TenantStudentCreate, {"name": "Synthetic Student", "email": "schema-student@example.test", "roll_number": "P-2"}),
            (TenantTeacherCreate, {"name": "Synthetic Teacher", "email": "schema-teacher@example.test", "employee_id": "P-T-2"}),
        ):
            with self.subTest(model=model.__name__):
                with self.assertRaises(Exception) as mismatch:
                    model(**values, password=self.STUDENT_PASSWORD, password_confirmation="Different!Synthetic2026")
                self.assertNotIn(self.STUDENT_PASSWORD, str(mismatch.exception))
                self.assertNotIn("Different!Synthetic2026", str(mismatch.exception))

        with self.assertRaises(Exception) as reset_mismatch:
            TenantPasswordReset(password=self.STUDENT_PASSWORD, password_confirmation="Different!Synthetic2026")
        self.assertNotIn(self.STUDENT_PASSWORD, str(reset_mismatch.exception))
        self.assertNotIn("Different!Synthetic2026", str(reset_mismatch.exception))

    def test_non_admin_cannot_create_and_existing_super_admin_login_is_unchanged(self):
        payload = TenantStudentCreate(
            name="Synthetic Student", email="forbidden-student@example.org", roll_number="P-3",
            password=self.STUDENT_PASSWORD, password_confirmation=self.STUDENT_PASSWORD,
        )
        with self.Session() as db:
            with self.assertRaises(HTTPException) as denied:
                create_tenant_student(payload, college_id=9401, db=db, current_user={"id": 94012})
            self.assertEqual(denied.exception.status_code, 403)
            super_login = login(LoginRequest(email="password-super@example.org", password="SyntheticSuper!2026"), db)
            self.assertEqual(super_login["token_type"], "bearer")

    def test_student_cannot_reset_another_account_and_foreign_college_target_is_hidden(self):
        with self.Session.begin() as db:
            db.add(User(id=94013, name="A Student", email="password-own-student@example.test", hashed_password=get_password_hash("SyntheticOwn!2026"), role="student", is_active=True))
            db.add(CollegeMembership(user_id=94013, college_id=9401, role="student", status="active"))
            db.add(College(id=9402, slug="admin-password-b", official_name="Other College", status="active"))
            db.add(User(id=94021, name="Other Student", email="password-other-student@example.test", hashed_password=get_password_hash("SyntheticOther!2026"), role="student", is_active=True))
            db.add(CollegeMembership(user_id=94021, college_id=9402, role="student", status="active"))
            db.flush()
            db.add(Student(id=94021, college_id=9402, student_code="ATX-9402", name="Other Student", email="password-other-student@example.test", roll_number="B-1", is_active=True))
        with self.Session() as db:
            reset = TenantPasswordReset(password="ChangedPassword!2026", password_confirmation="ChangedPassword!2026")
            with self.assertRaises(HTTPException) as unauthorized:
                reset_tenant_student_password(1, reset, college_id=9401, db=db, current_user={"id": 94013})
            self.assertEqual(unauthorized.exception.status_code, 403)
            with self.assertRaises(HTTPException) as foreign:
                reset_tenant_student_password(94021, reset, college_id=9401, db=db, current_user={"id": 94011})
            self.assertEqual(foreign.exception.status_code, 404)

    def test_teacher_password_reset_is_college_scoped_and_requires_college_admin(self):
        with self.Session.begin() as db:
            db.add(User(id=94031, name="College A Student", email="password-reset-student@example.test", hashed_password=get_password_hash("SyntheticStudent!2026"), role="student", is_active=True))
            db.add(CollegeMembership(user_id=94031, college_id=9401, role="student", status="active"))
            db.add(User(id=94033, name="College A Teacher", email="password-teacher-a@example.test", hashed_password=get_password_hash("SyntheticTeacherA!2026"), role="teacher", is_active=True))
            db.add(CollegeMembership(user_id=94033, college_id=9401, role="teacher", status="active"))
            db.add(Teacher(id=94033, college_id=9401, name="College A Teacher", email="password-teacher-a@example.test", employee_id="A-T-1", is_active=True))
            db.add(College(id=9403, slug="admin-password-c", official_name="Another Password College", status="active"))
            db.add(User(id=94032, name="College C Teacher", email="password-teacher-c@example.test", hashed_password=get_password_hash("SyntheticTeacher!2026"), role="teacher", is_active=True))
            db.add(CollegeMembership(user_id=94032, college_id=9403, role="teacher", status="active"))
            db.add(Teacher(id=94032, college_id=9403, name="College C Teacher", email="password-teacher-c@example.test", employee_id="C-T-1", is_active=True))

        replacement = "ReplacementTeacher!2026"
        payload = TenantPasswordReset(password=replacement, password_confirmation=replacement)
        with self.Session() as db:
            teacher = db.query(Teacher).filter_by(id=94033).one()
            old_hash = db.query(User).filter_by(email=teacher.email).one().hashed_password
            with self.assertRaises(HTTPException) as unauthorized:
                reset_tenant_teacher_password(teacher.id, payload, college_id=9401, db=db, current_user={"id": 94031})
            self.assertEqual(unauthorized.exception.status_code, 403)
            self.assertEqual(db.query(User).filter_by(email=teacher.email).one().hashed_password, old_hash)

            with self.assertRaises(HTTPException) as foreign:
                reset_tenant_teacher_password(94032, payload, college_id=9401, db=db, current_user={"id": 94011})
            self.assertEqual(foreign.exception.status_code, 404)
            self.assertTrue(verify_password("SyntheticTeacher!2026", db.query(User).filter_by(email="password-teacher-c@example.test").one().hashed_password))


if __name__ == "__main__":
    unittest.main()
