"""Synthetic SQLite handler tests for tenant teacher session ownership."""

import json
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
    my_teacher_attendance_summary,
    read_tenant_attendance_event,
    refresh_qr,
)
from app.api.tenant_face import my_attendance, submit_qr_attendance
from app.api.tenant_dashboard import attendance_summary
from app.api.tenant_teachers import assign_tenant_teacher
from app.models import (
    AttendanceAuditLog,
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
from app.schemas.tenant_registration import TenantTeacherAssignmentInput
from app.services.attendance_core import new_qr_secret, verify_current_qr_token, build_qr_token


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
                Class(id=301, college_id=10, name="Class A", department="Science", semester=2, academic_year="2026-2027", is_active=True, latitude=12.9716, longitude=77.5946, radius_m=100),
                Class(id=401, college_id=20, name="Class B", is_active=True, radius_m=100),
                Subject(id=501, college_id=10, name="Subject A", code="SUB-A", department="Science", is_active=True),
                Subject(id=601, college_id=20, name="Subject B", code="SUB-B", is_active=True),
                Student(id=701, college_id=10, name="Student A", email="student@a.test", roll_number="R-A", student_code="S-A", is_active=True),
                TeacherAssignment(id=801, college_id=10, teacher_id=101, class_id=301, subject_id=501, academic_year="2026-2027", semester=2, is_active=True),
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
            location_verification_mode="gps_on",
            subject_id=subject_id,
            class_id=class_id,
            title="Lecture 1",
            starts_at=self.now - timedelta(minutes=1),
            ends_at=self.now + timedelta(minutes=40),
            latitude=12.9716,
            longitude=77.5946,
            teacher_latitude=12.9716,
            teacher_longitude=77.5946,
            teacher_accuracy_m=25,
        )

    def test_session_cannot_start_without_a_geofence_location(self):
        class_row = self.db.query(Class).filter_by(id=301).one()
        class_row.latitude = None
        class_row.longitude = None
        self.db.commit()

        with self.assertRaises(HTTPException) as missing_location:
            create_session(self.payload(), 10, self.db, self.teacher)

        self.assertEqual(missing_location.exception.status_code, 422)
        self.assertIn("College Admin must configure", missing_location.exception.detail)
        self.assertEqual(self.db.query(AttendanceSession).count(), 0)
    def test_assignment_listing_and_session_creation_are_college_and_assignment_scoped(self):
        assignments = my_teacher_assignments(10, self.db, self.teacher)
        self.assertEqual([row["id"] for row in assignments], [801])
        self.assertEqual(assignments[0]["subject_code"], "SUB-A")
        self.assertEqual(assignments[0]["department"], "Science")
        self.assertEqual(assignments[0]["semester"], 2)
        self.assertEqual(assignments[0]["academic_year"], "2026-2027")
        self.assertTrue(assignments[0]["is_active"])
        self.assertIsNone(assignments[0]["effective_from"], "Legacy insertion time must not be treated as effective date.")
        session = create_session(self.payload(), 10, self.db, self.teacher)
        stored = self.db.query(AttendanceSession).filter(AttendanceSession.id == session["id"]).one()
        self.assertEqual(stored.college_id, 10)
        self.assertEqual(session["location_verification_status"], "verified")
        self.assertEqual(list_sessions(10, self.db, self.teacher)[0]["location_verification_status"], "verified")
        created_audit = self.db.query(AttendanceAuditLog).filter_by(
            action="attendance_session.created", entity_type="attendance_session", entity_id=session["id"],
        ).one()
        self.assertEqual(created_audit.event_metadata["location_verification_status"], "verified")
        self.assertNotIn("qr_secret", session)
        self.assertEqual(len(list_sessions(10, self.db, self.teacher)), 1)
        with self.assertRaises(HTTPException) as denied:
            create_session(self.payload(class_id=401, subject_id=601), 10, self.db, self.teacher)
        self.assertEqual(denied.exception.status_code, 404)
        with self.assertRaises(HTTPException) as denied_wrong_college:
            list_sessions(20, self.db, self.teacher)
        self.assertEqual(denied_wrong_college.exception.status_code, 403)

    def test_gps_off_session_skips_teacher_location_but_persists_explicit_status(self):
        class_row = self.db.query(Class).filter_by(id=301).one()
        class_row.latitude = None
        class_row.longitude = None
        self.db.commit()
        request = AttendanceSessionGISCreate(
            location_verification_mode="gps_off",
            subject_id=501,
            class_id=301,
            title="Face attendance lecture",
            starts_at=self.now - timedelta(minutes=1),
            ends_at=self.now + timedelta(minutes=40),
        )

        created = create_session(request, 10, self.db, self.teacher)
        stored = self.db.query(AttendanceSession).filter_by(id=created["id"]).one()
        audit = self.db.query(AttendanceAuditLog).filter_by(
            entity_type="attendance_session", entity_id=stored.id, action="attendance_session.created",
        ).one()
        listed = list_sessions(10, self.db, self.teacher)

        self.assertEqual(created["location_verification_status"], "not_verified")
        self.assertEqual(listed[0]["location_verification_status"], "not_verified")
        self.assertEqual(audit.event_metadata["location_verification_status"], "not_verified")
        self.assertIsNone(stored.latitude)
        self.assertIsNone(stored.longitude)
        self.assertEqual(stored.radius_m, 100)

    def test_gps_off_cannot_bypass_membership_assignment_or_radius_policy(self):
        request = AttendanceSessionGISCreate(
            location_verification_mode="gps_off",
            subject_id=502,
            class_id=301,
            title="Unassigned lecture",
            starts_at=self.now - timedelta(minutes=1),
            ends_at=self.now + timedelta(minutes=40),
        )
        with self.assertRaises(HTTPException) as denied:
            create_session(request, 10, self.db, self.teacher)
        self.assertEqual(denied.exception.status_code, 404)
        self.assertEqual(self.db.query(AttendanceSession).count(), 0)

    def test_gps_off_still_requires_active_teacher_membership(self):
        request = AttendanceSessionGISCreate(
            location_verification_mode="gps_off",
            subject_id=501,
            class_id=301,
            title="Admin cannot start teacher session",
            starts_at=self.now - timedelta(minutes=1),
            ends_at=self.now + timedelta(minutes=40),
        )
        with self.assertRaises(HTTPException) as denied:
            create_session(request, 10, self.db, self.admin)
        self.assertEqual(denied.exception.status_code, 403)
        self.assertEqual(self.db.query(AttendanceSession).count(), 0)

    def test_authenticated_teacher_must_explicitly_choose_location_mode(self):
        request = AttendanceSessionGISCreate(
            subject_id=501,
            class_id=301,
            title="Mode required",
            starts_at=self.now - timedelta(minutes=1),
            ends_at=self.now + timedelta(minutes=40),
        )
        with self.assertRaises(HTTPException) as missing_mode:
            create_session(request, 10, self.db, self.teacher)
        self.assertEqual(missing_mode.exception.status_code, 422)
        self.assertIn("Choose whether Teacher location verification is on or off", missing_mode.exception.detail)
        self.assertEqual(self.db.query(AttendanceSession).count(), 0)

    def test_same_college_but_unassigned_class_subject_pair_cannot_start_session(self):
        self.db.add(Subject(id=502, college_id=10, name="Unassigned Subject", code="SUB-UNASSIGNED", is_active=True))
        self.db.commit()
        with self.assertRaises(HTTPException) as mismatch:
            create_session(self.payload(class_id=301, subject_id=502), 10, self.db, self.teacher)
        self.assertEqual(mismatch.exception.status_code, 404)
        self.assertEqual(self.db.query(AttendanceSession).count(), 0)

    def test_session_requires_admin_classroom_location_and_uses_teacher_gps_only_for_verification(self):
        class_row = self.db.query(Class).filter_by(id=301).one()
        college = self.db.query(College).filter_by(id=10).one()
        college.gps_accuracy_limit_m = 120
        class_row.latitude = None
        class_row.longitude = None
        self.db.commit()

        # A teacher GPS fix must never become the authoritative classroom point.
        with self.assertRaises(HTTPException) as missing_admin_location:
            create_session(self.payload(), 10, self.db, self.teacher)
        self.assertEqual(missing_admin_location.exception.status_code, 422)
        self.assertEqual(self.db.query(AttendanceSession).count(), 0)

        # Once the Admin configures the classroom, teacher GPS verifies presence there.
        class_row.latitude = 19.0760
        class_row.longitude = 72.8777
        class_row.radius_m = 175
        self.db.commit()

        request = self.payload()
        request.latitude = 0
        request.longitude = 0
        request.radius_m = 500
        request.teacher_latitude = 19.0760
        request.teacher_longitude = 72.8777
        request.teacher_accuracy_m = 25

        created = create_session(request, 10, self.db, self.teacher)
        stored = self.db.query(AttendanceSession).filter_by(id=created["id"]).one()

        self.assertEqual(
            (stored.latitude, stored.longitude, stored.radius_m),
            (19.0760, 72.8777, 175),
        )

        # A teacher outside the Admin-configured geofence must be rejected.
        outside_request = self.payload()
        outside_request.teacher_latitude = 19.0800
        outside_request.teacher_longitude = 72.8800
        outside_request.teacher_accuracy_m = 25

        with self.assertLogs("app.api.tenant_attendance_sessions", level="WARNING") as captured:
            with self.assertRaises(HTTPException) as outside:
                create_session(outside_request, 10, self.db, self.teacher)
        self.assertEqual(outside.exception.status_code, 403)
        diagnostic_line = next(line for line in captured.output if "attendx_geofence_diagnostic " in line)
        diagnostic = json.loads(diagnostic_line.split("attendx_geofence_diagnostic ", 1)[1])
        self.assertEqual(diagnostic["stage"], "classroom_distance_validation")
        self.assertEqual((diagnostic["college_id"], diagnostic["class_id"], diagnostic["subject_id"]), (10, 301, 501))
        self.assertEqual(diagnostic["classroom_radius_m"], 175)
        self.assertEqual(diagnostic["gps_accuracy_m"], 25)
        self.assertEqual(diagnostic["college_accuracy_limit_m"], 120)
        self.assertGreater(diagnostic["haversine_distance_m"], diagnostic["classroom_radius_m"])
        for field in ("user_id", "teacher_id", "membership_id", "classroom_latitude", "classroom_longitude", "teacher_latitude", "teacher_longitude"):
            self.assertNotIn(field, diagnostic)
        self.assertIn("outside its 175 m attendance zone", outside.exception.detail)
        self.assertIn("GPS reports 25.0 m accuracy", outside.exception.detail)

        imprecise_request = self.payload()
        imprecise_request.teacher_latitude = 19.0760
        imprecise_request.teacher_longitude = 72.8777
        imprecise_request.teacher_accuracy_m = 121
        with self.assertLogs("app.api.tenant_attendance_sessions", level="WARNING") as accuracy_logs:
            with self.assertRaises(HTTPException) as imprecise:
                create_session(imprecise_request, 10, self.db, self.teacher)
        self.assertEqual(imprecise.exception.status_code, 403)
        accuracy_line = next(line for line in accuracy_logs.output if "attendx_geofence_diagnostic " in line)
        accuracy_diagnostic = json.loads(accuracy_line.split("attendx_geofence_diagnostic ", 1)[1])
        self.assertEqual(accuracy_diagnostic["stage"], "gps_accuracy_or_coordinate_validation")
        self.assertEqual(accuracy_diagnostic["gps_accuracy_m"], 121)
        self.assertEqual(accuracy_diagnostic["college_accuracy_limit_m"], 120)
        self.assertEqual(accuracy_diagnostic["classroom_radius_m"], 175)

    def test_lecture_start_rejects_location_hundreds_of_kilometres_away(self):
        far_request = self.payload()
        far_request.teacher_latitude = 25.40
        far_request.teacher_longitude = 81.88
        far_request.teacher_accuracy_m = 50
        with self.assertLogs("app.api.tenant_attendance_sessions", level="WARNING") as captured:
            with self.assertRaises(HTTPException) as rejected:
                create_session(far_request, 10, self.db, self.teacher)
        self.assertEqual(rejected.exception.status_code, 403)
        self.assertIn("outside its 100 m attendance zone", rejected.exception.detail)
        self.assertIn("GPS reports 50.0 m accuracy", rejected.exception.detail)
        self.assertIn("College limit 100 m", rejected.exception.detail)
        self.assertEqual(self.db.query(AttendanceSession).count(), 0)
        diagnostic_line = next(line for line in captured.output if "attendx_geofence_diagnostic " in line)
        diagnostic = json.loads(diagnostic_line.split("attendx_geofence_diagnostic ", 1)[1])
        self.assertEqual(diagnostic["stage"], "classroom_distance_validation")
        self.assertGreater(diagnostic["haversine_distance_m"], 100000)
        self.assertNotIn("teacher_latitude", diagnostic)
        self.assertNotIn("teacher_longitude", diagnostic)
    def test_committed_admin_assignment_appears_in_teacher_dashboard_query_without_relogin(self):
        payload = TenantTeacherAssignmentInput(
            class_id=301,
            subject_id=501,
            academic_year="2027-2028",
            semester=2,
        )
        created = assign_tenant_teacher(101, payload, 10, self.db, self.admin)
        self.assertTrue(created.is_active)
        self.db.expire_all()

        dashboard_rows = my_teacher_assignments(10, self.db, self.teacher)
        newly_assigned = [row for row in dashboard_rows if row["id"] == created.id]
        self.assertEqual(len(newly_assigned), 1)
        self.assertEqual(newly_assigned[0]["teacher_id"], 101)
        self.assertEqual(newly_assigned[0]["class_id"], 301)
        self.assertEqual(newly_assigned[0]["subject_id"], 501)

        session_response = create_session(self.payload(class_id=301, subject_id=501), 10, self.db, self.teacher)
        saved_session = self.db.query(AttendanceSession).filter_by(id=session_response["id"]).one()
        self.assertEqual(saved_session.teacher_id, 101)
        self.assertEqual(saved_session.class_id, 301)
        self.assertEqual(saved_session.subject_id, 501)
        self.assertEqual(saved_session.college_id, 10)

        created.effective_to = datetime.now(timezone.utc)
        created.is_active = False
        self.db.commit()
        self.assertNotIn(created.id, {row["id"] for row in my_teacher_assignments(10, self.db, self.teacher)})

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

        request = StudentQrAttendanceGISRequest(
            token=issued["token"], latitude=12.9716, longitude=77.5946, accuracy_m=25,
        )
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

    def test_teacher_dashboard_summary_uses_only_verified_tenant_session_data(self):
        created = create_session(self.payload(), 10, self.db, self.teacher)
        self.db.add(AttendanceEvent(
            college_id=10, session_id=created["id"], student_id=701,
            method="qr", status="present", verified_at=self.now,
        ))
        self.db.commit()
        summary = my_teacher_attendance_summary(10, self.db, self.teacher)
        self.assertEqual(summary["teacher_name"], "Teacher")
        self.assertEqual(summary["sessions"], 1)
        self.assertEqual(summary["active_sessions"], 1)
        self.assertEqual(summary["total_assignments"], 1)
        self.assertEqual(summary["verified_attendance_events"], 1)
        self.assertEqual(summary["attendance_percentage"], 100.0)
        with self.assertRaises(HTTPException) as wrong_college:
            my_teacher_attendance_summary(20, self.db, self.teacher)
        self.assertEqual(wrong_college.exception.status_code, 403)
        with self.assertRaises(HTTPException) as admin_role:
            my_teacher_attendance_summary(10, self.db, self.admin)
        self.assertEqual(admin_role.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
