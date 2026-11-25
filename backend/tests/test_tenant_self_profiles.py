"""HTTP-level self-profile contract tests over synthetic in-memory SQLite."""

import os
import asyncio
import json
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

os.environ["ATTENDX_SKIP_DOTENV"] = "1"
os.environ["ATTENDX_TEST_SQLALCHEMY_URL"] = "sqlite://"
os.environ["SECRET_KEY"] = "synthetic-self-profile-test-secret-key"

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.dependencies import get_current_user
from app.main import app
from app.models import (
    College,
    CollegeMembership,
    Student,
    StudentAccountLink,
    Teacher,
    TeacherAccountLink,
    TeacherProfileVerification,
    User,
)


class TenantSelfProfileHttpTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        @event.listens_for(self.engine, "connect")
        def enable_foreign_keys(connection, _record):
            cursor = connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.Session.begin() as db:
            college = College(id=950, slug="self-profile-college", official_name="Self Profile College", display_name="SPC", status="active")
            teacher_user = User(id=9501, name="Teacher Login", email="self-teacher@example.test", hashed_password="synthetic", role="teacher", is_active=True)
            student_user = User(id=9502, name="Student Login", email="self-student@example.test", hashed_password="synthetic", role="student", is_active=True)
            admin_user = User(id=9503, name="College Admin", email="self-admin@example.test", hashed_password="synthetic", role="college_admin", is_active=True)
            db.add_all([college, teacher_user, student_user, admin_user])
            db.flush()
            db.add_all([
                CollegeMembership(user_id=teacher_user.id, college_id=college.id, role="teacher", status="active"),
                CollegeMembership(user_id=student_user.id, college_id=college.id, role="student", status="active"),
                CollegeMembership(user_id=admin_user.id, college_id=college.id, role="college_admin", status="active"),
            ])
            db.flush()
            teacher = Teacher(id=951, college_id=college.id, name="Linked Teacher", email="teacher-profile@example.test", employee_id="T-951", department="Science", designation="Lecturer", qualification="MSc", is_active=True)
            student = Student(id=952, college_id=college.id, name="Linked Student", email="student-profile@example.test", roll_number="S-952", course="CSE", current_academic_year=2, current_semester=3, is_active=True)
            db.add_all([teacher, student])
            db.flush()
            db.add_all([
                TeacherAccountLink(teacher_id=teacher.id, user_id=teacher_user.id, college_id=college.id, link_status="active", verified_by_user_id=admin_user.id, verified_at=datetime.now(timezone.utc), created_at=datetime.now(timezone.utc)),
                TeacherProfileVerification(
                    teacher_id=teacher.id,
                    college_id=college.id,
                    verification_status="verified",
                    verified_by_admin_id=admin_user.id,
                    verified_at=datetime.now(timezone.utc),
                    verification_reason="Synthetic institutional record review.",
                ),
                StudentAccountLink(student_id=student.id, user_id=student_user.id, college_id=college.id, link_status="active", verified_by_user_id=admin_user.id, verified_at=datetime.now(timezone.utc), created_at=datetime.now(timezone.utc)),
            ])

        def override_db():
            with self.Session() as db:
                yield db

        app.dependency_overrides.clear()
        app.dependency_overrides[get_db] = override_db

    def tearDown(self):
        app.dependency_overrides.clear()
        self.engine.dispose()

    def get(self, path, email):
        with self.Session() as db:
            user = db.query(User).filter(User.email == email).one()
            principal = SimpleNamespace(id=user.id)
        app.dependency_overrides[get_current_user] = lambda: principal

        async def request():
            body = []
            started = {}
            messages = [{"type": "http.request", "body": b"", "more_body": False}]
            async def receive():
                return messages.pop(0) if messages else {"type": "http.disconnect"}
            async def send(message):
                if message["type"] == "http.response.start":
                    started.update(message)
                elif message["type"] == "http.response.body":
                    body.append(message.get("body", b""))
            scope = {
                "type": "http", "asgi": {"version": "3.0", "spec_version": "2.3"},
                "http_version": "1.1", "method": "GET", "scheme": "http",
                "path": path.split("?", 1)[0], "raw_path": path.split("?", 1)[0].encode(),
                "query_string": path.split("?", 1)[1].encode() if "?" in path else b"",
                "root_path": "", "headers": [(b"host", b"testserver")],
                "client": ("127.0.0.1", 12345), "server": ("testserver", 80), "state": {},
            }
            await app(scope, receive, send)
            payload = b"".join(body)
            return started.get("status"), json.loads(payload) if payload else None

        return asyncio.run(request())

    def test_teacher_gets_only_the_profile_from_their_verified_link(self):
        status_code, payload = self.get("/teachers/me/profile?college_id=950", "self-teacher@example.test")
        self.assertEqual(status_code, 200, payload)
        self.assertEqual(payload["id"], 951)
        self.assertEqual(payload["college_id"], 950)
        self.assertEqual(payload["college_name"], "SPC")
        self.assertEqual(payload["employee_id"], "T-951")

    def test_teacher_profile_requires_teacher_membership_and_verified_link(self):
        self.assertEqual(self.get("/teachers/me/profile?college_id=950", "self-admin@example.test")[0], 403)
        with self.Session.begin() as db:
            db.query(TeacherAccountLink).delete()
        status_code, payload = self.get("/teachers/me/profile?college_id=950", "self-teacher@example.test")
        self.assertEqual(status_code, 403)
        self.assertIn("verified Teacher profile link", payload["detail"])

    def test_student_gets_only_the_profile_from_their_verified_link(self):
        status_code, payload = self.get("/tenant/face/student/profile?college_id=950", "self-student@example.test")
        self.assertEqual(status_code, 200, payload)
        self.assertEqual(payload["id"], 952)
        self.assertEqual(payload["college_id"], 950)
        self.assertEqual(payload["college_name"], "SPC")
        self.assertEqual(payload["course"], "CSE")

    def test_student_profile_requires_verified_link_and_rejects_other_college(self):
        self.assertEqual(self.get("/tenant/face/student/profile?college_id=951", "self-student@example.test")[0], 403)
        with self.Session.begin() as db:
            db.query(StudentAccountLink).delete()
        status_code, payload = self.get("/tenant/face/student/profile?college_id=950", "self-student@example.test")
        self.assertEqual(status_code, 403)
        self.assertIn("verified Student profile link", payload["detail"])


if __name__ == "__main__":
    unittest.main()
