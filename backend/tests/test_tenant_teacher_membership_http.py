"""HTTP contract tests for Teacher membership and session access on synthetic SQLite."""

import asyncio
import hashlib
import io
import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.dependencies import get_current_user
from app.api.tenant_attendance_sessions import _teacher_for_context
from app.main import app
from app.models import (
    AttendanceEvent,
    AttendanceSession,
    Class,
    College,
    CollegeMembership,
    FaceEmbedding,
    Student,
    StudentAccountLink,
    StudentClassAssignment,
    Subject,
    Teacher,
    TeacherAccountLink,
    TeacherAssignment,
    TeacherManagementAuditEvent,
    TeacherProfileVerification,
    User,
)
from app.schemas.tenant_registration import TenantTeacherCreate
from app.api.tenant_teachers import (
    create_tenant_teacher,
    list_tenant_teacher_verification_history,
    read_tenant_teacher_profile_verification,
    review_tenant_teacher_profile,
)
from app.schemas.tenant_teacher import TenantTeacherVerificationUpdate
from app.api.tenant_face import submit_face_attendance
from starlette.datastructures import Headers, UploadFile


class TenantTeacherMembershipHttpTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.db = self.Session()
        self.db.add_all([
            User(id=900, name="Synthetic Admin", email="admin@tenant-a.test", hashed_password="synthetic", role="admin", is_active=True),
            User(id=902, name="Foreign Teacher", email="teacher@tenant-b.test", hashed_password="synthetic", role="teacher", is_active=True),
            User(id=903, name="Suspended Teacher", email="suspended@tenant-a.test", hashed_password="synthetic", role="teacher", is_active=True),
            User(id=904, name="Student", email="student@tenant-a.test", hashed_password="synthetic", role="student", is_active=True),
            User(id=908, name="Unrelated User", email="unrelated@example.org", hashed_password="synthetic", role="teacher", is_active=True),
            College(id=5, slug="tenant-a", official_name="Synthetic College A", status="active"),
            College(id=6, slug="tenant-b", official_name="Synthetic College B", status="active"),
        ])
        self.db.flush()
        self.db.add_all([
            CollegeMembership(user_id=900, college_id=5, role="college_admin", status="active"),
            CollegeMembership(user_id=902, college_id=6, role="teacher", status="active"),
            CollegeMembership(user_id=903, college_id=5, role="teacher", status="suspended"),
            CollegeMembership(user_id=904, college_id=5, role="student", status="active"),
            Teacher(id=906, college_id=6, name="Foreign Teacher", email="teacher@tenant-b.test", employee_id="B-1", is_active=True),
            Class(id=905, college_id=5, name="Synthetic Class", is_active=True, latitude=12.0, longitude=77.0, radius_m=100),
            Subject(id=907, college_id=5, name="Synthetic Subject", code="SYN-1", is_active=True),
        ])
        self.db.commit()
        self.admin = self.db.query(User).filter_by(id=900).one()
        self.identity = {"id": self.admin.id}
        self.original_overrides = dict(app.dependency_overrides)

        def db_override():
            yield self.db

        app.dependency_overrides[get_db] = db_override
        app.dependency_overrides[get_current_user] = lambda: self.identity

    def tearDown(self):
        app.dependency_overrides.clear()
        app.dependency_overrides.update(self.original_overrides)
        self.db.close()
        self.engine.dispose()

    def request(self, college_id, *, method="GET", body=None, path="/tenant/attendance/sessions"):
        messages = []
        sent_request = False
        request_body = json.dumps(body).encode("utf-8") if body is not None else b""
        headers = [(b"host", b"testserver")]
        if body is not None:
            headers.append((b"content-type", b"application/json"))

        async def receive():
            nonlocal sent_request
            if not sent_request:
                sent_request = True
                return {"type": "http.request", "body": request_body, "more_body": False}
            return {"type": "http.disconnect"}

        async def send(message):
            messages.append(message)

        query = f"college_id={college_id}".encode("ascii")
        asyncio.run(app({
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": method,
            "scheme": "http",
            "path": path,
            "raw_path": path.encode("ascii"),
            "query_string": query,
            "root_path": "",
            "headers": headers,
            "client": ("127.0.0.1", 50000),
            "server": ("testserver", 80),
        }, receive, send))
        start = next(message for message in messages if message["type"] == "http.response.start")
        body = b"".join(
            message.get("body", b"")
            for message in messages
            if message["type"] == "http.response.body"
        )
        return start["status"], json.loads(body or b"null")

    def verify_teacher_profile(self, teacher_id):
        return review_tenant_teacher_profile(
            teacher_id,
            TenantTeacherVerificationUpdate(
                verification_status="verified",
                reason="Synthetic institutional record review.",
            ),
            5,
            self.db,
            {"id": self.admin.id},
        )

    def test_admin_teacher_registration_creates_active_membership_and_session_api_returns_200(self):
        payload = TenantTeacherCreate(
            name="Synthetic New Teacher",
            email="new-teacher@example.org",
            assignments=[],
            password="Synthetic-Teacher-Password-2026!",
            password_confirmation="Synthetic-Teacher-Password-2026!",
        )
        registered = create_tenant_teacher(payload, 5, self.db, self.admin)
        self.assertEqual(registered["profile_verification_status"], "verified")
        user = self.db.query(User).filter_by(email="new-teacher@example.org").one()
        membership = self.db.query(CollegeMembership).filter_by(user_id=user.id, college_id=5).one()
        self.assertEqual(membership.role, "teacher")
        self.assertEqual(membership.status, "active")
        self.assertNotEqual(user.hashed_password, payload.password.get_secret_value())
        self.assertEqual(registered["id"], self.db.query(Teacher.id).filter_by(email=user.email).scalar())
        verification = self.db.query(TeacherProfileVerification).filter_by(
            teacher_id=registered["id"], college_id=5,
        ).one()
        self.assertEqual(verification.verification_status, "verified")
        self.assertEqual(verification.verified_by_admin_id, self.admin.id)
        self.assertIn("authenticated College Admin", verification.verification_reason)
        audit = self.db.query(TeacherManagementAuditEvent).filter_by(
            teacher_id=registered["id"], college_id=5, action="profile_verified",
        ).one()
        self.assertEqual(audit.actor_user_id, self.admin.id)
        self.assertEqual(audit.related_user_id, user.id)
        self.assertEqual(audit.evidence_reference, "trusted_college_admin_teacher_registration")

        self.identity = {"id": user.id}
        profile_status, profile = self.request(5, path="/teachers/me/profile")
        self.assertEqual(profile_status, 200)
        self.assertEqual(profile["id"], registered["id"])
        assignments_status, assignments = self.request(5, path="/tenant/attendance/sessions/assignments")
        self.assertEqual((assignments_status, assignments), (200, []))
        summary_status, summary = self.request(5, path="/tenant/attendance/sessions/summary")
        self.assertEqual(summary_status, 200)
        self.assertEqual(summary["teacher_name"], registered["name"])
        initial_status, initial_body = self.request(5)
        self.assertEqual((initial_status, initial_body), (200, []))

        now = datetime.now(timezone.utc)
        session = AttendanceSession(
            college_id=5,
            teacher_id=registered["id"],
            class_id=905,
            subject_id=907,
            title="Synthetic lecture",
            starts_at=now,
            ends_at=now + timedelta(minutes=30),
            status="active",
            qr_secret="synthetic-only",
            latitude=12.0,
            longitude=77.0,
            radius_m=100,
        )
        self.db.add(session)
        self.db.commit()

        status_code, response = self.request(5)
        self.assertEqual(status_code, 200)
        self.assertEqual([row["id"] for row in response], [session.id])
        self.assertNotIn("qr_secret", response[0])

    def test_cross_college_and_suspended_memberships_are_denied_but_admin_remains_allowed(self):
        now = datetime.now(timezone.utc)
        post_body = {
            "class_id": 905,
            "subject_id": 907,
            "title": "Denied Synthetic Lecture",
            "starts_at": now.isoformat(),
            "ends_at": (now + timedelta(minutes=30)).isoformat(),
            "teacher_latitude": 12.0,
            "teacher_longitude": 77.0,
            "teacher_accuracy_m": 20,
        }
        for user_id in (902, 903, 904, 908):
            with self.subTest(user_id=user_id):
                self.identity = {"id": user_id}
                get_status, _ = self.request(5)
                post_status, _ = self.request(5, method="POST", body=post_body)
                self.assertEqual(get_status, 403)
                self.assertEqual(post_status, 403)

        self.identity = {"id": 900}
        status_code, response = self.request(5)
        self.assertEqual(status_code, 200)
        self.assertEqual(response, [])

    def test_teacher_membership_cannot_read_or_change_profile_verification(self):
        from fastapi import HTTPException

        teacher_user = User(
            id=909, name="Synthetic Teacher", email="teacher-review@tenant-a.test",
            hashed_password="synthetic", role="teacher", is_active=True,
        )
        self.db.add(teacher_user)
        self.db.flush()
        self.db.add(CollegeMembership(user_id=teacher_user.id, college_id=5, role="teacher", status="active"))
        self.db.commit()

        with self.assertRaises(HTTPException) as read_error:
            read_tenant_teacher_profile_verification(906, 5, self.db, {"id": teacher_user.id})
        self.assertEqual(read_error.exception.status_code, 403)
        self.assertEqual(read_error.exception.detail, "College administrator membership required.")

        with self.assertRaises(HTTPException) as write_error:
            review_tenant_teacher_profile(
                906,
                TenantTeacherVerificationUpdate(verification_status="verified", reason="Reviewed records."),
                5,
                self.db,
                {"id": teacher_user.id},
            )
        self.assertEqual(write_error.exception.status_code, 403)
        self.assertEqual(write_error.exception.detail, "College administrator membership required.")

    def test_registration_verification_is_audited_and_later_admin_rejection_blocks_access(self):
        payload = TenantTeacherCreate(
            name="Synthetic Review Teacher",
            email="review-teacher@example.org",
            assignments=[],
            password="Synthetic-Review-Password-2026!",
            password_confirmation="Synthetic-Review-Password-2026!",
        )
        registered = create_tenant_teacher(payload, 5, self.db, self.admin)
        user = self.db.query(User).filter_by(email="review-teacher@example.org").one()
        link_before = self.db.query(TeacherAccountLink).filter_by(teacher_id=registered["id"], college_id=5).one()

        self.identity = {"id": user.id}
        status_code, accessible = self.request(5)
        self.assertEqual((status_code, accessible), (200, []))

        self.identity = {"id": self.admin.id}
        verified = read_tenant_teacher_profile_verification(registered["id"], 5, self.db, {"id": self.admin.id})
        self.assertEqual(verified.verification_status, "verified")
        self.assertEqual(verified.verified_by_admin_id, self.admin.id)
        link_after = self.db.query(TeacherAccountLink).filter_by(teacher_id=registered["id"], college_id=5).one()
        self.assertEqual(link_before.id, link_after.id)
        self.assertEqual(link_after.verified_by_user_id, self.admin.id)
        history = list_tenant_teacher_verification_history(registered["id"], 5, self.db, {"id": self.admin.id})
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0].action, "profile_verified")

        self.identity = {"id": user.id}
        self.assertEqual(self.request(5)[0], 200)

        self.identity = {"id": self.admin.id}
        rejected = review_tenant_teacher_profile(
            registered["id"],
            TenantTeacherVerificationUpdate(verification_status="rejected", reason="New conflict found in records."),
            5,
            self.db,
            {"id": self.admin.id},
        )
        self.assertEqual(rejected.verification_status, "rejected")
        self.identity = {"id": user.id}
        denied_status, denied_body = self.request(5)
        self.assertEqual(denied_status, 403)
        self.assertIn("verification is rejected", denied_body["detail"])
        self.identity = {"id": self.admin.id}
        self.assertEqual(len(list_tenant_teacher_verification_history(registered["id"], 5, self.db, {"id": self.admin.id})), 2)

    def test_registration_is_atomic_and_retry_cannot_duplicate_identity_or_audit(self):
        from fastapi import HTTPException

        payload = TenantTeacherCreate(
            name="Atomic Teacher",
            email="atomic-teacher@example.org",
            assignments=[],
            password="Synthetic-Atomic-Password-2026!",
            password_confirmation="Synthetic-Atomic-Password-2026!",
        )
        models = (User, Teacher, CollegeMembership, TeacherAccountLink, TeacherProfileVerification, TeacherManagementAuditEvent)
        baseline_counts = [self.db.query(model).count() for model in models]
        with patch.object(self.db, "commit", side_effect=SQLAlchemyError("synthetic commit failure")):
            with self.assertRaises(HTTPException) as failure:
                create_tenant_teacher(payload, 5, self.db, self.admin)
        self.assertEqual(failure.exception.status_code, 503)
        self.assertEqual(self.db.query(User).filter_by(email="atomic-teacher@example.org").count(), 0)
        self.assertEqual(self.db.query(Teacher).filter_by(email="atomic-teacher@example.org").count(), 0)
        self.assertEqual([self.db.query(model).count() for model in models], baseline_counts)

        created = create_tenant_teacher(payload, 5, self.db, self.admin)
        self.assertEqual(created["profile_verification_status"], "verified")
        linked_user_id = self.db.query(User.id).filter_by(email="atomic-teacher@example.org").scalar()
        for model, filters in (
            (User, {"email": "atomic-teacher@example.org"}),
            (Teacher, {"email": "atomic-teacher@example.org"}),
            (CollegeMembership, {"user_id": linked_user_id, "college_id": 5}),
            (TeacherAccountLink, {"teacher_id": created["id"], "college_id": 5}),
            (TeacherProfileVerification, {"teacher_id": created["id"], "college_id": 5}),
            (TeacherManagementAuditEvent, {"teacher_id": created["id"], "college_id": 5, "action": "profile_verified"}),
        ):
            self.assertEqual(self.db.query(model).filter_by(**filters).count(), 1)

        with self.assertRaises(HTTPException) as retry:
            create_tenant_teacher(payload, 5, self.db, self.admin)
        self.assertEqual(retry.exception.status_code, 409)
        for model, filters in (
            (User, {"email": "atomic-teacher@example.org"}),
            (Teacher, {"email": "atomic-teacher@example.org"}),
            (CollegeMembership, {"user_id": linked_user_id, "college_id": 5}),
            (TeacherAccountLink, {"teacher_id": created["id"], "college_id": 5}),
            (TeacherProfileVerification, {"teacher_id": created["id"], "college_id": 5}),
            (TeacherManagementAuditEvent, {"teacher_id": created["id"], "college_id": 5, "action": "profile_verified"}),
        ):
            self.assertEqual(self.db.query(model).filter_by(**filters).count(), 1)

    def test_only_matching_persisted_admin_registration_provenance_can_reconcile_old_pending_profile(self):
        from fastapi import HTTPException

        teacher_user_id = 915
        teacher_id = 916
        created_at = datetime.now(timezone.utc)
        self.db.add_all([
            User(id=teacher_user_id, name="Synthetic Legacy Teacher", email="legacy-teacher@example.test", hashed_password="synthetic", role="teacher", is_active=True, created_at=created_at),
            Teacher(id=teacher_id, college_id=5, name="Synthetic Legacy Teacher", email="legacy-teacher@example.test", employee_id="A-LEGACY", is_active=True, created_at=created_at),
        ])
        self.db.flush()
        self.db.add(CollegeMembership(
            user_id=teacher_user_id, college_id=5, role="teacher", status="active",
            created_by_user_id=self.admin.id, activated_by_user_id=self.admin.id,
            activated_at=created_at, status_reason="Permanent password set by College Admin during registration.",
            created_at=created_at,
        ))
        self.db.flush()
        link = TeacherAccountLink(
            teacher_id=teacher_id, user_id=teacher_user_id, college_id=5,
            link_status="active", verified_by_user_id=self.admin.id,
            verified_at=created_at, created_at=created_at,
        )
        self.db.add(link)
        self.db.commit()
        original_link_id = link.id

        self.identity = {"id": self.admin.id}
        verify_status, verified = self.request(5, method="POST", path=f"/teachers/{teacher_id}/registration-reconcile")
        self.assertEqual(verify_status, 200)
        self.assertEqual(verified["verification_status"], "verified")
        event = self.db.query(TeacherManagementAuditEvent).filter_by(
            teacher_id=teacher_id, college_id=5, action="profile_verified",
        ).one()
        self.assertEqual(event.actor_user_id, self.admin.id)
        self.assertEqual(event.related_user_id, teacher_user_id)
        self.assertEqual(event.evidence_reference, "trusted_college_admin_teacher_registration")
        self.assertEqual(self.db.query(TeacherAccountLink).filter_by(teacher_id=teacher_id, college_id=5).one().id, original_link_id)

        again_status, again = self.request(5, method="POST", path=f"/teachers/{teacher_id}/registration-reconcile")
        self.assertEqual(again_status, 200)
        self.assertEqual(again["verification_status"], "verified")
        self.assertEqual(self.db.query(TeacherManagementAuditEvent).filter_by(
            teacher_id=teacher_id, college_id=5, action="profile_verified",
        ).count(), 1)

        foreign_status, _ = self.request(5, method="POST", path="/teachers/906/registration-reconcile")
        self.assertEqual(foreign_status, 404)

        unproven_user = User(id=917, name="Unproven Teacher", email="unproven@example.test", hashed_password="synthetic", role="teacher", is_active=True)
        unproven_teacher = Teacher(id=918, college_id=5, name="Unproven Teacher", email="unproven@example.test", employee_id="A-UNPROVEN", is_active=True)
        self.db.add_all([unproven_user, unproven_teacher])
        self.db.flush()
        self.db.add(CollegeMembership(user_id=917, college_id=5, role="teacher", status="active"))
        self.db.add(TeacherAccountLink(
            teacher_id=918, user_id=917, college_id=5, link_status="active",
            verified_by_user_id=self.admin.id, verified_at=datetime.now(timezone.utc),
            created_at=datetime.now(timezone.utc),
        ))
        self.db.commit()
        no_provenance_status, no_provenance_body = self.request(5, method="POST", path="/teachers/918/registration-reconcile")
        self.assertEqual(no_provenance_status, 409)
        self.assertIn("Persisted records do not prove", no_provenance_body["detail"])
        self.assertEqual(self.db.query(TeacherProfileVerification).filter_by(teacher_id=918, college_id=5).count(), 0)
        self.identity = {"id": 903}
        unauthorized_status, _ = self.request(5, method="POST", path="/teachers/918/registration-reconcile")
        self.assertEqual(unauthorized_status, 403)

    def test_authorized_teacher_post_starts_and_persists_a_session_but_admin_cannot_start_it(self):
        payload = TenantTeacherCreate(
            name="Synthetic Lecture Teacher",
            email="lecture-teacher@example.org",
            assignments=[],
            password="Synthetic-Lecture-Password-2026!",
            password_confirmation="Synthetic-Lecture-Password-2026!",
        )
        registered = create_tenant_teacher(payload, 5, self.db, self.admin)
        self.verify_teacher_profile(registered["id"])
        user = self.db.query(User).filter_by(email="lecture-teacher@example.org").one()
        self.db.add(TeacherAssignment(
            college_id=5,
            teacher_id=registered["id"],
            class_id=905,
            subject_id=907,
            academic_year="2026-2027",
            semester=1,
            is_active=True,
            effective_from=datetime.now(timezone.utc) - timedelta(minutes=5),
        ))
        self.db.commit()

        now = datetime.now(timezone.utc)
        request_body = {
            "location_verification_mode": "gps_on",
            "class_id": 905,
            "subject_id": 907,
            "title": "Synthetic Lecture",
            "starts_at": (now - timedelta(seconds=5)).isoformat(),
            "ends_at": (now + timedelta(minutes=30)).isoformat(),
            "teacher_latitude": 12.0,
            "teacher_longitude": 77.0,
            "teacher_accuracy_m": 20,
        }
        status_code, denied = self.request(5, method="POST", body=request_body)
        self.assertEqual(status_code, 403, "College Admins can list sessions but cannot start teacher lectures.")
        self.assertEqual(denied["detail"], "An active Teacher membership is required.")

        self.identity = {"id": user.id}
        status_code, created = self.request(5, method="POST", body=request_body)
        self.assertEqual(status_code, 201, created)
        self.assertEqual(created["teacher_id"], registered["id"])
        self.assertEqual(created["class_id"], 905)
        self.assertEqual(created["subject_id"], 907)
        self.assertNotIn("qr_secret", created)
        self.assertEqual(
            self.db.query(AttendanceSession).filter_by(id=created["id"], college_id=5).count(),
            1,
        )

        student_user = User(
            id=920,
            name="Synthetic Student",
            email="student@example.org",
            hashed_password="synthetic-only",
            role="student",
            is_active=True,
        )
        student = Student(
            id=930,
            college_id=5,
            name="Synthetic Student",
            email="student@example.org",
            roll_number="S-930",
            student_code="SYN-930",
            is_active=True,
        )
        self.db.add_all([
            student_user,
            student,
            CollegeMembership(user_id=920, college_id=5, role="student", status="active"),
            StudentAccountLink(
                student_id=930,
                user_id=920,
                college_id=5,
                link_status="active",
                verified_by_user_id=900,
                verified_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
                created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            ),
            StudentClassAssignment(
                college_id=5,
                student_id=930,
                class_id=905,
                academic_year="2026-2027",
                semester=1,
                is_active=True,
                effective_from=datetime.now(timezone.utc) - timedelta(minutes=5),
            ),
        ])
        vector = [1.0] + [0.0] * 127
        image = b"synthetic enrolled face fixture"
        self.db.add(FaceEmbedding(
            student_id=930,
            image_data=image,
            mime_type="image/jpeg",
            image_sha256=hashlib.sha256(image).hexdigest(),
            embedding_json=json.dumps(vector),
            status="registered",
        ))
        self.db.commit()

        self.identity = {"id": student_user.id}
        upload = UploadFile(
            file=io.BytesIO(b"synthetic live capture"),
            filename="capture.jpg",
            headers=Headers({"content-type": "image/jpeg"}),
        )
        with patch("app.api.tenant_face.embedding_from_image", return_value=vector):
            face_result = asyncio.run(submit_face_attendance(
                session_id=created["id"],
                file=upload,
                college_id=5,
                latitude=None,
                longitude=None,
                accuracy_m=None,
                db=self.db,
                current_user=self.identity,
            ))
        self.assertTrue(face_result["success"])
        self.assertEqual(face_result["method"], "face")
        saved_event = self.db.query(AttendanceEvent).filter_by(
            session_id=created["id"],
            student_id=student.id,
            college_id=5,
        ).one()
        self.assertEqual(saved_event.method, "face")
        self.assertEqual(saved_event.status, "present")
        self.assertIsNone(saved_event.latitude, "Face-only attendance must not require Student GPS.")

    def test_teacher_guard_reports_inactive_account_separately_from_membership_failure(self):
        from fastapi import HTTPException
        from types import SimpleNamespace

        class EmptyQuery:
            def filter(self, *_criteria):
                return self

            def one_or_none(self):
                return None

        inactive_db = SimpleNamespace(query=lambda _model: EmptyQuery())
        teacher_context = SimpleNamespace(user_id=903, membership_role="teacher", college_id=5)
        with self.assertRaises(HTTPException) as account_failure:
            _teacher_for_context(inactive_db, teacher_context)
        self.assertEqual(account_failure.exception.status_code, 403)
        self.assertIn("account is no longer active", account_failure.exception.detail)


if __name__ == "__main__":
    unittest.main()
