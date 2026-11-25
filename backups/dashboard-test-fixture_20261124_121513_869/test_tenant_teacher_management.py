"""Tenant Teacher profile and assignment operations on synthetic SQLite only."""

import unittest

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.tenant_teachers import (
    assign_tenant_teacher,
    deactivate_tenant_teacher,
    deactivate_tenant_teacher_assignment,
    list_tenant_teacher_assignments,
    read_tenant_teacher_management_profile,
    update_tenant_teacher,
)
from app.database import Base
from app.models import (
    AttendanceAuditLog,
    Class,
    College,
    CollegeMembership,
    Subject,
    Teacher,
    TeacherAssignment,
    User,
)
from app.schemas.tenant_registration import TenantTeacherAssignmentInput
from app.schemas.tenant_teacher import TenantTeacherUpdate
from app.security import get_password_hash
from app.tenant_relationship_history import as_utc_datetime


class TenantTeacherManagementTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.Session.begin() as db:
            db.add_all([
                College(id=9501, slug="teacher-management-a", official_name="Teacher College A", status="active"),
                College(id=9502, slug="teacher-management-b", official_name="Teacher College B", status="active"),
                User(id=95011, name="Admin A", email="teacher-admin-a@example.org", hashed_password=get_password_hash("AdminA!Synthetic2026"), role="admin", is_active=True),
                User(id=95012, name="Admin B", email="teacher-admin-b@example.org", hashed_password=get_password_hash("AdminB!Synthetic2026"), role="admin", is_active=True),
                User(id=95021, name="Teacher A", email="teacher-a@example.org", hashed_password=get_password_hash("TeacherA!Synthetic2026"), role="teacher", is_active=True),
                User(id=95022, name="Teacher B", email="teacher-b@example.org", hashed_password=get_password_hash("TeacherB!Synthetic2026"), role="teacher", is_active=True),
                CollegeMembership(user_id=95011, college_id=9501, role="college_admin", status="active"),
                CollegeMembership(user_id=95012, college_id=9502, role="college_admin", status="active"),
                CollegeMembership(user_id=95021, college_id=9501, role="teacher", status="active"),
                CollegeMembership(user_id=95022, college_id=9502, role="teacher", status="active"),
                Class(id=9501, college_id=9501, name="A Class", is_active=True),
                Class(id=9502, college_id=9502, name="B Class", is_active=True),
                Subject(id=9501, college_id=9501, name="A Subject", code="A-9501", is_active=True),
                Subject(id=9502, college_id=9502, name="B Subject", code="B-9502", is_active=True),
                Teacher(id=9501, college_id=9501, name="Teacher A", email="teacher-a@example.org", employee_id="TA-1", is_active=True),
                Teacher(id=9503, college_id=9501, name="Teacher A2", email="teacher-a2@example.org", employee_id="TA-2", is_active=True),
                Teacher(id=9502, college_id=9502, name="Teacher B", email="teacher-b@example.org", employee_id="TB-1", is_active=True),
            ])

    def tearDown(self):
        self.engine.dispose()

    def test_admin_manages_only_same_college_teacher_profiles(self):
        with self.Session() as db:
            profile = read_tenant_teacher_management_profile(9501, 9501, db, {"id": 95011})
            self.assertEqual(profile.email, "teacher-a@example.org")
            self.assertEqual(profile.employee_id, "TA-1")
            updated = update_tenant_teacher(9501, TenantTeacherUpdate(name="Teacher A Updated", designation="Lecturer"), 9501, db, {"id": 95011})
            self.assertEqual(updated.name, "Teacher A Updated")
            with self.assertRaises(HTTPException) as foreign:
                update_tenant_teacher(9502, TenantTeacherUpdate(name="Should Not Change"), 9501, db, {"id": 95011})
            self.assertEqual(foreign.exception.status_code, 404)
            with self.assertRaises(ValidationError):
                TenantTeacherUpdate(employee_id="TA-2")
            with self.assertRaises(HTTPException) as forbidden:
                update_tenant_teacher(9501, TenantTeacherUpdate(name="No"), 9501, db, {"id": 95021})
            self.assertEqual(forbidden.exception.status_code, 403)

    def test_assignment_creation_validates_parents_prevents_duplicates_and_preserves_history(self):
        payload = TenantTeacherAssignmentInput(class_id=9501, subject_id=9501, academic_year="2026-2027", semester=1)
        with self.Session() as db:
            created = assign_tenant_teacher(9501, payload, 9501, db, {"id": 95011})
            self.assertEqual(created.college_id, 9501)
            with self.assertRaises(HTTPException) as duplicate:
                assign_tenant_teacher(9501, payload, 9501, db, {"id": 95011})
            self.assertEqual(duplicate.exception.status_code, 409)
            with self.assertRaises(HTTPException) as cross_college:
                assign_tenant_teacher(9501, TenantTeacherAssignmentInput(class_id=9502, subject_id=9502, academic_year="2026-2027", semester=1), 9501, db, {"id": 95011})
            self.assertEqual(cross_college.exception.status_code, 404)
            with self.assertRaises(HTTPException) as unauthorized:
                assign_tenant_teacher(9501, payload, 9501, db, {"id": 95021})
            self.assertEqual(unauthorized.exception.status_code, 403)

            own_rows = list_tenant_teacher_assignments(9501, 9501, db, {"id": 95021})
            self.assertEqual([row["id"] for row in own_rows], [created.id])
            with self.assertRaises(HTTPException) as other_teacher:
                list_tenant_teacher_assignments(9502, 9502, db, {"id": 95021})
            self.assertEqual(other_teacher.exception.status_code, 403)

            ended = deactivate_tenant_teacher_assignment(9501, created.id, 9501, db, {"id": 95011})
            self.assertFalse(ended.is_active)
            self.assertEqual(db.query(TeacherAssignment).filter_by(id=created.id).count(), 1)

    def test_teacher_reassignment_closes_prior_current_interval_without_backdating(self):
        with self.Session.begin() as db:
            prior = TeacherAssignment(
                id=9550, college_id=9501, teacher_id=9501, class_id=9501,
                subject_id=9501, academic_year="2026-2027", semester=1,
                is_active=True,
            )
            db.add(prior)
        with self.Session() as db:
            created = assign_tenant_teacher(
                9503,
                TenantTeacherAssignmentInput(
                    class_id=9501, subject_id=9501,
                    academic_year="2026-2027", semester=1,
                ),
                9501, db, {"id": 95011},
            )
            old = db.query(TeacherAssignment).filter_by(id=9550).one()
            self.assertFalse(old.is_active)
            self.assertIsNotNone(old.effective_to)
            self.assertEqual(created.teacher_id, 9503)
            self.assertEqual(as_utc_datetime(created.effective_from), as_utc_datetime(old.effective_to))

    def test_teacher_deactivation_revokes_only_selected_membership_and_audits(self):
        with self.Session.begin() as db:
            db.add(TeacherAssignment(college_id=9501, teacher_id=9501, class_id=9501, subject_id=9501, academic_year="2026-2027", semester=1, is_active=True))
        with self.Session() as db:
            result = deactivate_tenant_teacher(9501, 9501, db, {"id": 95011})
            self.assertEqual(result["membership_status"], "revoked")
            teacher = db.query(Teacher).filter_by(id=9501).one()
            user = db.query(User).filter_by(id=95021).one()
            membership = db.query(CollegeMembership).filter_by(user_id=95021, college_id=9501).one()
            assignment = db.query(TeacherAssignment).filter_by(teacher_id=9501).one()
            self.assertFalse(teacher.is_active)
            self.assertFalse(user.is_active)
            self.assertEqual(membership.status, "revoked")
            self.assertFalse(assignment.is_active)
            self.assertEqual(db.query(AttendanceAuditLog).filter_by(action="teacher_deactivated", college_id=9501).count(), 1)

            with self.assertRaises(HTTPException) as foreign:
                deactivate_tenant_teacher(9501, 9502, db, {"id": 95012})
            self.assertEqual(foreign.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
