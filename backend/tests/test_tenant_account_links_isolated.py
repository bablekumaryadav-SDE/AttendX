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
    reconcile_legacy_teacher,
)
from app.api.tenant_teachers import list_tenant_teacher_assignments, review_tenant_teacher_profile
from app.database import Base
from app.models import Class, College, CollegeMembership, Student, StudentAccountLink, Subject, Teacher, TeacherAccountLink, TeacherAssignment, TeacherManagementAuditEvent, TeacherProfileVerification, User
from app.schemas.tenant_account_links import TenantAccountLinkCreate, TenantAccountLinkRevoke, TenantLegacyTeacherReconciliation
from app.schemas.tenant_teacher import TenantTeacherVerificationUpdate


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
        review_tenant_teacher_profile(
            self.teacher.id,
            TenantTeacherVerificationUpdate(
                verification_status="verified",
                reason="Synthetic staff record independently reviewed.",
            ),
            self.college.id,
            self.db,
            self.principal,
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

    def legacy_body(self, user_id, *, reason=None):
        return TenantLegacyTeacherReconciliation(
            user_id=user_id,
            relationship_attested=True,
            reason=reason,
        )

    def test_legacy_reconciliation_links_only_explicit_existing_records_and_is_idempotent(self):
        class_row = Class(college_id=self.college.id, name="Roster class", is_active=True)
        subject_row = Subject(college_id=self.college.id, name="Roster subject", code="LEG-1", is_active=True)
        self.db.add_all([class_row, subject_row])
        self.db.flush()
        assignment = TeacherAssignment(
            teacher_id=self.teacher.id, class_id=class_row.id, subject_id=subject_row.id,
            college_id=None, academic_year="2026-2027", semester=1, is_active=True,
        )
        self.db.add(assignment)
        self.db.commit()

        original_college_id = self.teacher.college_id
        original_membership = self.db.query(CollegeMembership).filter_by(
            user_id=self.teacher_user.id, college_id=self.college.id,
        ).one()
        original_membership_id = original_membership.id
        result = reconcile_legacy_teacher(
            self.teacher.id, self.legacy_body(self.teacher_user.id), self.college.id, self.db, self.principal,
        )
        self.assertEqual((result.profile_id, result.user_id, result.college_id), (self.teacher.id, self.teacher_user.id, self.college.id))
        self.assertFalse(result.ownership_established)
        self.assertFalse(result.membership_created)
        self.assertEqual(result.profile_verification_status, "pending")
        self.assertEqual(self.db.query(Teacher).filter_by(id=self.teacher.id).one().college_id, original_college_id)
        self.assertEqual(self.db.query(CollegeMembership).filter_by(user_id=self.teacher_user.id, college_id=self.college.id).one().id, original_membership_id)
        self.assertIsNone(self.db.query(TeacherAssignment).filter_by(id=assignment.id).one().college_id)
        self.assertTrue(self.db.query(Teacher).filter_by(id=self.teacher.id).one().is_active)
        self.assertEqual(self.db.query(TeacherAccountLink).filter_by(teacher_id=self.teacher.id, user_id=self.teacher_user.id).count(), 1)
        completion = self.db.query(TeacherManagementAuditEvent).filter_by(
            teacher_id=self.teacher.id, action="legacy_reconciliation_completed",
        ).one()
        self.assertEqual(completion.actor_user_id, self.admin.id)
        self.assertEqual(completion.related_user_id, self.teacher_user.id)
        self.assertEqual(completion.college_id, self.college.id)
        self.assertIsNone(completion.evidence_reference)
        self.assertEqual(completion.new_state["action_result"], "success")
        self.assertTrue(completion.new_state["relationship_attested"])
        self.assertFalse(completion.new_state["mailbox_verified"])
        self.assertEqual(completion.new_state["profile_verification_status"], "pending")
        self.assertIsNotNone(completion.created_at)

        repeated = reconcile_legacy_teacher(
            self.teacher.id, self.legacy_body(self.teacher_user.id, reason="Second operator confirmation."),
            self.college.id, self.db, self.principal,
        )
        self.assertEqual(repeated.id, result.id)
        self.assertEqual(self.db.query(TeacherAccountLink).filter_by(teacher_id=self.teacher.id).count(), 1)
        self.assertEqual(self.db.query(TeacherManagementAuditEvent).filter_by(
            teacher_id=self.teacher.id, action="legacy_reconciliation_completed",
        ).count(), 1)

    def test_legacy_reconciliation_rejects_unowned_and_foreign_profiles_without_changes(self):
        unowned = Teacher(
            name="Unowned legacy", email="unowned-legacy@example.invalid",
            employee_id="UNOWNED-1", is_active=True,
        )
        foreign = Teacher(
            college_id=self.other_college.id, name="Foreign legacy", email="foreign-legacy@example.invalid",
            employee_id="FOREIGN-LEGACY", is_active=True,
        )
        self.db.add_all([unowned, foreign])
        self.db.commit()
        for profile in (unowned, foreign):
            with self.subTest(profile_id=profile.id):
                with self.assertRaises(HTTPException) as rejected:
                    reconcile_legacy_teacher(
                        profile.id, self.legacy_body(self.teacher_user.id),
                        self.college.id, self.db, self.principal,
                    )
                self.assertEqual(rejected.exception.status_code, 404)
                self.assertEqual(self.db.query(TeacherAccountLink).filter_by(teacher_id=profile.id).count(), 0)
                self.assertEqual(self.db.query(Teacher).filter_by(id=profile.id).one().college_id, profile.college_id)

    def test_legacy_reconciliation_requires_existing_active_same_college_membership(self):
        inactive = User(
            name="Inactive login", email="inactive-login@example.invalid",
            hashed_password="synthetic", role="teacher", is_active=True,
        )
        self.db.add(inactive)
        self.db.flush()
        self.db.add(CollegeMembership(
            user_id=inactive.id, college_id=self.college.id, role="teacher", status="suspended",
        ))
        self.db.commit()
        with self.assertRaises(HTTPException) as rejected:
            reconcile_legacy_teacher(
                self.teacher.id, self.legacy_body(inactive.id),
                self.college.id, self.db, self.principal,
            )
        self.assertEqual(rejected.exception.status_code, 409)
        self.assertEqual(self.db.query(TeacherAccountLink).filter_by(teacher_id=self.teacher.id).count(), 0)
        self.assertEqual(self.db.query(CollegeMembership).filter_by(user_id=inactive.id, college_id=self.college.id).one().status, "suspended")

    def test_legacy_reconciliation_never_overwrites_an_existing_different_link(self):
        other_teacher = Teacher(
            college_id=self.college.id, name="Another Teacher",
            email="another-teacher@example.invalid", employee_id="T-2", is_active=True,
        )
        self.db.add(other_teacher)
        self.db.flush()
        existing = create_teacher_account_link(
            other_teacher.id, self.create_body(self.teacher_user.id),
            self.college.id, self.db, self.principal,
        )
        with self.assertRaises(HTTPException) as conflict:
            reconcile_legacy_teacher(
                self.teacher.id, self.legacy_body(self.teacher_user.id),
                self.college.id, self.db, self.principal,
            )
        self.assertEqual(conflict.exception.status_code, 409)
        self.assertEqual(self.db.query(TeacherAccountLink).filter_by(id=existing.id).one().teacher_id, other_teacher.id)
        self.assertEqual(self.db.query(TeacherAccountLink).filter_by(teacher_id=self.teacher.id).count(), 0)

    def test_legacy_reconciliation_requires_one_explicit_attestation_and_admin_role(self):
        with self.assertRaises(ValidationError):
            TenantLegacyTeacherReconciliation(user_id=self.teacher_user.id, relationship_attested=False)
        with self.assertRaises(ValidationError):
            TenantLegacyTeacherReconciliation(user_id=self.teacher_user.id)
        body = self.legacy_body(self.teacher_user.id)
        self.assertIsNone(body.reason)
        with self.assertRaises(HTTPException) as denied:
            reconcile_legacy_teacher(
                self.teacher.id, body, self.college.id, self.db,
                {"id": self.teacher_user.id},
            )
        self.assertEqual(denied.exception.status_code, 403)
        self.assertEqual(self.db.query(TeacherAccountLink).count(), 0)

    def test_legacy_reconciliation_route_is_registered_and_college_scoped(self):
        from app.api.tenant_account_links import router

        route = next(route for route in router.routes if route.path.endswith("/teachers/{teacher_id}/legacy-reconcile"))
        self.assertEqual(route.methods, {"POST"})
        self.assertIn("college_id", route.dependant.query_params[0].name)

    def test_legacy_reconciliation_reports_missing_audit_schema_without_mutation(self):
        TeacherManagementAuditEvent.__table__.drop(self.engine)
        with self.assertLogs("app.api.tenant_account_links", level="ERROR") as captured:
            with self.assertRaises(HTTPException) as unavailable:
                reconcile_legacy_teacher(
                    self.teacher.id, self.legacy_body(self.teacher_user.id),
                    self.college.id, self.db, self.principal,
                )
        self.assertEqual(unavailable.exception.status_code, 503)
        self.assertIn("reviewed verification and audit schema is not installed", unavailable.exception.detail)
        self.assertIn("failure_class=schema_missing_table", captured.output[0])
        self.assertIn("relation=teacher_management_audit_events", captured.output[0])
        self.assertEqual(self.db.query(TeacherAccountLink).filter_by(teacher_id=self.teacher.id).count(), 0)

    def test_legacy_reconciliation_reports_missing_verification_schema_without_mutation(self):
        TeacherProfileVerification.__table__.drop(self.engine)
        with self.assertLogs("app.api.tenant_account_links", level="ERROR") as captured:
            with self.assertRaises(HTTPException) as unavailable:
                reconcile_legacy_teacher(
                    self.teacher.id, self.legacy_body(self.teacher_user.id),
                    self.college.id, self.db, self.principal,
                )
        self.assertEqual(unavailable.exception.status_code, 503)
        self.assertIn("reviewed verification and audit schema is not installed", unavailable.exception.detail)
        self.assertIn("relation=teacher_profile_verifications", captured.output[0])
        self.assertEqual(self.db.query(TeacherAccountLink).filter_by(teacher_id=self.teacher.id).count(), 0)


if __name__ == "__main__":
    unittest.main()
