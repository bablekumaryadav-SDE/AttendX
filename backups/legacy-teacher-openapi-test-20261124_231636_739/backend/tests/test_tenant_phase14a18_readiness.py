"""Phase 14A.18 OpenAPI, gate, and dotenv-isolation contract tests.

The runner must set ATTENDX_SKIP_DOTENV=1 and provide a synthetic SQLite URL
using ATTENDX_TEST_SQLALCHEMY_URL before importing app modules.
"""

import unittest
from unittest.mock import Mock

from app.database import (
    ISOLATED_DATABASE_URL_ENV,
    SKIP_DOTENV_ENV,
    resolve_database_url,
)
from app.dependencies import get_current_user
from app.main import app
from app.schemas.tenant_registration import TenantPasswordReset, TenantStudentCreate, TenantTeacherCreate


class TenantApiOpenApiReadinessTests(unittest.TestCase):
    def test_schema_documents_exact_tenant_overlay_handlers(self):
        paths = app.openapi()["paths"]
        expected = {
            ("/tenant/memberships", "get", "list_my_active_college_memberships_tenant_memberships_get"),
            ("/tenant/pilot/college-profile", "get", "read_college_profile_tenant_pilot_college_profile_get"),
            ("/tenant/pilot/college-profile", "patch", "update_college_profile_tenant_pilot_college_profile_patch"),
            ("/subjects/", "get", "list_tenant_subjects_subjects__get"),
            ("/subjects/", "post", "create_tenant_subject_subjects__post"),
            ("/subjects/{subject_id}", "get", "read_tenant_subject_subjects__subject_id__get"),
            ("/subjects/{subject_id}", "patch", "update_tenant_subject_subjects__subject_id__patch"),
            ("/subjects/{subject_id}", "delete", "deactivate_tenant_subject_subjects__subject_id__delete"),
            ("/classes/", "get", "list_tenant_classes_classes__get"),
            ("/classes/{class_id}", "get", "read_tenant_class_classes__class_id__get"),
            ("/classes/", "post", "create_tenant_class_classes__post"),
            ("/classes/{class_id}", "patch", "update_tenant_class_classes__class_id__patch"),
            ("/classes/{class_id}", "delete", "deactivate_tenant_class_classes__class_id__delete"),
            ("/teachers/", "get", "list_tenant_teachers_teachers__get"),
            ("/teachers/{teacher_id}", "get", "read_tenant_teacher_teachers__teacher_id__get"),
            ("/teachers/{teacher_id}/management-profile", "get", "read_tenant_teacher_management_profile_teachers__teacher_id__management_profile_get"),
            ("/teachers/{teacher_id}", "patch", "update_tenant_teacher_teachers__teacher_id__patch"),
            ("/teachers/{teacher_id}", "delete", "deactivate_tenant_teacher_teachers__teacher_id__delete"),
            ("/teachers/", "post", "create_tenant_teacher_teachers__post"),
            ("/teachers/{teacher_id}/assignments", "get", "list_tenant_teacher_assignments_teachers__teacher_id__assignments_get"),
            ("/teachers/{teacher_id}/assignments", "post", "assign_tenant_teacher_teachers__teacher_id__assignments_post"),
            ("/teachers/{teacher_id}/assignments/{assignment_id}", "delete", "deactivate_tenant_teacher_assignment_teachers__teacher_id__assignments__assignment_id__delete"),
            ("/teachers/{teacher_id}/password", "patch", "reset_tenant_teacher_password_teachers__teacher_id__password_patch"),
            ("/teachers/{teacher_id}/invitation", "get", "get_teacher_invitation_status_teachers__teacher_id__invitation_get"),
            ("/teachers/{teacher_id}/invitation/resend", "post", "resend_teacher_invitation_teachers__teacher_id__invitation_resend_post"),
            ("/students/", "get", "list_tenant_students_students__get"),
            ("/students/", "post", "create_tenant_student_students__post"),
            ("/students/{student_id}/password", "patch", "reset_tenant_student_password_students__student_id__password_patch"),
            ("/students/{student_id}", "get", "read_tenant_student_students__student_id__get"),
            ("/students/{student_id}", "patch", "update_tenant_student_students__student_id__patch"),
            ("/students/{student_id}", "delete", "deactivate_tenant_student_students__student_id__delete"),
            ("/students/{student_id}/activate", "patch", "activate_tenant_student_students__student_id__activate_patch"),
            ("/students/{student_id}/class-assignments", "get", "list_tenant_student_class_assignments_students__student_id__class_assignments_get"),
            ("/students/{student_id}/class-assignments", "post", "assign_tenant_student_to_class_students__student_id__class_assignments_post"),
            ("/students/{student_id}/class-assignments/{assignment_id}", "delete", "deactivate_tenant_student_class_assignment_students__student_id__class_assignments__assignment_id__delete"),
            ("/students/{student_id}/invitation", "get", "get_student_invitation_status_students__student_id__invitation_get"),
            ("/students/{student_id}/invitation/resend", "post", "resend_student_invitation_students__student_id__invitation_resend_post"),
            ("/students/{student_id}/academic-history", "get", "get_tenant_student_academic_history_students__student_id__academic_history_get"),
            ("/students/{student_id}/promotions", "post", "promote_tenant_student_students__student_id__promotions_post"),
            ("/attendance/", "get", "list_tenant_attendance_attendance__get"),
            ("/attendance/{attendance_id}", "get", "read_tenant_attendance_attendance__attendance_id__get"),
            ("/attendance-records/", "get", "list_tenant_attendance_records_attendance_records__get"),
            ("/attendance-records/{record_id}", "get", "read_tenant_attendance_record_attendance_records__record_id__get"),
            ("/tenant/dashboard/summary", "get", "dashboard_summary_tenant_dashboard_summary_get"),
            ("/tenant/dashboard/attendance-summary", "get", "attendance_summary_tenant_dashboard_attendance_summary_get"),
            ("/tenant/guardians", "get", "list_tenant_guardians_tenant_guardians_get"),
            ("/tenant/notification-events", "get", "list_tenant_notification_events_tenant_notification_events_get"),
            ("/tenant/notifications", "get", "list_notifications_tenant_notifications_get"),
            ("/tenant/notifications/read-all", "post", "mark_all_notifications_read_tenant_notifications_read_all_post"),
            ("/tenant/notifications/unread-count", "get", "unread_notification_count_tenant_notifications_unread_count_get"),
            ("/tenant/notifications/{notification_id}/read", "patch", "mark_notification_read_tenant_notifications__notification_id__read_patch"),
            ("/tenant/account-links/students/{student_id}", "post", "create_student_account_link_tenant_account_links_students__student_id__post"),
            ("/tenant/account-links/students/{student_id}", "get", "read_student_account_link_tenant_account_links_students__student_id__get"),
            ("/tenant/account-links/teachers/{teacher_id}", "post", "create_teacher_account_link_tenant_account_links_teachers__teacher_id__post"),
            ("/tenant/account-links/teachers/{teacher_id}", "get", "read_teacher_account_link_tenant_account_links_teachers__teacher_id__get"),
            ("/tenant/account-links/teachers/eligible-users", "get", "list_teacher_account_link_candidates_tenant_account_links_teachers_eligible_users_get"),
            ("/tenant/account-links/students/{link_id}/revoke", "post", "revoke_student_account_link_tenant_account_links_students__link_id__revoke_post"),
            ("/tenant/account-links/teachers/{link_id}/revoke", "post", "revoke_teacher_account_link_tenant_account_links_teachers__link_id__revoke_post"),
            ("/tenant/attendance/events", "get", "list_tenant_attendance_events_tenant_attendance_events_get"),
            ("/tenant/attendance/events/{event_id}", "get", "read_tenant_attendance_event_tenant_attendance_events__event_id__get"),
            ("/tenant/attendance/sessions", "get", "list_sessions_tenant_attendance_sessions_get"),
            ("/tenant/attendance/sessions", "post", "create_session_tenant_attendance_sessions_post"),
            ("/tenant/attendance/sessions/assignments", "get", "my_teacher_assignments_tenant_attendance_sessions_assignments_get"),
            ("/tenant/attendance/sessions/summary", "get", "my_teacher_attendance_summary_tenant_attendance_sessions_summary_get"),
            ("/tenant/attendance/sessions/{session_id}/close", "post", "close_session_tenant_attendance_sessions__session_id__close_post"),
            ("/tenant/attendance/sessions/{session_id}/live", "get", "live_attendance_tenant_attendance_sessions__session_id__live_get"),
            ("/tenant/attendance/sessions/{session_id}/qr", "get", "get_qr_tenant_attendance_sessions__session_id__qr_get"),
            ("/tenant/attendance/sessions/{session_id}/qr/refresh", "post", "refresh_qr_tenant_attendance_sessions__session_id__qr_refresh_post"),
            ("/tenant/face/me", "get", "my_face_status_tenant_face_me_get"),
            ("/tenant/face/me/register", "post", "register_my_face_tenant_face_me_register_post"),
            ("/tenant/face/student/academics", "get", "my_student_academics_tenant_face_student_academics_get"),
            ("/tenant/face/student/attendance", "get", "my_attendance_tenant_face_student_attendance_get"),
            ("/tenant/face/student/sessions", "get", "my_active_sessions_tenant_face_student_sessions_get"),
            ("/tenant/face/student/sessions/{session_id}/face", "post", "submit_face_attendance_tenant_face_student_sessions__session_id__face_post"),
            ("/tenant/face/student/sessions/{session_id}/qr", "post", "submit_qr_attendance_tenant_face_student_sessions__session_id__qr_post"),
            ("/tenant/face/students/{student_id}", "get", "student_face_status_tenant_face_students__student_id__get"),
            ("/tenant/face/students/{student_id}/register", "post", "register_student_face_tenant_face_students__student_id__register_post"),
        }
        actual = {
            (path, method, operation.get("operationId"))
            for path, operations in paths.items()
            for method, operation in operations.items()
            if method != "parameters"
            and any(tag.startswith("Tenant") for tag in operation.get("tags", []))
        }
        self.assertEqual(actual, expected)
        self.assertFalse(any(path.startswith('/tenant/coursework/') for path, _, _ in actual))

    def test_blocked_legacy_routes_are_omitted_from_openapi(self):
        paths = app.openapi()["paths"]
        for path, method in (
            ("/admin-dashboard", "get"),
            ("/analytics/overview", "get"),
            ("/analytics/records", "get"),
            ("/notifications/mine", "get"),
            ("/assignments/", "get"),
            ("/classes/{class_id}", "put"),
            ("/subjects/{subject_id}", "put"),
            ("/attendance/", "post"),
        ):
            with self.subTest(path=path, method=method):
                self.assertNotIn(method, paths.get(path, {}))

        self.assertIn("post", paths["/auth/login"])
        self.assertIn("patch", paths["/tenant/pilot/college-profile"])
        self.assertIn("post", paths["/subjects/"])
        self.assertIn("patch", paths["/subjects/{subject_id}"])
        self.assertIn("delete", paths["/subjects/{subject_id}"])

    def test_password_inputs_are_write_only_and_never_part_of_responses(self):
        for model in (TenantStudentCreate, TenantTeacherCreate, TenantPasswordReset):
            schema = model.model_json_schema()
            for field in ("password", "password_confirmation"):
                self.assertEqual(schema["properties"][field]["format"], "password")
                self.assertTrue(schema["properties"][field]["writeOnly"])

        for name, schema in app.openapi()["components"]["schemas"].items():
            if "RegisteredResponse" in name:
                self.assertNotIn("password", schema.get("properties", {}))
                self.assertNotIn("password_confirmation", schema.get("properties", {}))
                self.assertNotIn("hashed_password", schema.get("properties", {}))

    def test_legacy_default_deny_still_returns_503_before_handler(self):
        try:
            from fastapi.testclient import TestClient
        except RuntimeError as exc:
            self.skipTest(f"FastAPI TestClient unavailable in this environment: {exc}")
        app.dependency_overrides.clear()
        app.dependency_overrides[get_current_user] = lambda: {"id": 987654, "role": "admin"}
        try:
            with TestClient(app) as client:
                responses = [
                    client.get("/analytics/overview"),
                    client.post("/assignments/", json={}),
                ]
            for response in responses:
                self.assertEqual(response.status_code, 503)
                self.assertEqual(
                    response.json(),
                    {"detail": "This business API is unavailable until College-scoped authorization is enabled."},
                )
        finally:
            app.dependency_overrides.clear()


class DotenvIsolationTests(unittest.TestCase):
    def test_explicit_isolation_skips_dotenv_and_uses_separate_synthetic_url(self):
        loader = Mock()
        values = {
            SKIP_DOTENV_ENV: "1",
            ISOLATED_DATABASE_URL_ENV: "sqlite://",
            "DATABASE_URL": "synthetic-application-url-not-used",
        }
        result = resolve_database_url(values, dotenv_loader=loader)
        self.assertEqual(result, "sqlite://")
        loader.assert_not_called()

    def test_isolation_fails_closed_without_test_url_and_ignores_application_url(self):
        loader = Mock()
        values = {SKIP_DOTENV_ENV: "1", "DATABASE_URL": "synthetic-application-url-not-used"}
        with self.assertRaisesRegex(RuntimeError, ISOLATED_DATABASE_URL_ENV):
            resolve_database_url(values, dotenv_loader=loader)
        loader.assert_not_called()

    def test_normal_startup_path_still_invokes_dotenv_loader(self):
        loader = Mock()
        result = resolve_database_url({"DATABASE_URL": "sqlite://"}, dotenv_loader=loader)
        self.assertEqual(result, "sqlite://")
        loader.assert_called_once()
        self.assertEqual(loader.call_args.kwargs["dotenv_path"].name, ".env")


if __name__ == "__main__":
    unittest.main()
