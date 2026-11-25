"""Synthetic SQLite tests for the recipient-scoped tenant notification inbox."""

import os
import unittest
from datetime import datetime, timezone

os.environ["ATTENDX_SKIP_DOTENV"] = "1"
os.environ["ATTENDX_TEST_SQLALCHEMY_URL"] = "sqlite://"
os.environ["SECRET_KEY"] = "synthetic-tenant-notification-tests-only"

from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from app import models  # noqa: F401
from app.api.tenant_notifications import (
    list_notifications,
    mark_all_notifications_read,
    mark_notification_read,
    unread_notification_count,
)
from app.database import Base
from app.models import College, CollegeMembership, NotificationEvent, User


class TenantNotificationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")

        @event.listens_for(self.engine, "connect")
        def enable_foreign_keys(connection, _record):
            connection.create_function(
                "clock_timestamp", 0,
                lambda: datetime.now(timezone.utc).isoformat(sep=" "),
            )
            connection.execute("PRAGMA foreign_keys=ON")

        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.college = College(slug="notification-test", official_name="Notification Test", status="active")
        self.other_college = College(slug="notification-other", official_name="Other College", status="active")
        self.recipient = User(name="Recipient", email="recipient@example.invalid", hashed_password="synthetic", role="college_admin", is_active=True)
        self.other_user = User(name="Other", email="other@example.invalid", hashed_password="synthetic", role="college_admin", is_active=True)
        self.db.add_all([self.college, self.other_college, self.recipient, self.other_user])
        self.db.flush()
        self.db.add_all([
            CollegeMembership(user_id=self.recipient.id, college_id=self.college.id, role="college_admin", status="active"),
            CollegeMembership(user_id=self.other_user.id, college_id=self.college.id, role="college_admin", status="active"),
        ])
        self.event = NotificationEvent(
            college_id=self.college.id,
            user_id=self.recipient.id,
            event_type="account_notice",
            channel="in_app",
            title="Account notice",
            message="Synthetic notification for isolated testing.",
            delivery_status="queued",
            idempotency_key="tenant-notification-test-1",
        )
        self.db.add(self.event)
        self.db.commit()
        self.recipient_context = {"id": self.recipient.id, "role": "college_admin"}
        self.other_context = {"id": self.other_user.id, "role": "college_admin"}

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_inbox_is_recipient_scoped_and_read_is_idempotent(self):
        page = list_notifications(self.college.id, None, None, 25, 0, self.db, self.recipient_context)
        self.assertEqual((page.total, len(page.items)), (1, 1))
        self.assertEqual(unread_notification_count(self.college.id, self.db, self.recipient_context).unread_count, 1)
        saved = mark_notification_read(page.items[0].id, self.college.id, self.db, self.recipient_context)
        self.assertIsNotNone(saved.read_at)
        self.assertEqual(unread_notification_count(self.college.id, self.db, self.recipient_context).unread_count, 0)
        self.assertEqual(mark_all_notifications_read(self.college.id, self.db, self.recipient_context), {"updated": 0})

    def test_another_member_cannot_read_a_recipient_notification(self):
        with self.assertRaises(HTTPException) as denied:
            mark_notification_read(self.event.id, self.college.id, self.db, self.other_context)
        self.assertEqual(denied.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
