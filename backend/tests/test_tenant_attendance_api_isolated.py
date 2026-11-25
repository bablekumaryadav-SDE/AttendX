"""Tenant attendance behavior tests over synthetic in-memory SQLite only."""

import unittest
from datetime import datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import (
    Attendance,
    AttendanceRecord,
    Class,
    College,
    CollegeMembership,
    Student,
    StudentClassAssignment,
    Subject,
    Teacher,
    TeacherAssignment,
    User,
)
from app.security import create_access_token


class TenantAttendanceApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        now = datetime(2026, 1, 2, tzinfo=timezone.utc)
        with self.Session.begin() as db:
            db.add_all([
                User(id=5101, name="A admin", email="attendance-a@example.test", hashed_password="x", role="admin"),
                User(id=5102, name="B admin", email="attendance-b@example.test", hashed_password="x", role="admin"),
                User(id=5103, name="Multi admin", email="attendance-multi@example.test", hashed_password="x", role="admin"),
                User(id=5104, name="Wrong role", email="attendance-role@example.test", hashed_password="x", role="teacher"),
                User(id=5105, name="Inactive member", email="attendance-inactive@example.test", hashed_password="x", role="admin"),
                User(id=5106, name="No membership", email="attendance-none@example.test", hashed_password="x", role="admin"),
                College(id=151, slug="attendance-a", official_name="Attendance A", status="active"),
                College(id=152, slug="attendance-b", official_name="Attendance B", status="active"),
                College(id=153, slug="attendance-suspended", official_name="Suspended", status="suspended"),
            ])
            db.flush()
            db.add_all([
                CollegeMembership(user_id=5101, college_id=151, role="college_admin", status="active"),
                CollegeMembership(user_id=5102, college_id=152, role="college_admin", status="active"),
                CollegeMembership(user_id=5103, college_id=151, role="college_admin", status="active"),
                CollegeMembership(user_id=5103, college_id=152, role="college_admin", status="active"),
                CollegeMembership(user_id=5104, college_id=151, role="teacher", status="active"),
                CollegeMembership(user_id=5101, college_id=153, role="college_admin", status="active"),
                CollegeMembership(user_id=5105, college_id=151, role="college_admin", status="suspended"),
                Student(id=1511, college_id=151, name="A Student", email="s-a@example.test", roll_number="A-1", is_active=True),
                Student(id=1519, college_id=151, name="Unenrolled A Student", email="s-a2@example.test", roll_number="A-2", is_active=True),
                Student(id=1521, college_id=152, name="B Student", email="s-b@example.test", roll_number="B-1", is_active=True),
                Student(id=1531, college_id=None, name="Unknown Student", email="s-u@example.test", roll_number="U-1", is_active=True),
                Teacher(id=1512, college_id=151, name="A Teacher", email="t-a@example.test", employee_id="TA", is_active=True),
                Teacher(id=1519, college_id=151, name="Unassigned A Teacher", email="t-a2@example.test", employee_id="TA2", is_active=True),
                Teacher(id=1522, college_id=152, name="B Teacher", email="t-b@example.test", employee_id="TB", is_active=True),
                Subject(id=1513, college_id=151, name="A Subject", code="SA", is_active=True),
                Subject(id=1523, college_id=152, name="B Subject", code="SB", is_active=True),
                Class(id=1514, college_id=151, name="A Class", is_active=True),
                Class(id=1524, college_id=152, name="B Class", is_active=True),
                TeacherAssignment(id=1517, college_id=151, teacher_id=1512, subject_id=1513, class_id=1514, is_active=True),
                TeacherAssignment(id=1527, college_id=152, teacher_id=1522, subject_id=1523, class_id=1524, is_active=True),
                StudentClassAssignment(id=1518, college_id=151, student_id=1511, class_id=1514, is_active=True),
                StudentClassAssignment(id=1528, college_id=152, student_id=1521, class_id=1524, is_active=True),
                Attendance(id=1515, college_id=151, student_id=1511, teacher_id=1512, date=now, status="present"),
                Attendance(id=1525, college_id=152, student_id=1521, teacher_id=1522, date=now, status="late"),
                Attendance(id=1535, college_id=None, student_id=1531, teacher_id=1512, date=now, status="absent"),
                AttendanceRecord(id=1516, college_id=151, student_id=1511, teacher_id=1512, subject_id=1513, class_id=1514, attendance_date=now, status="present", remarks="private remark"),
                AttendanceRecord(id=1526, college_id=152, student_id=1521, teacher_id=1522, subject_id=1523, class_id=1524, attendance_date=now, status="late"),
                AttendanceRecord(id=1536, college_id=None, student_id=1531, teacher_id=1512, subject_id=1513, class_id=1514, attendance_date=now, status="absent"),
                AttendanceRecord(id=1556, college_id=151, student_id=1519, teacher_id=1512, subject_id=1513, class_id=1514, attendance_date=now, status="present"),
                AttendanceRecord(id=1557, college_id=151, student_id=1511, teacher_id=1519, subject_id=1513, class_id=1514, attendance_date=now, status="present"),
            ])
            db.flush()
            # Simulate data written before/without the unapplied composite FKs.
            db.execute(text("INSERT INTO attendance (id, college_id, student_id, teacher_id, date, status) VALUES (1545, 151, 1521, 1512, :d, 'present')"), {"d": now})
            db.execute(text("INSERT INTO attendance_records (id, college_id, student_id, teacher_id, subject_id, class_id, attendance_date, status, remarks) VALUES (1546, 151, 1511, 1512, 1523, 1514, :d, 'present', 'inconsistent')"), {"d": now})

        def override_db():
            with self.Session() as db:
                yield db

        app.dependency_overrides.clear()
        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        self.engine.dispose()

    @staticmethod
    def headers(email):
        return {"Authorization": f"Bearer {create_access_token({'sub': email, 'role': 'admin'})}"}

    def test_all_attendance_reads_require_authentication(self):
        for path in ("/attendance/", "/attendance/1515", "/attendance-records/", "/attendance-records/1516"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 401)

    def test_only_active_college_admin_membership_can_read(self):
        self.assertEqual(self.client.get("/attendance/", headers=self.headers("attendance-b@example.test")).status_code, 200)
        for email in ("attendance-role@example.test", "attendance-inactive@example.test", "attendance-none@example.test"):
            response = self.client.get("/attendance/", headers=self.headers(email))
            self.assertEqual(response.status_code, 403)
        suspended = self.client.get("/attendance/", headers=self.headers("attendance-a@example.test"), params={"college_id": 153})
        self.assertEqual(suspended.status_code, 403)

    def test_ambiguous_membership_requires_selected_college_and_foreign_selection_denied(self):
        headers = self.headers("attendance-multi@example.test")
        self.assertEqual(self.client.get("/attendance/", headers=headers).status_code, 409)
        self.assertEqual(self.client.get("/attendance-records/", headers=headers).status_code, 409)
        self.assertEqual(self.client.get("/attendance/?college_id=152", headers=headers).status_code, 200)
        self.assertEqual(self.client.get("/attendance/?college_id=999", headers=headers).status_code, 403)
        college_a = self.headers("attendance-a@example.test")
        self.assertEqual(self.client.get("/attendance/?college_id=152", headers=college_a).status_code, 403)
        self.assertEqual(self.client.get("/attendance-records/?college_id=152", headers=college_a).status_code, 403)

    def test_attendance_list_filters_college_null_and_inconsistent_parents(self):
        response = self.client.get("/attendance/?college_id=151", headers=self.headers("attendance-a@example.test"))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([row["id"] for row in response.json()], [1515])
        self.assertNotIn("college_id", response.json()[0])

    def test_record_list_requires_same_college_parents_and_owned_assignment_enrollment_links(self):
        response = self.client.get("/attendance-records/?college_id=151", headers=self.headers("attendance-a@example.test"))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([row["id"] for row in response.json()], [1516])
        self.assertNotIn("remarks", response.json()[0])
        self.assertNotIn("college_id", response.json()[0])

    def test_foreign_missing_unknown_and_inconsistent_detail_ids_share_sanitized_404(self):
        headers = self.headers("attendance-a@example.test")
        for path in ("/attendance/1525?college_id=151", "/attendance/1535?college_id=151", "/attendance/1545?college_id=151", "/attendance/9999?college_id=151"):
            response = self.client.get(path, headers=headers)
            self.assertEqual((response.status_code, response.json()), (404, {"detail": "Record not found."}))
        for path in ("/attendance-records/1526?college_id=151", "/attendance-records/1536?college_id=151", "/attendance-records/1546?college_id=151", "/attendance-records/9999?college_id=151"):
            response = self.client.get(path, headers=headers)
            self.assertEqual((response.status_code, response.json()), (404, {"detail": "Record not found."}))

    def test_detail_returns_only_minimal_safe_fields(self):
        headers = self.headers("attendance-a@example.test")
        for path in ("/attendance/1515?college_id=151", "/attendance-records/1516?college_id=151"):
            response = self.client.get(path, headers=headers)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertNotIn("remarks", response.json())
            self.assertFalse({"qr_secret", "confidence", "latitude", "longitude", "device_hash", "verification_reason", "image_data", "embedding_json", "hashed_password", "email", "college_id"} & set(response.json()))

    def test_missing_ownership_schema_fails_closed_and_writes_sessions_stay_blocked(self):
        with self.engine.begin() as connection:
            connection.execute(text("DROP TABLE attendance"))
        headers = self.headers("attendance-a@example.test")
        attendance_response = self.client.get("/attendance/", headers=headers)
        self.assertEqual(attendance_response.status_code, 503, attendance_response.text)
        self.assertEqual(attendance_response.json(), {"detail": "College-scoped attendance history is unavailable."})
        with self.engine.begin() as connection:
            connection.execute(text("DROP TABLE attendance_records"))
        response = self.client.get("/attendance-records/", headers=headers)
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(response.json(), {"detail": "College-scoped attendance records are unavailable."})
        for response in (
            self.client.post("/attendance/", headers=headers, json={}),
            self.client.put("/attendance/1515", headers=headers, json={}),
            self.client.delete("/attendance/1515", headers=headers),
            self.client.post("/attendance/sessions", headers=headers, json={}),
            self.client.get("/attendance/sessions/1515/live", headers=headers),
            self.client.post("/attendance-records/", headers=headers, json={}),
            self.client.get("/assignments/", headers=headers),
        ):
            self.assertEqual(response.status_code, 503, response.text)


if __name__ == "__main__":
    unittest.main()
