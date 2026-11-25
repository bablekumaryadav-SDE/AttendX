"""Behavior tests for tenant registration using synthetic in-memory SQLite."""

import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import (
    Class,
    College,
    CollegeMembership,
    FaceEmbedding,
    Student,
    StudentAcademicHistory,
    StudentGuardian,
    Subject,
    Teacher,
    TeacherAssignment,
    User,
)
from app.security import create_access_token
from pathlib import Path


class TenantRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

        @event.listens_for(self.engine, "connect")
        def _sqlite_fks(connection, _record):
            cursor = connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.Session.begin() as db:
            db.add_all([
                User(id=901, name="College Admin", email="admin-reg@example.com", hashed_password="synthetic", role="admin"),
                User(id=902, name="Teacher", email="teacher-reg@example.com", hashed_password="synthetic", role="teacher"),
                User(id=903, name="Second College Admin", email="admin-reg-b@example.com", hashed_password="synthetic", role="admin"),
                College(id=901, slug="reg-a", official_name="Registration A", status="active"),
                College(id=902, slug="reg-b", official_name="Registration B", status="active"),
            ])
            db.flush()
            db.add_all([
                CollegeMembership(user_id=901, college_id=901, role="college_admin", status="active"),
                CollegeMembership(user_id=902, college_id=901, role="teacher", status="active"),
                CollegeMembership(user_id=903, college_id=902, role="college_admin", status="active"),
                Class(id=901, college_id=901, name="A Class", is_active=True),
                Class(id=902, college_id=902, name="B Class", is_active=True),
                Subject(id=901, college_id=901, name="A Subject", code="AS-901", is_active=True),
                Subject(id=902, college_id=902, name="B Subject", code="BS-902", is_active=True),
            ])

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
    def headers(email="admin-reg@example.com"):
        return {"Authorization": f"Bearer {create_access_token({'sub': email, 'role': 'college_admin'})}"}

    def student_payload(self, **overrides):
        payload = {"name": "Test Student", "email": "new-student@example.com", "roll_number": "R-100",
                   "enrollment_number": "EN-100", "admission_year": 2024, "admission_session": "2024-2025",
                   "program_duration_years": 4, "current_academic_year": 1, "current_semester": 1,
                   "section": "A", "initial_class_id": 901, "father_name": "Parent",
                   "password": "SyntheticStudent!2026", "password_confirmation": "SyntheticStudent!2026"}
        payload.update(overrides)
        return payload

    def test_student_registration_creates_active_tenant_account_with_admin_set_password(self):
        response = self.client.post("/students/?college_id=901", headers=self.headers(), json=self.student_payload())
        self.assertEqual(response.status_code, 201, response.text)
        result = response.json()
        self.assertTrue(result["student_code"].startswith("ATX-"))
        self.assertEqual(result["admission_year"], 2024)
        self.assertEqual(result["current_academic_year"], 1)
        self.assertEqual(result["account_activation"], "active")
        self.assertEqual(result["invitation_status"], "not_required")
        self.assertNotIn("password", response.text)
        self.assertNotIn("hashed_password", response.text)
        profile = self.client.get(f"/students/{result['id']}?college_id=901", headers=self.headers())
        self.assertEqual(profile.status_code, 200, profile.text)
        self.assertEqual(profile.json()["father_name"], "Parent")
        self.assertNotIn("embedding_json", profile.text)
        with self.Session() as db:
            student = db.query(Student).filter_by(id=result["id"]).one()
            user = db.query(User).filter_by(email="new-student@example.com").one()
            membership = db.query(CollegeMembership).filter_by(user_id=user.id, college_id=901).one()
            self.assertEqual(student.college_id, 901)
            self.assertTrue(student.is_active)
            self.assertTrue(user.is_active)
            self.assertEqual(user.role, "student")
            self.assertEqual(membership.role, "student")
            self.assertEqual(membership.status, "active")
            self.assertEqual(db.query(StudentAcademicHistory).filter_by(student_id=student.id).count(), 1)
            guardian = db.query(StudentGuardian).filter_by(student_id=student.id).one()
            self.assertEqual(guardian.father_name, "Parent")
            self.assertEqual(db.query(FaceEmbedding).filter_by(student_id=student.id).count(), 0)

    def test_foreign_class_selection_is_rejected_without_creating_records(self):
        response = self.client.post("/students/?college_id=901", headers=self.headers(), json=self.student_payload(initial_class_id=902))
        self.assertEqual(response.status_code, 404)
        with self.Session() as db:
            self.assertEqual(db.query(Student).filter_by(email="new-student@example.com").count(), 0)

    def test_student_registration_requires_college_admin_membership(self):
        response = self.client.post("/students/?college_id=901", headers=self.headers("teacher-reg@example.com"), json=self.student_payload())
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client.post("/students/?college_id=902", headers=self.headers(), json=self.student_payload()).status_code, 403)
        self.assertEqual(self.client.post("/students/", json=self.student_payload()).status_code, 401)

    def test_duplicate_student_registration_returns_sanitized_conflict(self):
        first = self.client.post("/students/?college_id=901", headers=self.headers(), json=self.student_payload())
        duplicate = self.client.post("/students/?college_id=901", headers=self.headers(), json=self.student_payload())
        self.assertEqual(first.status_code, 201)
        self.assertEqual(duplicate.status_code, 409)
        self.assertNotIn("IntegrityError", duplicate.text)

    def test_enrollment_number_is_unique_within_college_not_globally(self):
        first = self.client.post("/students/?college_id=901", headers=self.headers(), json=self.student_payload())
        second_payload = self.student_payload(
            name="College B Student",
            email="new-student-b@example.com",
            roll_number="R-100-B",
            initial_class_id=902,
        )
        second = self.client.post(
            "/students/?college_id=902",
            headers={"Authorization": f"Bearer {create_access_token({'sub': 'admin-reg-b@example.com', 'role': 'college_admin'})}"},
            json=second_payload,
        )
        self.assertEqual(first.status_code, 201, first.text)
        self.assertEqual(second.status_code, 201, second.text)
        with self.Session() as db:
            rows = db.query(Student).filter(Student.enrollment_number == "EN-100").order_by(Student.college_id).all()
            self.assertEqual([row.college_id for row in rows], [901, 902])

    def test_enrollment_number_index_is_college_scoped_and_draft_matches(self):
        index = next(
            item for item in Student.__table__.indexes
            if item.name == "uq_students_college_enrollment_number"
        )
        self.assertTrue(index.unique)
        self.assertEqual([column.name for column in index.columns], ["college_id", "enrollment_number"])
        self.assertIn("college_id IS NOT NULL", str(index.dialect_options["sqlite"]["where"]))
        draft = Path(__file__).resolve().parents[2] / "database" / "migrations" / "DRAFT_20261111_student_teacher_registration_academics.sql"
        content = draft.read_text(encoding="utf-8")
        self.assertIn("CREATE UNIQUE INDEX uq_students_college_enrollment_number", content)
        self.assertIn("ON public.students (college_id, enrollment_number)", content)
        self.assertIn("WHERE college_id IS NOT NULL AND enrollment_number IS NOT NULL", content)

    def test_student_request_cannot_supply_role_or_alternate_college_and_invalid_phone_is_rejected(self):
        injected = self.student_payload(role="college_admin")
        self.assertEqual(self.client.post("/students/?college_id=901", headers=self.headers(), json=injected).status_code, 422)
        invalid_phone = self.student_payload(parent_mobile="12")
        self.assertEqual(self.client.post("/students/?college_id=901", headers=self.headers(), json=invalid_phone).status_code, 422)
        self.assertEqual(self.client.post("/students/?college_id=902", headers=self.headers(), json=self.student_payload()).status_code, 403)

    def test_promotion_preserves_admission_year_and_records_history(self):
        created = self.client.post("/students/?college_id=901", headers=self.headers(), json=self.student_payload()).json()
        response = self.client.post(f"/students/{created['id']}/promotions?college_id=901", headers=self.headers(), json={
            "current_academic_year": 2, "current_semester": 3, "section": "B", "reason": "Completed prior review",
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["admission_year"], 2024)
        self.assertEqual(response.json()["current_academic_year"], 2)
        history = self.client.get(f"/students/{created['id']}/academic-history?college_id=901", headers=self.headers())
        self.assertEqual(history.status_code, 200)
        self.assertEqual([row["action"] for row in history.json()], ["admitted", "promoted"])
        self.assertEqual(history.json()[0]["admission_year"], 2024)

    def test_teacher_registration_validates_and_persists_only_same_college_assignments(self):
        payload = {"name": "New Teacher", "email": "new-teacher@example.com",
                   "department": "Science", "designation": "Lecturer", "qualification": "MSc",
                   "password": "SyntheticTeacher!2026", "password_confirmation": "SyntheticTeacher!2026",
                   "assignments": [{"class_id": 901, "subject_id": 901, "academic_year": "2026-2027", "semester": 1}]}
        response = self.client.post("/teachers/?college_id=901", headers=self.headers(), json=payload)
        self.assertEqual(response.status_code, 201, response.text)
        self.assertGreater(response.json()["id"], 0)
        self.assertEqual(response.json()["account_activation"], "active")
        self.assertEqual(response.json()["invitation_status"], "not_required")
        self.assertNotIn("password", response.text)
        self.assertNotIn("hashed_password", response.text)
        with self.Session() as db:
            teacher = db.query(Teacher).filter_by(email="new-teacher@example.com").one()
            self.assertEqual(teacher.college_id, 901)
            self.assertTrue(teacher.is_active)
            user = db.query(User).filter_by(email=teacher.email).one()
            self.assertTrue(user.is_active)
            self.assertEqual(db.query(CollegeMembership).filter_by(user_id=user.id, college_id=901).one().status, "active")
            self.assertEqual(db.query(TeacherAssignment).filter_by(teacher_id=teacher.id, college_id=901).count(), 1)

    def test_teacher_registration_rejects_cross_college_assignment_and_non_admin(self):
        payload = {"name": "Cross Teacher", "email": "cross-teacher@example.com",
                   "password": "SyntheticTeacher!2026", "password_confirmation": "SyntheticTeacher!2026",
                   "assignments": [{"class_id": 902, "subject_id": 902, "academic_year": "2026-2027", "semester": 1}]}
        response = self.client.post("/teachers/?college_id=901", headers=self.headers(), json=payload)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.client.post("/teachers/?college_id=901", headers=self.headers("teacher-reg@example.com"), json=payload).status_code, 403)
        with self.Session() as db:
            self.assertEqual(db.query(Teacher).filter_by(email="cross-teacher@example.com").count(), 0)

    def test_unreviewed_student_and_teacher_mutations_stay_default_denied(self):
        headers = self.headers()
        for method, path in (("put", "/students/123"),
                             ("put", "/teachers/123"),
                             ("post", "/students/123/face"), ("put", "/students/123/class-assignment")):
            request = getattr(self.client, method)
            response = request(path, headers=headers, json={}) if method != "delete" else request(path, headers=headers)
            self.assertEqual(response.status_code, 503, response.text)

    def test_registration_draft_is_additive_and_unapplied(self):
        draft = Path(__file__).resolve().parents[2] / "database" / "migrations" / "DRAFT_20261111_student_teacher_registration_academics.sql"
        content = draft.read_text(encoding="utf-8").lower()
        self.assertIn("status: draft / not applied", content)
        self.assertIn("alter table public.students", content)
        self.assertIn("create table public.student_academic_history", content)
        self.assertIn("foreign key (student_id, college_id)", content)
        self.assertNotRegex(content, r"\binsert\s+into\s+public\.(students|teachers|colleges|college_memberships)\b")
        self.assertNotRegex(content, r"\b(update|delete|drop)\s+(from\s+)?public\.(students|teachers|colleges|college_memberships)\b")


if __name__ == "__main__":
    unittest.main()
