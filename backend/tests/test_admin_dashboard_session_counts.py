"""Admin attendance statistics include legacy rows and session events."""
import unittest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.dependencies import get_current_user
from app.main import app


class AdminDashboardAttendanceCountTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)

        def override_db():
            with self.Session() as session:
                yield session

        app.dependency_overrides.clear()
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_user] = lambda: {
            "sub": "900", "id": 900, "email": "admin@example.org", "role": "admin",
        }
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        self.engine.dispose()

    def test_legacy_admin_dashboard_is_blocked_until_tenant_summary_is_used(self):
        response = self.client.get("/admin-dashboard")
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(response.json(), {
            "detail": "This business API is unavailable until College-scoped authorization is enabled."
        })


if __name__ == "__main__":
    unittest.main()
