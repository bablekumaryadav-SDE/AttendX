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

    def test_unpersisted_admin_cannot_enter_tenant_class_management(self):
        class_response = self.client.post("/classes/", json={
            "name": "Computer Science",
            "section": "A",
            "department": "CSE",
            "semester": 7,
            "academic_year": "2026-27",
        })
        self.assertEqual(class_response.status_code, 401, class_response.text)
        self.assertEqual(class_response.json(), {"detail": "Active account required."})

    def test_unpersisted_admin_cannot_create_tenant_classroom_configuration(self):
        created = self.client.post("/classes/", json={
            "name": "GIS Classroom",
            "section": "G",
            "academic_year": "2026-27",
            "location_name": "North Building Room 4",
            "latitude": 28.6139,
            "longitude": 77.2090,
            "radius_m": 125,
        })
        self.assertEqual(created.status_code, 401, created.text)
        self.assertEqual(created.json(), {"detail": "Active account required."})


if __name__ == "__main__":
    unittest.main()
