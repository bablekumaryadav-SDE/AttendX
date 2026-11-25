"""Tenant face enrollment tests using only synthetic SQLite fixtures."""

import asyncio
import hashlib
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

try:
    import httpx2 as httpx
except ImportError:  # Compatibility with environments before Starlette's httpx2 transition.
    import httpx
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.dependencies import get_current_user
from app.main import app
from app.models import (
    AttendanceEvent, AttendanceSession, Class, College, CollegeMembership,
    FaceEmbedding, Student, StudentAccountLink, StudentClassAssignment, Subject, Teacher,
    TeacherAssignment, User,
)
from app.services.attendance_core import build_qr_token


class _SyncASGIClient:
    """Small synchronous facade for installed httpx ASGITransport."""

    def __init__(self, application):
        self.application = application

    def _request(self, method, path, **kwargs):
        async def send():
            transport = httpx.ASGITransport(app=self.application)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                return await client.request(method, path, **kwargs)
        return asyncio.run(send())

    def get(self, path, **kwargs):
        return self._request("GET", path, **kwargs)

    def post(self, path, **kwargs):
        return self._request("POST", path, **kwargs)

    def close(self):
        return None


class TenantFaceApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.Session.begin() as db:
            db.add_all([
                College(id=81, slug="face-a", official_name="Face College A", status="active"),
                College(id=82, slug="face-b", official_name="Face College B", status="active"),
                User(id=810, name="Admin A", email="admin-a@test.invalid", hashed_password="x", role="admin"),
                User(id=811, name="Student A", email="student-a@test.invalid", hashed_password="x", role="student"),
                User(id=812, name="Admin B", email="admin-b@test.invalid", hashed_password="x", role="admin"),
                User(id=813, name="Teacher A", email="teacher-a@test.invalid", hashed_password="x", role="teacher"),
                Student(id=8110, college_id=81, name="Student A", email="student-a@test.invalid", roll_number="A1", is_active=True),
                Student(id=8210, college_id=82, name="Student B", email="student-b@test.invalid", roll_number="B1", is_active=True),
                Teacher(id=8130, college_id=81, name="Teacher A", email="teacher-a@test.invalid", employee_id="TA1", is_active=True),
                Class(id=8111, college_id=81, name="Class A", section="A", is_active=True),
                Subject(id=8112, college_id=81, name="Subject A", code="SA", is_active=True),
            ])
            db.add_all([
                CollegeMembership(user_id=810, college_id=81, role="college_admin", status="active"),
                CollegeMembership(user_id=811, college_id=81, role="student", status="active"),
                CollegeMembership(user_id=812, college_id=82, role="college_admin", status="active"),
                CollegeMembership(user_id=813, college_id=81, role="teacher", status="active"),
                StudentClassAssignment(id=8113, college_id=81, student_id=8110, class_id=8111, academic_year="2026-27", semester=1, is_active=True),
                StudentAccountLink(id=8120, student_id=8110, user_id=811, college_id=81, link_status="active", verified_by_user_id=810, verified_at=datetime.now(timezone.utc), created_at=datetime.now(timezone.utc)),
                TeacherAssignment(id=8114, college_id=81, teacher_id=8130, subject_id=8112, class_id=8111, academic_year="2026-27", semester=1, is_active=True),
                AttendanceSession(
                    id=8115, college_id=81, teacher_id=8130, subject_id=8112, class_id=8111,
                    title="Face session", starts_at=datetime.now(timezone.utc)-timedelta(minutes=5),
                    ends_at=datetime.now(timezone.utc)+timedelta(minutes=20), status="active",
                    qr_secret="synthetic-session-secret", qr_expires_at=datetime.now(timezone.utc)+timedelta(minutes=1),
                    radius_m=100,
                ),
            ])
        self.actor = {"id": 810, "sub": "810", "email": "admin-a@test.invalid", "role": "admin", "is_active": True}

        def override_db():
            with self.Session() as db:
                yield db

        app.dependency_overrides.clear()
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_user] = lambda: self.actor
        self.client = _SyncASGIClient(app)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        self.engine.dispose()

    def test_admin_can_register_only_same_college_student_and_response_is_sanitized(self):
        image = b"synthetic face bytes"
        vector = [1.0] + [0.0] * 127
        with patch("app.api.tenant_face.embedding_from_image", return_value=vector):
            response = self.client.post(
                "/tenant/face/students/8110/register?college_id=81",
                files={"file": ("capture.jpg", image, "image/jpeg")},
                data={"consent": "true"},
            )
        self.assertEqual(response.status_code, 201, response.text)
        self.assertTrue(response.json()["face_registered"])
        self.assertNotIn("embedding", response.text)
        self.assertNotIn("image_data", response.text)
        with self.Session() as db:
            saved = db.query(FaceEmbedding).one()
            self.assertEqual(saved.student_id, 8110)
            self.assertEqual(saved.image_data, image)
            self.assertEqual(len(saved.embedding_json.strip("[]").split(",")), 128)

    def test_foreign_college_student_is_indistinguishable_from_missing(self):
        response = self.client.get("/tenant/face/students/8210?college_id=81")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Record not found."})

    def test_inactive_student_keeps_historical_face_status_but_cannot_be_reenrolled(self):
        import json
        vector = [1.0] + [0.0] * 127
        image = b"synthetic historical face bytes"
        with self.Session.begin() as db:
            student = db.query(Student).filter_by(id=8110).one()
            student.is_active = False
            db.add(FaceEmbedding(
                student_id=8110,
                image_data=image,
                mime_type="image/jpeg",
                image_sha256=hashlib.sha256(image).hexdigest(),
                embedding_json=json.dumps(vector),
                status="registered",
            ))
        response = self.client.get("/tenant/face/students/8110?college_id=81")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "registered")
        self.assertTrue(response.json()["face_registered"])
        self.assertNotIn("embedding_json", response.text)
        denied = self.client.post(
            "/tenant/face/students/8110/register?college_id=81",
            files={"file": ("capture.jpg", b"synthetic capture", "image/jpeg")},
            data={"consent": "true"},
        )
        self.assertEqual(denied.status_code, 404)

    def test_student_can_only_read_and_register_own_face_with_explicit_membership(self):
        self.actor.update(id=811, sub="811", email="student-a@test.invalid", role="student")
        status_response = self.client.get("/tenant/face/me?college_id=81")
        self.assertEqual(status_response.status_code, 200, status_response.text)
        self.assertFalse(status_response.json()["face_registered"])
        self.assertEqual(self.client.get("/tenant/face/me").status_code, 422)
        self.assertEqual(self.client.get("/tenant/face/me?college_id=82").status_code, 403)

    def test_student_profile_is_not_inferred_from_matching_email_without_verified_link(self):
        self.actor.update(id=811, sub="811", email="student-a@test.invalid", role="student")
        with self.Session.begin() as db:
            db.query(StudentAccountLink).filter_by(user_id=811, college_id=81).delete()
        response = self.client.get("/tenant/face/me?college_id=81")
        self.assertEqual(response.status_code, 403)
        self.assertIn("verified Student profile link", response.json()["detail"])

    def test_admin_requires_explicit_consent_and_role(self):
        image = {"file": ("capture.jpg", b"image", "image/jpeg")}
        denied = self.client.post("/tenant/face/students/8110/register?college_id=81", files=image, data={"consent": "false"})
        self.assertEqual(denied.status_code, 400)
        self.actor.update(id=811, sub="811", email="student-a@test.invalid", role="student")
        forbidden = self.client.get("/tenant/face/students/8110?college_id=81")
        self.assertEqual(forbidden.status_code, 403)

    def test_unscoped_legacy_face_and_attendance_routes_remain_default_denied(self):
        self.assertEqual(self.client.get("/face/me/status").status_code, 503)
        self.assertEqual(self.client.get("/attendance/student/active-sessions").status_code, 503)

    def test_student_session_list_is_scoped_and_never_returns_qr_secret(self):
        self.actor.update(id=811, sub="811", email="student-a@test.invalid", role="student")
        response = self.client.get("/tenant/face/student/sessions?college_id=81")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([row["id"] for row in response.json()], [8115])
        self.assertNotIn("qr_secret", response.text)
        self.assertEqual(self.client.get("/tenant/face/student/sessions?college_id=82").status_code, 403)

    def test_active_session_qr_attendance_flows_through_student_and_teacher_routes(self):
        # Simulate the UI contract end-to-end through the mounted ASGI routes:
        # teacher issues a session QR, the eligible student sees the session,
        # submits the issued token, then both history and teacher monitoring
        # reflect the persisted event.
        with self.Session.begin() as db:
            session = db.get(AttendanceSession, 8115)
            session.latitude = 0
            session.longitude = 0
        self.actor.update(id=813, sub="813", email="teacher-a@test.invalid", role="teacher")
        issued = self.client.get("/tenant/attendance/sessions/8115/qr?college_id=81")
        self.assertEqual(issued.status_code, 200, issued.text)
        qr_token = issued.json()["token"]
        self.assertNotIn("qr_secret", issued.text)

        self.actor.update(id=811, sub="811", email="student-a@test.invalid", role="student")
        invalid_qr = self.client.post(
            "/tenant/face/student/sessions/8115/qr?college_id=81",
            json={"token": "not-a-valid-qr"},
        )
        expired_token = build_qr_token(
            8115,
            "synthetic-session-secret",
            datetime.now(timezone.utc)-timedelta(seconds=10),
        )
        expired_qr = self.client.post(
            "/tenant/face/student/sessions/8115/qr?college_id=81",
            json={"token": expired_token},
        )
        self.assertEqual(invalid_qr.status_code, 400, invalid_qr.text)
        self.assertEqual(expired_qr.status_code, 400, expired_qr.text)
        self.assertIn("Invalid or expired QR", invalid_qr.text)
        self.assertIn("Invalid or expired QR", expired_qr.text)
        visible = self.client.get("/tenant/face/student/sessions?college_id=81")
        self.assertEqual(visible.status_code, 200, visible.text)
        session = next(item for item in visible.json() if item["id"] == 8115)
        self.assertEqual(
            (session["subject_name"], session["class_name"], session["teacher_name"], session["already_attended"]),
            ("Subject A", "Class A", "Teacher A", False),
        )
        self.assertNotIn("qr_secret", visible.text)

        submitted = self.client.post(
            "/tenant/face/student/sessions/8115/qr?college_id=81",
            json={"token": qr_token, "latitude": 0, "longitude": 0.0002, "accuracy_m": 20},
        )
        self.assertEqual(submitted.status_code, 200, submitted.text)
        self.assertEqual(submitted.json()["status"], "present")

        history = self.client.get("/tenant/face/student/attendance?college_id=81")
        self.assertEqual(history.status_code, 200, history.text)
        self.assertEqual(len(history.json()), 1)
        self.assertEqual(history.json()[0]["method"], "qr")

        visible_after = self.client.get("/tenant/face/student/sessions?college_id=81")
        self.assertTrue(visible_after.json()[0]["already_attended"])
        duplicate = self.client.post(
            "/tenant/face/student/sessions/8115/qr?college_id=81",
            json={"token": qr_token},
        )
        self.assertEqual(duplicate.status_code, 409)

        self.actor.update(id=813, sub="813", email="teacher-a@test.invalid", role="teacher")
        live = self.client.get("/tenant/attendance/sessions/8115/live?college_id=81")
        self.assertEqual(live.status_code, 200, live.text)
        self.assertEqual(len(live.json()), 1)
        self.assertEqual((live.json()[0]["student_id"], live.json()[0]["status"], live.json()[0]["method"]), (8110, "present", "qr"))

        self.actor.update(id=812, sub="812", email="admin-b@test.invalid", role="admin")
        foreign_college = self.client.get("/tenant/attendance/sessions/8115/live?college_id=82")
        self.assertEqual(foreign_college.status_code, 404)
        self.assertNotIn("Student A", foreign_college.text)

    def test_student_academics_returns_only_current_owned_enrollment_and_subjects(self):
        self.actor.update(id=811, sub="811", email="student-a@test.invalid", role="student")
        response = self.client.get("/tenant/face/student/academics?college_id=81")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["student_id"], 8110)
        self.assertEqual(len(body["enrollments"]), 1)
        enrollment = body["enrollments"][0]
        self.assertEqual(enrollment["class_id"], 8111)
        self.assertEqual(enrollment["class_name"], "Class A")
        self.assertEqual(enrollment["effective_from"], None)
        self.assertEqual([subject["id"] for subject in enrollment["subjects"]], [8112])
        self.assertEqual(enrollment["subjects"][0]["academic_year"], "2026-27")
        self.assertNotIn("embedding", response.text)
        self.assertNotIn("password", response.text.lower())
        denied = self.client.get("/tenant/face/student/academics?college_id=82")
        self.assertEqual(denied.status_code, 403)
        self.assertNotIn("Class A", denied.text)

    def test_face_attendance_requires_registered_matching_embedding_and_prevents_duplicates(self):
        self.actor.update(id=811, sub="811", email="student-a@test.invalid", role="student")
        probe = [1.0] + [0.0] * 127
        image = b"synthetic registered biometric bytes"
        with self.Session.begin() as db:
            session = db.get(AttendanceSession, 8115)
            session.latitude = 0
            session.longitude = 0
            db.add(FaceEmbedding(
                student_id=8110, image_data=image, mime_type="image/jpeg",
                image_sha256=hashlib.sha256(image).hexdigest(),
                embedding_json=__import__("json").dumps(probe), status="registered",
            ))
        with patch("app.api.tenant_face.embedding_from_image", return_value=probe):
            first = self.client.post(
                "/tenant/face/student/sessions/8115/face?college_id=81",
                files={"file": ("capture.jpg", b"synthetic live capture", "image/jpeg")},
                data={"latitude": "0", "longitude": "0.0002", "accuracy_m": "20"},
            )
            duplicate = self.client.post(
                "/tenant/face/student/sessions/8115/face?college_id=81",
                files={"file": ("capture.jpg", b"synthetic live capture", "image/jpeg")},
                data={"latitude": "0", "longitude": "0.0002", "accuracy_m": "20"},
            )
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json()["status"], "present")
        self.assertEqual(duplicate.status_code, 409)
        with self.Session() as db:
            self.assertEqual(db.query(AttendanceEvent).filter_by(session_id=8115, student_id=8110).count(), 1)
        history = self.client.get("/tenant/face/student/attendance?college_id=81")
        self.assertEqual(history.status_code, 200, history.text)
        self.assertEqual([(row["session_id"], row["method"], row["status"]) for row in history.json()], [(8115, "face", "present")])
        self.actor.update(id=813, sub="813", email="teacher-a@test.invalid", role="teacher")
        teacher_live = self.client.get("/tenant/attendance/sessions/8115/live?college_id=81")
        self.assertEqual(teacher_live.status_code, 200, teacher_live.text)
        self.assertEqual([(row["student_id"], row["method"], row["status"]) for row in teacher_live.json()], [(8110, "face", "present")])
        self.actor.update(id=810, sub="810", email="admin-a@test.invalid", role="admin")
        admin_events = self.client.get("/tenant/attendance/events?college_id=81")
        self.assertEqual(admin_events.status_code, 200, admin_events.text)
        self.assertEqual(admin_events.json()["total"], 1)
        self.assertEqual(admin_events.json()["items"][0]["method"], "face")

    def test_face_attendance_does_not_require_session_gps_but_qr_still_does(self):
        self.actor.update(id=811, sub="811", email="student-a@test.invalid", role="student")
        probe = [1.0] + [0.0] * 127
        image = b"synthetic registered face without gps session"
        with self.Session.begin() as db:
            session = db.get(AttendanceSession, 8115)
            session.latitude = None
            session.longitude = None
            db.add(FaceEmbedding(
                student_id=8110, image_data=image, mime_type="image/jpeg",
                image_sha256=hashlib.sha256(image).hexdigest(),
                embedding_json=__import__("json").dumps(probe), status="registered",
            ))
        self.actor.update(id=813, sub="813", email="teacher-a@test.invalid", role="teacher")
        issued = self.client.get("/tenant/attendance/sessions/8115/qr?college_id=81")
        self.assertEqual(issued.status_code, 200, issued.text)
        self.actor.update(id=811, sub="811", email="student-a@test.invalid", role="student")
        qr = self.client.post(
            "/tenant/face/student/sessions/8115/qr?college_id=81",
            json={"token": issued.json()["token"], "latitude": 20, "longitude": 78, "accuracy_m": 10},
        )
        self.assertEqual(qr.status_code, 503)
        self.assertIn("location is not configured", qr.text)
        with patch("app.api.tenant_face.embedding_from_image", return_value=probe):
            face = self.client.post(
                "/tenant/face/student/sessions/8115/face?college_id=81",
                files={"file": ("capture.jpg", b"synthetic live face", "image/jpeg")},
            )
        self.assertEqual(face.status_code, 200, face.text)
        self.assertEqual(face.json()["status"], "present")
        with self.Session() as db:
            saved = db.query(AttendanceEvent).filter_by(session_id=8115, student_id=8110).one()
            self.assertEqual(saved.method, "face")

    def test_face_attendance_rejects_missing_or_invalid_registered_embedding(self):
        self.actor.update(id=811, sub="811", email="student-a@test.invalid", role="student")
        file = {"file": ("capture.jpg", b"synthetic image bytes", "image/jpeg")}
        missing = self.client.post(
            "/tenant/face/student/sessions/8115/face?college_id=81",
            files=file,
            data={"latitude": "0", "longitude": "0", "accuracy_m": "10"},
        )
        self.assertEqual(missing.status_code, 403, missing.text)
        self.assertIn("No valid face registration", missing.text)
        with self.Session.begin() as db:
            db.add(FaceEmbedding(
                student_id=8110, image_data=b"synthetic stored image", mime_type="image/jpeg",
                image_sha256=hashlib.sha256(b"synthetic stored image").hexdigest(),
                embedding_json="not-json", status="registered",
            ))
        invalid = self.client.post(
            "/tenant/face/student/sessions/8115/face?college_id=81",
            files=file,
            data={"latitude": "0", "longitude": "0", "accuracy_m": "10"},
        )
        self.assertEqual(invalid.status_code, 403, invalid.text)
        self.assertIn("No valid face registration", invalid.text)

    def test_face_attendance_succeeds_when_session_location_is_missing(self):
        self.actor.update(id=811, sub="811", email="student-a@test.invalid", role="student")
        probe = [1.0] + [0.0] * 127
        image = b"synthetic registered biometric bytes"
        with self.Session.begin() as db:
            db.add(FaceEmbedding(
                student_id=8110, image_data=image, mime_type="image/jpeg",
                image_sha256=hashlib.sha256(image).hexdigest(),
                embedding_json=__import__("json").dumps(probe), status="registered",
            ))
        with patch("app.api.tenant_face.embedding_from_image", return_value=probe):
            response = self.client.post(
                "/tenant/face/student/sessions/8115/face?college_id=81",
                files={"file": ("capture.jpg", b"synthetic live capture", "image/jpeg")},
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "present")
        with self.Session() as db:
            self.assertEqual(db.query(AttendanceEvent).filter_by(session_id=8115, student_id=8110, method="face").count(), 1)

    def test_face_attendance_uses_face_verification_without_student_gps(self):
        self.actor.update(id=811, sub="811", email="student-a@test.invalid", role="student")
        probe = [1.0] + [0.0] * 127
        image = b"synthetic registered biometric bytes for face-only test"

        with self.Session.begin() as db:
            db.add(FaceEmbedding(
                student_id=8110, image_data=image, mime_type="image/jpeg",
                image_sha256=hashlib.sha256(image).hexdigest(),
                embedding_json=__import__("json").dumps(probe), status="registered",
            ))
            session = db.query(AttendanceSession).filter_by(id=8115).one()
            session.latitude = 0
            session.longitude = 0
            session.radius_m = 100

            db.add(AttendanceSession(
                id=8116, college_id=81, teacher_id=8130,
                subject_id=8112, class_id=8111,
                title="Closed face session",
                starts_at=datetime.now(timezone.utc)-timedelta(hours=2),
                ends_at=datetime.now(timezone.utc)-timedelta(hours=1),
                status="closed",
                qr_secret="synthetic-closed-session-secret",
                qr_expires_at=datetime.now(timezone.utc)-timedelta(hours=1),
                radius_m=100,
            ))

            for session_id, title in (
                (8117, "Face session without GPS accuracy"),
                (8118, "Face session with distant submitted GPS"),
            ):
                db.add(AttendanceSession(
                    id=session_id, college_id=81, teacher_id=8130,
                    subject_id=8112, class_id=8111,
                    title=title,
                    starts_at=datetime.now(timezone.utc)-timedelta(minutes=1),
                    ends_at=datetime.now(timezone.utc)+timedelta(hours=1),
                    status="active",
                    qr_secret=f"synthetic-session-secret-{session_id}",
                    qr_expires_at=datetime.now(timezone.utc)+timedelta(hours=1),
                    latitude=0, longitude=0, radius_m=100,
                ))

        path = "/tenant/face/student/sessions/8115/face?college_id=81"
        image_file = {"file": ("capture.jpg", b"synthetic live capture", "image/jpeg")}

        foreign = self.client.post(
            path.replace("college_id=81", "college_id=82"),
            files=image_file,
        )
        closed = self.client.post(
            path.replace("8115", "8116"),
            files=image_file,
        )

        wrong_face = [0.0, 1.0] + [0.0] * 126
        with patch("app.api.tenant_face.embedding_from_image", return_value=wrong_face):
            face_mismatch = self.client.post(
                path,
                files=image_file,
                data={"latitude": "0", "longitude": "0.0002", "accuracy_m": "10"},
            )

        with patch("app.api.tenant_face.embedding_from_image", return_value=probe):
            # No student GPS fields: valid face verification should succeed.
            without_gps = self.client.post(path, files=image_file)

            # Even inaccurate or distant optional GPS form values do not govern face attendance.
            inaccurate_gps = self.client.post(
                path.replace("8115", "8117"),
                files=image_file,
                data={"latitude": "0", "longitude": "0.0002", "accuracy_m": "107"},
            )
            distant_gps = self.client.post(
                path.replace("8115", "8118"),
                files=image_file,
                data={"latitude": "0", "longitude": "0.002", "accuracy_m": "10"},
            )

        self.assertEqual(foreign.status_code, 403, foreign.text)
        self.assertEqual(closed.status_code, 400, closed.text)
        self.assertEqual(face_mismatch.status_code, 403, face_mismatch.text)
        self.assertIn("Face did not match", face_mismatch.text)

        self.assertEqual(without_gps.status_code, 200, without_gps.text)
        self.assertEqual(inaccurate_gps.status_code, 200, inaccurate_gps.text)
        self.assertEqual(distant_gps.status_code, 200, distant_gps.text)

        with self.Session() as db:
            for session_id in (8115, 8117, 8118):
                event = db.query(AttendanceEvent).filter_by(
                    session_id=session_id, student_id=8110,
                ).one()
                self.assertEqual(event.method, "face")
                self.assertEqual(event.status, "present")
                self.assertIsNone(event.latitude)
                self.assertIsNone(event.longitude)
                self.assertIsNone(event.distance_m)
if __name__ == "__main__":
    unittest.main()
