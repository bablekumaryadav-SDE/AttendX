"""Isolated admin CRUD integration tests using only in-memory SQLite."""
import unittest
from datetime import datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.dependencies import get_current_user
from app.main import app
from app.services import student_module


class Principal(dict):
    def __getattr__(self, key):
        try:
            return self[key]
        except KeyError as exc:
            raise AttributeError(key) from exc


class AdminCrudIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.original_student_engine = student_module.engine
        student_module.engine = self.engine

        def override_db():
            with self.Session() as session:
                yield session

        app.dependency_overrides.clear()
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_user] = lambda: Principal(
            sub="900",
            id=900,
            email="admin@example.test",
            role="admin",
            is_active=True,
        )
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        student_module.engine = self.original_student_engine
        self.engine.dispose()

    def test_admin_crud_and_dashboard_statistics_persist_in_isolated_database(self):
        class_response = self.client.post("/classes/", json={
            "name": "Computer Science",
            "section": "A",
            "department": "CSE",
            "semester": 7,
            "academic_year": "2026-27",
        })
        self.assertEqual(class_response.status_code, 201, class_response.text)
        class_id = class_response.json()["id"]
        self.assertEqual(self.client.put(f"/classes/{class_id}", json={"section": "B"}).status_code, 200)

        subject_response = self.client.post("/subjects/", json={
            "name": "Distributed Systems", "code": " ds-701 ", "department": "CSE",
        })
        self.assertEqual(subject_response.status_code, 201, subject_response.text)
        subject_id = subject_response.json()["id"]
        self.assertEqual(subject_response.json()["code"], "DS-701")
        self.assertEqual(self.client.put(f"/subjects/{subject_id}", json={"name": "Distributed Computing"}).status_code, 200)

        teacher_response = self.client.post("/teachers/", json={
            "name": "Test Teacher", "email": "teacher@example.org",
            "employee_id": "T-701", "department": "CSE", "password": "temporary-test-password",
        })
        self.assertEqual(teacher_response.status_code, 201, teacher_response.text)
        teacher_id = teacher_response.json()["id"]
        self.assertEqual(self.client.put(f"/teachers/{teacher_id}", json={
            "name": "Updated Teacher", "email": "teacher@example.org",
            "employee_id": "T-701", "department": "CSE",
        }).status_code, 200)

        student_response = self.client.post("/students/", json={
            "name": "Test Student", "email": "student@example.org",
            "password": "temporary-test-password", "roll_number": "S-701", "department": "CSE",
        })
        self.assertEqual(student_response.status_code, 201, student_response.text)
        student_id = student_response.json()["id"]
        self.assertEqual(self.client.put(f"/students/{student_id}", json={"name": "Updated Student"}).status_code, 200)
        self.assertEqual(self.client.put(f"/students/{student_id}/class-assignment", json={
            "class_id": class_id, "academic_year": "2026-27", "semester": 7,
        }).status_code, 200)

        assignment_response = self.client.post("/assignments/", json={
            "teacher_id": teacher_id, "subject_id": subject_id,
            "class_id": class_id, "academic_year": "2026-27", "semester": 7,
        })
        self.assertEqual(assignment_response.status_code, 201, assignment_response.text)
        assignment_id = assignment_response.json()["id"]
        self.assertEqual(self.client.get("/assignments/").status_code, 200)
        self.assertEqual(self.client.put(f"/assignments/{assignment_id}", json={"is_active": False}).status_code, 200)
        self.assertEqual(self.client.put(f"/assignments/{assignment_id}", json={"is_active": True}).status_code, 200)

        record_response = self.client.post("/attendance-records/", json={
            "student_id": student_id, "teacher_id": teacher_id,
            "subject_id": subject_id, "class_id": class_id,
            "attendance_date": datetime.now(timezone.utc).isoformat(),
            "status": "late", "remarks": "isolated fixture",
        })
        self.assertEqual(record_response.status_code, 201, record_response.text)
        record_id = record_response.json()["id"]
        self.assertEqual(self.client.get("/attendance-records/").status_code, 200)

        dashboard_response = self.client.get("/admin-dashboard")
        self.assertEqual(dashboard_response.status_code, 200, dashboard_response.text)
        dashboard = dashboard_response.json()
        self.assertEqual(dashboard["total_students"], 1)
        self.assertEqual(dashboard["total_teachers"], 1)
        self.assertEqual(dashboard["total_classes"], 1)
        self.assertEqual(dashboard["total_subjects"], 1)
        self.assertEqual(dashboard["total_attendance_records"], 1)

        self.assertEqual(self.client.delete(f"/attendance-records/{record_id}").status_code, 200)
        self.assertEqual(self.client.delete(f"/assignments/{assignment_id}").status_code, 200)
        self.assertEqual(self.client.delete(f"/students/{student_id}").status_code, 200)
        self.assertEqual(self.client.post(f"/students/{student_id}/activate").status_code, 200)
        self.assertEqual(self.client.delete(f"/teachers/{teacher_id}").status_code, 200)
        self.assertEqual(self.client.post(f"/teachers/{teacher_id}/activate").status_code, 200)
        self.assertEqual(self.client.delete(f"/subjects/{subject_id}").status_code, 200)
        self.assertEqual(self.client.delete(f"/classes/{class_id}").status_code, 200)

        with self.Session() as session:
            self.assertEqual(session.query(student_module.Student).count(), 1)
            self.assertTrue(session.query(student_module.Student).one().is_active)


if __name__ == "__main__":
    unittest.main()
