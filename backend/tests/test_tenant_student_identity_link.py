"""Focused synthetic SQLite tests for verified Student profile resolution."""

import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.tenant_face import _student_for_self
from app.database import Base
from app.models import College, CollegeMembership, Student, StudentAccountLink, User


class StudentIdentityLinkTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        now = datetime.now(timezone.utc)
        with self.Session.begin() as db:
            db.add_all([
                College(id=901, slug="identity-test", official_name="Synthetic College", status="active"),
                User(id=902, name="Synthetic Student", email="same@example.invalid", hashed_password="test-only", role="student", is_active=True),
                User(id=903, name="Synthetic Verifier", email="admin@example.invalid", hashed_password="test-only", role="admin", is_active=True),
            ])
            db.flush()
            db.add_all([
                CollegeMembership(user_id=902, college_id=901, role="student", status="active"),
                CollegeMembership(user_id=903, college_id=901, role="college_admin", status="active"),
                Student(id=904, college_id=901, name="Profile with same email", email="same@example.invalid", roll_number="SYN-1", is_active=True),
                StudentAccountLink(id=905, student_id=904, user_id=902, college_id=901,
                                   link_status="active", verified_by_user_id=903,
                                   verified_at=now, created_at=now),
            ])
        self.db = self.Session()
        self.context = SimpleNamespace(user_id=902, college_id=901)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_active_explicit_link_resolves_student_profile(self):
        self.assertEqual(_student_for_self(self.db, self.context).id, 904)

    def test_matching_email_without_link_is_denied(self):
        self.db.query(StudentAccountLink).filter_by(user_id=902, college_id=901).delete()
        self.db.commit()
        with self.assertRaises(HTTPException) as denied:
            _student_for_self(self.db, self.context)
        self.assertEqual(denied.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
