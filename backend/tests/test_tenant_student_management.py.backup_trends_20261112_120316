"""Student tenant CRUD, pagination and class assignment tests on SQLite."""

import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.tenant_students import (
    activate_tenant_student,
    assign_tenant_student_to_class,
    deactivate_tenant_student,
    deactivate_tenant_student_class_assignment,
    list_tenant_student_class_assignments,
    list_tenant_students,
    update_tenant_student,
)
from app.database import Base
from app.models import (
    Class,
    College,
    CollegeMembership,
    FaceEmbedding,
    Student,
    StudentClassAssignment,
    StudentGuardian,
    User,
)
from app.schemas.tenant_student import TenantStudentClassAssignmentInput, TenantStudentUpdate


class TenantStudentManagementTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.Session.begin() as db:
            db.add_all([
                College(id=901, slug="student-crud-a", official_name="Student CRUD A", status="active"),
                College(id=902, slug="student-crud-b", official_name="Student CRUD B", status="active"),
                User(id=9011, name="A Admin", email="student-crud-admin@example.test", hashed_password="synthetic", role="admin", is_active=True),
                User(id=9012, name="Student One", email="student-one@example.test", hashed_password="synthetic", role="student", is_active=True),
                User(id=9013, name="Student Two", email="student-two@example.test", hashed_password="synthetic", role="student", is_active=True),
                User(id=9021, name="B Admin", email="student-crud-b-admin@example.test", hashed_password="synthetic", role="admin", is_active=True),
            ])
            db.add_all([
                CollegeMembership(user_id=9011, college_id=901, role="college_admin", status="active"),
                CollegeMembership(user_id=9012, college_id=901, role="student", status="active"),
                CollegeMembership(user_id=9013, college_id=901, role="student", status="active"),
                CollegeMembership(user_id=9021, college_id=902, role="college_admin", status="active"),
                Class(id=9101, college_id=901, name="A Class", is_active=True, radius_m=100),
                Class(id=9201, college_id=902, name="B Class", is_active=True, radius_m=100),
                Student(id=9111, college_id=901, student_code="ATX-901-A", name="Student One", email="student-one@example.test", roll_number="A-1", enrollment_number="EN-1", course="Science", is_active=True),
                Student(id=9112, college_id=901, student_code="ATX-901-B", name="Student Two", email="student-two@example.test", roll_number="A-2", course="Arts", is_active=True),
                Student(id=9211, college_id=902, student_code="ATX-902-A", name="Foreign Student", email="foreign-student@example.test", roll_number="B-1", is_active=True),
            ])

    def tearDown(self):
        self.engine.dispose()

    def test_update_is_tenant_scoped_updates_guardian_and_preserves_global_email(self):
        with self.Session() as db:
            result = update_tenant_student(
                9111,
                TenantStudentUpdate(name="Updated Student", roll_number="A-NEW", father_name="Synthetic Parent", parent_email="PARENT@example.com"),
                college_id=901,
                db=db,
                current_user={"id": 9011},
            )
            self.assertEqual(result["name"], "Updated Student")
            self.assertEqual(result["email"], "student-one@example.test")
            self.assertEqual(result["father_name"], "Synthetic Parent")
            self.assertEqual(result["parent_email"], "parent@example.com")
            self.assertEqual(db.query(User).filter_by(id=9012).one().name, "Updated Student")

    def test_update_rejects_duplicate_college_identifiers_foreign_rows_and_empty_patch(self):
        with self.Session() as db:
            with self.assertRaises(HTTPException) as duplicate:
                update_tenant_student(9111, TenantStudentUpdate(roll_number="A-2"), college_id=901, db=db, current_user={"id": 9011})
            self.assertEqual(duplicate.exception.status_code, 409)
            with self.assertRaises(HTTPException) as foreign:
                update_tenant_student(9211, TenantStudentUpdate(name="Attempt"), college_id=901, db=db, current_user={"id": 9011})
            self.assertEqual(foreign.exception.status_code, 404)
        with self.assertRaises(ValueError):
            TenantStudentUpdate.model_validate({})
        with self.assertRaises(ValueError):
            TenantStudentUpdate.model_validate({"name": None})

    def test_non_admin_membership_cannot_mutate_student_or_assignments(self):
        with self.Session() as db:
            with self.assertRaises(HTTPException) as update_denied:
                update_tenant_student(9111, TenantStudentUpdate(name="Attempt"), college_id=901, db=db, current_user={"id": 9012})
            self.assertEqual(update_denied.exception.status_code, 403)
            with self.assertRaises(HTTPException) as assignment_denied:
                assign_tenant_student_to_class(
                    9111,
                    TenantStudentClassAssignmentInput(class_id=9101, academic_year="2026-27"),
                    college_id=901,
                    db=db,
                    current_user={"id": 9012},
                )
            self.assertEqual(assignment_denied.exception.status_code, 403)
            with self.assertRaises(HTTPException) as activate_denied:
                activate_tenant_student(9111, college_id=901, db=db, current_user={"id": 9012})
            self.assertEqual(activate_denied.exception.status_code, 403)
            with self.assertRaises(HTTPException) as deactivate_denied:
                deactivate_tenant_student(9111, college_id=901, db=db, current_user={"id": 9012})
            self.assertEqual(deactivate_denied.exception.status_code, 403)

    def test_college_admin_cannot_activate_foreign_student(self):
        with self.Session() as db:
            with self.assertRaises(HTTPException) as foreign:
                activate_tenant_student(9111, college_id=902, db=db, current_user={"id": 9021})
            self.assertEqual(foreign.exception.status_code, 404)

    def test_server_side_filters_and_pagination_are_scoped_and_report_counts(self):
        with self.Session() as db:
            result = list_tenant_students(
                college_id=901,
                search=None,
                course=None,
                department=None,
                admission_year=None,
                current_academic_year=None,
                current_semester=None,
                section=None,
                active_only=False,
                page=1,
                page_size=1,
                db=db,
                current_user={"id": 9011},
            )
            self.assertEqual(result["total"], 2)
            self.assertEqual(len(result["items"]), 1)
            self.assertEqual(result["active_count"], 2)
            filtered = list_tenant_students(
                college_id=901,
                search="Student One",
                course="Science",
                department=None,
                admission_year=None,
                current_academic_year=None,
                current_semester=None,
                section=None,
                active_only=True,
                page=1,
                page_size=25,
                db=db,
                current_user={"id": 9011},
            )
            self.assertEqual([item["id"] for item in filtered["items"]], [9111])
            self.assertEqual(filtered["total"], 1)

    def test_face_status_counts_and_filter_use_only_valid_same_college_embeddings(self):
        import json
        vector = [1.0] + [0.0] * 127
        with self.Session.begin() as db:
            db.add_all([
                FaceEmbedding(student_id=9111, image_data=b"synthetic", mime_type="image/jpeg", image_sha256="a" * 64, embedding_json=json.dumps(vector), status="registered"),
                FaceEmbedding(student_id=9112, image_data=b"synthetic", mime_type="image/jpeg", image_sha256="b" * 64, embedding_json="[]", status="registered"),
                FaceEmbedding(student_id=9211, image_data=b"synthetic", mime_type="image/jpeg", image_sha256="c" * 64, embedding_json=json.dumps(vector), status="registered"),
            ])
        with self.Session() as db:
            result = list_tenant_students(
                college_id=901, search=None, course=None, department=None,
                admission_year=None, current_academic_year=None, current_semester=None,
                section=None, active_only=False, face_status=None, page=1, page_size=25,
                db=db, current_user={"id": 9011},
            )
            self.assertEqual(result["face_registered_count"], 1)
            self.assertEqual(result["face_not_registered_count"], 1)
            self.assertEqual({item["id"] for item in result["items"] if item["face_registered"]}, {9111})
            self.assertNotIn("embedding_json", str(result))
            registered = list_tenant_students(
                college_id=901, search=None, course=None, department=None,
                admission_year=None, current_academic_year=None, current_semester=None,
                section=None, active_only=False, face_status="registered", page=1, page_size=25,
                db=db, current_user={"id": 9011},
            )
            missing = list_tenant_students(
                college_id=901, search=None, course=None, department=None,
                admission_year=None, current_academic_year=None, current_semester=None,
                section=None, active_only=False, face_status="not_registered", page=1, page_size=25,
                db=db, current_user={"id": 9011},
            )
            self.assertEqual([item["id"] for item in registered["items"]], [9111])
            self.assertEqual({item["id"] for item in missing["items"]}, {9112})

    def test_class_assignment_validates_tenant_duplicate_and_soft_ends(self):
        with self.Session() as db:
            assignment = assign_tenant_student_to_class(
                9111,
                TenantStudentClassAssignmentInput(class_id=9101, academic_year="2026-27", semester=1),
                college_id=901,
                db=db,
                current_user={"id": 9011},
            )
            self.assertEqual(assignment.college_id, 901)
            with self.assertRaises(HTTPException) as duplicate:
                assign_tenant_student_to_class(
                    9111,
                    TenantStudentClassAssignmentInput(class_id=9101, academic_year="2026-27", semester=1),
                    college_id=901,
                    db=db,
                    current_user={"id": 9011},
                )
            self.assertEqual(duplicate.exception.status_code, 409)
            with self.assertRaises(HTTPException) as foreign_class:
                assign_tenant_student_to_class(
                    9111,
                    TenantStudentClassAssignmentInput(class_id=9201, academic_year="2026-27", semester=1),
                    college_id=901,
                    db=db,
                    current_user={"id": 9011},
                )
            self.assertEqual(foreign_class.exception.status_code, 404)
            history = list_tenant_student_class_assignments(9111, college_id=901, db=db, current_user={"id": 9011})
            self.assertEqual(len(history), 1)
            ended = deactivate_tenant_student_class_assignment(9111, assignment.id, college_id=901, db=db, current_user={"id": 9011})
            self.assertFalse(ended.is_active)
            self.assertIsNotNone(db.query(StudentClassAssignment).filter_by(id=assignment.id).one_or_none())

    def test_deactivation_revokes_only_college_membership_and_keeps_student_record(self):
        with self.Session() as db:
            result = deactivate_tenant_student(9111, college_id=901, db=db, current_user={"id": 9011})
            self.assertFalse(result["is_active"])
            student = db.query(Student).filter_by(id=9111).one()
            membership = db.query(CollegeMembership).filter_by(user_id=9012, college_id=901).one()
            user = db.query(User).filter_by(id=9012).one()
            self.assertFalse(student.is_active)
            self.assertEqual(membership.status, "revoked")
            self.assertFalse(user.is_active)
            self.assertIsNotNone(db.query(Student).filter_by(id=9111).one_or_none())

    def test_activate_after_deactivate_restores_membership_and_login_without_losing_face_or_history(self):
        import hashlib
        import json
        vector = [1.0] + [0.0] * 127
        image = b"synthetic preserved enrollment"
        with self.Session.begin() as db:
            db.add(FaceEmbedding(student_id=9111, image_data=image, mime_type="image/jpeg", image_sha256=hashlib.sha256(image).hexdigest(), embedding_json=json.dumps(vector), status="registered"))
            db.add(StudentClassAssignment(id=9191, college_id=901, student_id=9111, class_id=9101, academic_year="2025-26", is_active=True))
        with self.Session() as db:
            deactivated = deactivate_tenant_student(9111, college_id=901, db=db, current_user={"id": 9011})
            self.assertFalse(deactivated["is_active"])
            inactive_directory = list_tenant_students(
                college_id=901, search=None, course=None, department=None, admission_year=None,
                current_academic_year=None, current_semester=None, section=None, active_only=False,
                face_status=None, page=1, page_size=25, db=db, current_user={"id": 9011},
            )
            inactive_row = next(item for item in inactive_directory["items"] if item["id"] == 9111)
            self.assertFalse(inactive_row["is_active"])
            self.assertEqual(inactive_row["face_status"], "registered")
            self.assertTrue(inactive_row["face_registered"])
            activated = activate_tenant_student(9111, college_id=901, db=db, current_user={"id": 9011})
            self.assertTrue(activated["is_active"])
            self.assertEqual(activated["membership_status"], "active")
            student = db.query(Student).filter_by(id=9111).one()
            account = db.query(User).filter_by(id=9012).one()
            membership = db.query(CollegeMembership).filter_by(user_id=9012, college_id=901).one()
            assignment = db.query(StudentClassAssignment).filter_by(id=9191).one()
            self.assertTrue(student.is_active)
            self.assertTrue(account.is_active)
            self.assertEqual(membership.status, "active")
            self.assertIsNotNone(membership.activated_at)
            self.assertEqual(membership.activated_by_user_id, 9011)
            self.assertIsNone(membership.revoked_at)
            self.assertFalse(assignment.is_active)
            refreshed = list_tenant_students(
                college_id=901, search=None, course=None, department=None, admission_year=None,
                current_academic_year=None, current_semester=None, section=None, active_only=False,
                face_status=None, page=1, page_size=25, db=db, current_user={"id": 9011},
            )
            row = next(item for item in refreshed["items"] if item["id"] == 9111)
            self.assertTrue(row["is_active"])
            self.assertEqual(row["face_status"], "registered")
            self.assertTrue(row["face_registered"])

    def test_activate_fails_closed_when_existing_user_or_membership_cannot_be_matched(self):
        with self.Session() as db:
            db.query(CollegeMembership).filter_by(user_id=9012, college_id=901).delete()
            db.query(Student).filter_by(id=9111).update({Student.is_active: False})
            db.commit()
            with self.assertRaises(HTTPException) as missing_membership:
                activate_tenant_student(9111, college_id=901, db=db, current_user={"id": 9011})
            self.assertEqual(missing_membership.exception.status_code, 409)
            self.assertFalse(db.query(Student).filter_by(id=9111).one().is_active)

    def test_deactivation_preserves_shared_login_with_another_active_college_membership(self):
        with self.Session() as db:
            db.add(CollegeMembership(user_id=9012, college_id=902, role="student", status="active"))
            db.commit()
            deactivate_tenant_student(9111, college_id=901, db=db, current_user={"id": 9011})
            account = db.query(User).filter_by(id=9012).one()
            memberships = db.query(CollegeMembership).filter_by(user_id=9012).all()
            self.assertTrue(account.is_active)
            self.assertEqual({row.college_id: row.status for row in memberships}, {901: "revoked", 902: "active"})


if __name__ == "__main__":
    unittest.main()
