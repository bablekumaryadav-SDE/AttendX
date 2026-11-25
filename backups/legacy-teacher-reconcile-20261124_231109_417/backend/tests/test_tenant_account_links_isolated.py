"""Isolated account-link route tests; SQLite data is in-memory and synthetic."""

import os
import unittest

os.environ["ATTENDX_SKIP_DOTENV"] = "1"
os.environ["ATTENDX_TEST_SQLALCHEMY_URL"] = "sqlite://"
os.environ["SECRET_KEY"] = "synthetic-unit-test-signing-key-never-use-outside-tests"

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from app import models  # noqa: F401
from app.api.tenant_account_links import (
    create_student_account_link,
    create_teacher_account_link,
    list_student_account_link_candidates,
    list_teacher_account_link_candidates,
    read_teacher_account_link,
    revoke_student_account_link,
)
from app.api.tenant_teachers import list_tenant_teacher_assignments
from app.database import Base
from app.models import College, CollegeMembership, Student, StudentAccountLink, Teacher, TeacherAccountLink, User
from app.schemas.tenant_account_links import TenantAccountLinkCreate, TenantAccountLinkRevoke


class TenantAccountLinkTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")

        @event.listens_for(self.engine, "connect")
        def enable_sqlite_foreign_keys(connection, _record):
            cursor = connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.college = College(slug="alpha-college", official_name="Alpha College", status="active")
        self.other_college = College(slug="beta-college", official_name="Beta College", status="active")
        self.admin = User(name="Admin", email="admin@example.invalid", hashed_password="synthetic", role="admin", is_active=True)
        self.student_user = User(name="Student", email="student@example.invalid", hashed_password="synthetic", role="student", is_active=True)
        self.teacher_user = User(name="Teacher", email="teacher@example.invalid", hashed_password="synthetic", role="teacher", is_active=True)
        self.other_user = User(name="Other", email="other@example.invalid", hashed_password="synthetic", role="student", is_active=True)
        self.db.add_all([self.college, self.other_college, self.admin, self.student_user, self.teacher_user, self.other_user])
        self.db.flush()
        self.db.add_all([
            CollegeMembership(user_id=self.admin.id, college_id=self.college.id, role="college_admin", status="active"),
            CollegeMembership(user_id=self.student_user.id, college_id=self.college.id, role="student", status="active"),
            CollegeMembership(user_id=self.teacher_user.id, college_id=self.college.id, role="teacher", status="active"),
            CollegeMembership(user_id=self.other_user.id, college_id=self.other_college.id, role="student", status="active"),
        ])
        self.student = Student(
            college_id=self.college.id, name="Student", email="profile-student@example.invalid",
            roll_number="A-1", is_active=True,
        )
        self.teacher = Teacher(
            college_id=self.college.id, name="Teacher", email="profile-teacher@example.invalid",
            employee_id="T-1", is_active=True,
        )
        self.foreign_student = Student(
            college_id=self.other_college.id, name="Foreign", email="foreign@example.invalid",
            roll_number="B-1", is_active=True,
        )
        self.db.add_all([self.student, self.teacher, self.foreign_student])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    @property
    def principal(self):
        return {"id": self.admin.id}

    def create_body(self, user_id):
        return TenantAccountLinkCreate(user_id=user_id, identity_verified=True)

    def test_admin_can_explicitly_bind_same_college_student_and_teacher(self):
        student_link = create_student_account_link(
            self.student.id, self.create_body(self.student_user.id), self.college.id, self.db, self.principal
        )
        teacher_link = create_teacher_account_link(
            self.teacher.id, self.create_body(self.teacher_user.id), self.college.id, self.db, self.principal
        )
        self.assertEqual((student_link.profile_id, student_link.user_id, student_link.link_status),
                         (self.student.id, self.student_user.id, "active"))
        self.assertEqual((teacher_link.profile_id, teacher_link.user_id, teacher_link.link_status),
                         (self.teacher.id, self.teacher_user.id, "active"))

    def test_cross_college_profile_and_membership_selection_are_denied(self):
        with self.assertRaises(HTTPException) as foreign_profile:
            create_student_account_link(
                self.foreign_student.id, self.create_body(self.other_user.id), self.college.id, self.db, self.principal
            )
        self.assertEqual(foreign_profile.exception.status_code, 404)
        with self.assertRaises(HTTPException) as foreign_membership:
            create_student_account_link(
                self.student.id, self.create_body(self.other_user.id), self.college.id, self.db, self.principal
            )
        self.assertEqual(foreign_membership.exception.status_code, 403)

    def test_role_mismatch_and_self_binding_are_denied(self):
        with self.assertRaises(HTTPException) as mismatch:
            create_teacher_account_link(
                self.teacher.id, self.create_body(self.student_user.id), self.college.id, self.db, self.principal
            )
        self.assertEqual(mismatch.exception.status_code, 403)
        with self.assertRaises(HTTPException) as self_link:
            create_student_account_link(
                self.student.id, self.create_body(self.admin.id), self.college.id, self.db, self.principal
            )
        self.assertEqual(self_link.exception.status_code, 409)

    def test_account_global_role_must_match_membership_role_for_linking(self):
        mismatched_user = User(
            name="Role mismatch", email="role-mismatch@example.invalid",
            hashed_password="synthetic", role="student", is_active=True,
        )
        self.db.add(mismatched_user)
        self.db.flush()
        self.db.add(CollegeMembership(
            user_id=mismatched_user.id, college_id=self.college.id,
            role="teacher", status="active",
        ))
        self.db.commit()

        candidates = list_teacher_account_link_candidates(
            search="role-mismatch@example.invalid", limit=25,
            college_id=self.college.id, db=self.db, current_user=self.principal,
        )
        self.assertEqual(candidates, [])
        with self.assertRaises(HTTPException) as rejected:
            create_teacher_account_link(
                self.teacher.id, self.create_body(mismatched_user.id),
                self.college.id, self.db, self.principal,
            )
        self.assertEqual(rejected.exception.status_code, 403)
        self.assertEqual(self.db.query(TeacherAccountLink).count(), 0)

    def test_duplicate_active_link_is_rejected_and_revoke_is_audited(self):
        created = create_student_account_link(
            self.student.id, self.create_body(self.student_user.id), self.college.id, self.db, self.principal
        )
        with self.assertRaises(HTTPException) as duplicate:
            create_student_account_link(
                self.student.id, self.create_body(self.student_user.id), self.college.id, self.db, self.principal
            )
        self.assertEqual(duplicate.exception.status_code, 409)
        revoked = revoke_student_account_link(
            created.id, TenantAccountLinkRevoke(reason="identity association corrected"),
            self.college.id, self.db, self.principal,
        )
        self.assertEqual(revoked.link_status, "revoked")
        self.assertEqual(revoked.revoked_by_user_id, self.admin.id)
        self.assertEqual(revoked.revocation_reason, "identity association corrected")
        stored = self.db.query(StudentAccountLink).filter(StudentAccountLink.id == created.id).one()
        self.assertIsNotNone(stored.revoked_at)

    def test_identity_attestation_must_be_explicit(self):
        with self.assertRaises(ValidationError):
            TenantAccountLinkCreate(user_id=self.student_user.id, identity_verified=False)

    def test_teacher_link_candidates_are_active_role_and_college_scoped_and_never_link_automatically(self):
        rows = list_teacher_account_link_candidates(
            search="teacher@example.invalid", limit=25, college_id=self.college.id,
            db=self.db, current_user=self.principal,
        )
        self.assertEqual([(row.user_id, row.college_id, row.membership_status) for row in rows], [
            (self.teacher_user.id, self.college.id, "active"),
        ])
        self.assertFalse(self.db.query(TeacherAccountLink).count())

        create_teacher_account_link(
            self.teacher.id, self.create_body(self.teacher_user.id), self.college.id,
            self.db, self.principal,
        )
        self.assertEqual(list_teacher_account_link_candidates(
            search="teacher@example.invalid", limit=25, college_id=self.college.id,
            db=self.db, current_user=self.principal,
        ), [])

    def test_teacher_link_candidate_search_rejects_non_admin_and_excludes_inactive_accounts(self):
        teacher_membership = self.db.query(CollegeMembership).filter_by(
            user_id=self.teacher_user.id, college_id=self.college.id,
        ).one()
        teacher_membership.status = "suspended"
        self.db.commit()
        rows = list_teacher_account_link_candidates(
            search="teacher@example.invalid", limit=25, college_id=self.college.id,
            db=self.db, current_user=self.principal,
        )
        self.assertEqual(rows, [])
        with self.assertRaises(HTTPException) as denied:
            list_teacher_account_link_candidates(
                search="teacher@example.invalid", limit=25, college_id=self.college.id,
                db=self.db, current_user={"id": self.teacher_user.id},
            )
        self.assertEqual(denied.exception.status_code, 403)

    def test_student_link_candidates_are_active_role_and_college_scoped_and_never_link_automatically(self):
        rows = list_student_account_link_candidates(
            search="student@example.invalid", limit=25, college_id=self.college.id,
            db=self.db, current_user=self.principal,
        )
        self.assertEqual([(row.user_id, row.college_id, row.membership_status) for row in rows], [
            (self.student_user.id, self.college.id, "active"),
        ])
        self.assertFalse(self.db.query(StudentAccountLink).count())

        create_student_account_link(
            self.student.id, self.create_body(self.student_user.id), self.college.id,
            self.db, self.principal,
        )
        self.assertEqual(list_student_account_link_candidates(
            search="student@example.invalid", limit=25, college_id=self.college.id,
            db=self.db, current_user=self.principal,
        ), [])

        with self.assertRaises(HTTPException) as denied:
            list_student_account_link_candidates(
                search="other@example.invalid", limit=25, college_id=self.other_college.id,
                db=self.db, current_user=self.principal,
            )
        self.assertEqual(denied.exception.status_code, 403)

    def test_student_candidate_route_precedes_integer_profile_route(self):
        from app.api.tenant_account_links import router

        paths = [route.path for route in router.routes if "GET" in getattr(route, "methods", set())]
        self.assertLess(paths.index("/tenant/account-links/students/eligible-users"),
                        paths.index("/tenant/account-links/students/{student_id}"))

    def test_teacher_self_access_uses_verified_link_not_email_equality(self):
        same_email_unlinked_user = User(
            name="Unlinked login", email=self.teacher.email, hashed_password="synthetic",
            role="teacher", is_active=True,
        )
        self.db.add(same_email_unlinked_user)
        self.db.flush()
        self.db.add(CollegeMembership(
            user_id=same_email_unlinked_user.id, college_id=self.college.id,
            role="teacher", status="active",
        ))
        self.db.commit()

        with self.assertRaises(HTTPException) as unlinked:
            list_tenant_teacher_assignments(
                self.teacher.id, self.college.id, self.db, {"id": same_email_unlinked_user.id},
            )
        self.assertEqual(unlinked.exception.status_code, 403)
        self.assertIn("verified Teacher profile link", unlinked.exception.detail)

        create_teacher_account_link(
            self.teacher.id, self.create_body(self.teacher_user.id), self.college.id,
            self.db, self.principal,
        )
        rows = list_tenant_teacher_assignments(
            self.teacher.id, self.college.id, self.db, {"id": self.teacher_user.id},
        )
        self.assertEqual(rows, [])

    def test_admin_can_read_link_status_and_audit_fields_only_in_selected_college(self):
        with self.assertRaises(HTTPException) as missing:
            read_teacher_account_link(
                self.teacher.id, college_id=self.college.id, db=self.db, current_user=self.principal,
            )
        self.assertEqual(missing.exception.status_code, 404)
        created = create_teacher_account_link(
            self.teacher.id, self.create_body(self.teacher_user.id), self.college.id,
            self.db, self.principal,
        )
        read = read_teacher_account_link(
            self.teacher.id, college_id=self.college.id, db=self.db, current_user=self.principal,
        )
        self.assertEqual((read.profile_id, read.user_id, read.college_id),
                         (self.teacher.id, self.teacher_user.id, self.college.id))
        self.assertEqual((read.id, read.link_status), (created.id, "active"))
        self.assertEqual(read.verified_by_user_id, self.admin.id)
        self.assertTrue(read.profile_is_active)
        self.assertTrue(read.user_is_active)
        self.assertEqual(read.membership_status, "active")
        teacher_membership = self.db.query(CollegeMembership).filter_by(
            user_id=self.teacher_user.id, college_id=self.college.id,
        ).one()
        teacher_membership.status = "suspended"
        self.db.commit()
        suspended_read = read_teacher_account_link(
            self.teacher.id, college_id=self.college.id, db=self.db, current_user=self.principal,
        )
        self.assertEqual(suspended_read.link_status, "active")
        self.assertEqual(suspended_read.membership_status, "suspended")
        with self.assertRaises(HTTPException) as foreign:
            read_teacher_account_link(
                self.teacher.id, college_id=self.other_college.id, db=self.db, current_user=self.principal,
            )
        self.assertEqual(foreign.exception.status_code, 403)

    def test_student_membership_cannot_manage_profile_links(self):
        with self.assertRaises(HTTPException) as denied:
            create_student_account_link(
                self.student.id, self.create_body(self.teacher_user.id), self.college.id,
                self.db, {"id": self.student_user.id},
            )
        self.assertEqual(denied.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
