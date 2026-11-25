"""Synthetic SQLite handler tests for tenant teacher session ownership."""

import unittest
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.api.tenant_attendance_sessions import (
    close_session,
    create_session,
    get_qr,
    list_tenant_attendance_events,
    list_sessions,
    my_teacher_assignments,
    read_tenant_attendance_event,
    refresh_qr,
)
from app.api.tenant_face import my_attendance, submit_qr_attendance
from app.api.tenant_dashboard import attendance_summary
from app.models import (
    AttendanceEvent,
    AttendanceSession,
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
from app.schemas.attendance_gis import AttendanceSessionGISCreate
from app.schemas.attendance_gis import StudentQrAttendanceGISRequest
from app.services.attendance_core import verify_current_qr_token


class TenantAttendanceSessionTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.now = datetime.now(timezone.utc)
        with self.Session.begin() as db:
            db.add_all([
                User(id=1, name="Teacher", email="teacher@a.test", hashed_password="x", role="teacher", is_active=True),
                User(id=2, name="Other Teacher", email="teacher@b.test", hashed_password="x", role="teacher", is_active=True),
                User(id=3, name="College Admin", email="admin@a.test", hashed_password="x", role="admin", is_active=True),
                User(id=4, name="Student", email="student@a.test", hashed_password="x", role="student", is_active=True),
                College(id=10, slug="college-a", official_name="College A", status="active"),
                College(id=20, slug="college-b", official_name="College B", status="active"),
            ])
            db.flush()
            db.add_all([
                CollegeMembership(user_id=1, college_id=10, role="teacher", status="active"),
                CollegeMembership(user_id=2, college_id=20, role="teacher", status="active"),
                CollegeMembership(user_id=3, college_id=10, role="college_admin", status="active"),
                CollegeMembership(user_id=4, college_id=10, role="student", status="active"),
                Teacher(id=101, college_id=10, name="Teacher", email="teacher@a.test", employee_id="T-A", is_active=True),
                Teacher(id=201, college_id=20, name="Other Teacher", email="teacher@b.test", employee_id="T-B", is_active=True),
                Class(id=301, college_id=10, name="Class A", is_active=True, radius_m=100),
                Class(id=401, college_id=20, name="Class B", is_active=True, radius_m=100),
                Subject(id=501, college_id=10, name="Subject A", code="SUB-A", is_active=True),
                Subject(id=601, college_id=20, name="Subject B", code="SUB-B", is_active=True),
                Student(id=701, college_id=10, name="Student A", email="student@a.test", roll_number="R-A", student_code="S-A", is_active=True),
                TeacherAssignment(id=801, college_id=10, teacher_id=101, class_id=301, subject_id=501, is_active=True),
                StudentClassAssignment(id=901, college_id=10, student_id=701, class_id=301, is_active=True),
            ])
        self.db = self.Session()
        self.teacher = self.db.query(User).filter(User.id == 1).one()
        self.other_teacher = self.db.query(User).filter(User.id == 2).one()
        self.admin = self.db.query(User).filter(User.id == 3).one()
        self.student_user = self.db.query(User).filter(User.id == 4).one()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def payload(self, *, class_id=301, subject_id=501):
        return AttendanceSessionGISCreate(
            subject_id=subject_id,
            class_id=class_id,
            title="Lecture 1",
            starts_at=self.now - timedelta(minutes=1),
            ends_at=self.now + timedelta(minutes=40),
        )

    def test_assignment_listing_and_session_creation_are_college_and_assignment_scoped(self):
        assignments = my_teacher_assignments(10, self.db, self.teacher)
        self.assertEqual([row["id"] for row in assignments], [801])
        session = create_session(self.payload(), 10, self.db, self.teacher)
        stored = self.db.query(AttendanceSession).filter(AttendanceSession.id == session["id"]).one()
        self.assertEqual(stored.college_id, 10)
        self.assertNotIn("qr_secret", session)
        self.assertEqual(len(list_sessions(10, self.db, self.teacher)), 1)
        with self.assertRaises(HTTPException) as denied:
            create_session(self.payload(class_id=401, subject_id=601), 10, self.db, self.teacher)
        self.assertEqual(denied.exception.status_code, 404)
        with self.assertRaises(HTTPException) as denied_wrong_college:
            list_sessions(20, self.db, self.teacher)
        self.assertEqual(denied_wrong_college.exception.status_code, 403)

    def test_qr_rotation_and_session_close_finalize_only_owned_roster(self):
        payload = create_session(self.payload(), 10, self.db, self.teacher)
        session = self.db.query(AttendanceSession).filter(AttendanceSession.id == payload["id"]).one()
        qr = get_qr(session.id, 10, self.db, self.teacher)
        expires = session.qr_expires_at.replace(tzinfo=timezone.utc) if session.qr_expires_at.tzinfo is None else session.qr_expires_at
        self.assertTrue(verify_current_qr_token(qr["token"], session.id, session.qr_secret, expires))
        old_secret = session.qr_secret
        refreshed = refresh_qr(session.id, 10, self.db, self.teacher)
        self.assertNotEqual(session.qr_secret, old_secret)
        expires = session.qr_expires_at.replace(tzinfo=timezone.utc) if session.qr_expires_at.tzinfo is None else session.qr_expires_at
        self.assertTrue(verify_current_qr_token(refreshed["token"], session.id, session.qr_secret, expires))
        result = close_session(session.id, 10, self.db, self.teacher)
        self.assertEqual(result["summary"], {"total_students": 1, "absent": 1})
        self.assertEqual(session.status, "closed")
        event = self.db.query(AttendanceEvent).filter(AttendanceEvent.session_id == session.id).one()
        self.assertEqual((event.college_id, event.student_id, event.status, event.method), (10, 701, "absent", "session_close"))
        with self.assertRaises(HTTPException) as closed:
            get_qr(session.id, 10, self.db, self.teacher)
        self.assertEqual(closed.exception.status_code, 409)

    def test_dashboard_aggregates_verified_session_events_by_tenant(self):
        payload = create_session(self.payload(), 10, self.db, self.teacher)
        self.db.add(AttendanceEvent(
            college_id=10,
            session_id=payload["id"],
            student_id=701,
            method="qr",
            status="late",
            verified_at=self.now,
        ))
        self.db.commit()
        summary = attendance_summary(10, self.db, self.admin)
        self.assertEqual(summary.verified_attendance_event_rows, 1)
        self.assertEqual(summary.verified_late_events, 1)
        self.assertEqual(summary.verified_classified_events_denominator, 1)
        self.assertEqual(summary.verified_presence_rate_percent, 100.0)

    def test_admin_attendance_event_list_and_detail_are_tenant_scoped_and_searchable(self):
        payload = create_session(self.payload(), 10, self.db, self.teacher)
        event = AttendanceEvent(
            college_id=10,
            session_id=payload["id"],
            student_id=701,
            method="qr",
            status="present",
            verified_at=self.now,
        )
        self.db.add(event)
        self.db.commit()

        result = list_tenant_attendance_events(
            college_id=10,
            status_filter="present",
            student_id=701,
            teacher_id=101,
            class_id=301,
            subject_id=501,
            date_from=self.now.date(),
            date_to=self.now.date(),
            search="Student A",
            page=1,
            page_size=10,
            db=self.db,
            current_user=self.admin,
        )
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["items"][0]["student_name"], "Student A")
        self.assertEqual(result["items"][0]["source"], "verified_event")
        detail = read_tenant_attendance_event(event.id, 10, self.db, self.admin)
        self.assertEqual(detail["id"], event.id)

        with self.assertRaises(HTTPException) as foreign:
            read_tenant_attendance_event(event.id, 20, self.db, self.admin)
        self.assertEqual(foreign.exception.status_code, 403)

        event.college_id = None
        self.db.commit()
        empty = list_tenant_attendance_events(
            college_id=10, status_filter=None, student_id=None, teacher_id=None,
            class_id=None, subject_id=None, date_from=None, date_to=None,
            search=None, page=1, page_size=10, db=self.db, current_user=self.admin,
        )
        self.assertEqual(empty["total"], 0)

    def test_teacher_qr_to_student_submission_is_scoped_single_event_and_visible_in_history(self):
        created = create_session(self.payload(), 10, self.db, self.teacher)
        issued = get_qr(created["id"], 10, self.db, self.teacher)
        self.assertNotIn("qr_secret", issued)

        request = StudentQrAttendanceGISRequest(token=issued["token"])
        result = submit_qr_attendance(created["id"], request, 10, self.db, self.student_user)
        self.assertEqual(result["method"], "qr")
        with self.assertRaises(HTTPException) as duplicate:
            submit_qr_attendance(created["id"], request, 10, self.db, self.student_user)
        self.assertEqual(duplicate.exception.status_code, 409)
        with self.assertRaises(HTTPException) as foreign:
            submit_qr_attendance(created["id"], request, 20, self.db, self.student_user)
        self.assertEqual(foreign.exception.status_code, 403)

        history = my_attendance(10, self.db, self.student_user)
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["method"], "qr")
        self.assertEqual(self.db.query(AttendanceEvent).filter_by(
            college_id=10, session_id=created["id"], student_id=701,
        ).count(), 1)


if __name__ == "__main__":
    unittest.main()
