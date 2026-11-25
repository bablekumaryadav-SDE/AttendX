"""SQLite-only tests for additive tenant models and authorization primitives."""

import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.membership_service import (
    activate_college_membership,
    create_college_membership,
    revoke_college_membership,
)
from app.models import College, CollegeMembership, User
from app.tenant_context import get_tenant_college, resolve_tenant_context


class TenantFoundationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.Session.begin() as db:
            db.add_all([
                User(id=501, name="Member A", email="member-a@example.test", hashed_password="x", role="teacher"),
                User(id=502, name="Legacy Admin", email="legacy-admin@example.test", hashed_password="x", role="admin"),
                User(id=503, name="Platform Admin", email="platform-admin@example.test", hashed_password="x", role="super_admin"),
                User(id=504, name="College Operator", email="college-admin@example.test", hashed_password="x", role="admin"),
                User(id=505, name="Invited Student", email="invited-student@example.test", hashed_password="x", role="student"),
                College(id=41, slug="college-a", official_name="Synthetic College A", status="active"),
                College(id=42, slug="college-b", official_name="Synthetic College B", status="active"),
            ])
            db.flush()
            db.add(CollegeMembership(
                id=601, user_id=501, college_id=41, role="teacher", status="active",
                created_by_user_id=502,
            ))
            db.add(CollegeMembership(
                id=602, user_id=502, college_id=41, role="college_admin", status="pending",
                created_by_user_id=503,
            ))
            db.add(CollegeMembership(
                id=603, user_id=504, college_id=41, role="college_admin", status="active",
                created_by_user_id=503,
            ))
            db.add(CollegeMembership(
                id=604, user_id=505, college_id=42, role="student", status="suspended",
                created_by_user_id=503,
            ))

    def tearDown(self):
        self.engine.dispose()

    def _resolve(self, db, user_id, role, **kwargs):
        return resolve_tenant_context(
            db,
            {"id": user_id, "role": role},
            allowed_roles=frozenset({"college_admin", "teacher", "student"}),
            **kwargs,
        )

    def test_college_slug_and_official_name_are_validated(self):
        with self.assertRaises(ValueError):
            College(slug="", official_name="Synthetic")
        with self.assertRaises(ValueError):
            College(slug="bad slug", official_name="Synthetic")
        college = College(slug="  CAMPUS_2 ", official_name="  Synthetic Institute ")
        self.assertEqual(college.slug, "campus_2")
        self.assertEqual(college.official_name, "Synthetic Institute")
        with self.Session() as db:
            db.add(college)
            db.flush()
            self.assertEqual(college.status, "pending")

    def test_unique_college_slug_and_user_college_membership_constraints(self):
        with self.Session.begin() as db:
            db.add(College(slug="college-a", official_name="Duplicate Synthetic College"))
            with self.assertRaises(IntegrityError):
                db.flush()
            db.rollback()

        with self.Session.begin() as db:
            db.add(CollegeMembership(user_id=501, college_id=41, role="teacher", status="active"))
            with self.assertRaises(IntegrityError):
                db.flush()
            db.rollback()

        # The pair is unique across all lifecycle states, not one row per status.
        with self.Session.begin() as db:
            db.add(CollegeMembership(user_id=501, college_id=41, role="teacher", status="revoked"))
            with self.assertRaises(IntegrityError):
                db.flush()
            db.rollback()

    def test_membership_check_constraints_reject_unknown_status_and_role(self):
        with self.Session.begin() as db:
            db.add(CollegeMembership(user_id=501, college_id=42, role="admin", status="active"))
            with self.assertRaises(IntegrityError):
                db.flush()
            db.rollback()

        with self.Session.begin() as db:
            db.add(CollegeMembership(user_id=501, college_id=42, role="teacher", status="enabled"))
            with self.assertRaises(IntegrityError):
                db.flush()
            db.rollback()

    def test_active_membership_resolves_and_scoped_read_uses_its_college(self):
        with self.Session() as db:
            context = self._resolve(db, 501, "teacher", requested_college_id=41)
            college = get_tenant_college(db, context)
            self.assertEqual((context.user_id, context.college_id, context.membership_role), (501, 41, "teacher"))
            self.assertEqual(college.slug, "college-a")

    def test_missing_and_inactive_memberships_are_denied(self):
        with self.Session.begin() as update_db:
            update_db.get(College, 41).status = "suspended"
        with self.Session() as db:
            with self.assertRaises(HTTPException) as missing:
                self._resolve(db, 501, "teacher", requested_college_id=42)
            self.assertEqual(missing.exception.status_code, 403)

            with self.assertRaises(HTTPException) as pending:
                self._resolve(db, 502, "admin", requested_college_id=41)
            self.assertEqual(pending.exception.status_code, 403)
            with self.assertRaises(HTTPException) as inactive:
                self._resolve(db, 505, "student", requested_college_id=42)
            self.assertEqual(inactive.exception.status_code, 403)
            with self.assertRaises(HTTPException) as suspended:
                self._resolve(db, 501, "teacher", requested_college_id=41)
            self.assertEqual(suspended.exception.status_code, 403)

    def test_ambiguous_multi_college_membership_requires_explicit_selection(self):
        with self.Session.begin() as db:
            db.add(CollegeMembership(user_id=501, college_id=42, role="teacher", status="active"))
        with self.Session() as db:
            with self.assertRaises(HTTPException) as ambiguous:
                self._resolve(db, 501, "teacher")
            self.assertEqual(ambiguous.exception.status_code, 409)
            self.assertEqual(self._resolve(db, 501, "teacher", requested_college_id=42).college_id, 42)

    def test_client_selected_other_college_cannot_override_membership(self):
        with self.Session() as db:
            with self.assertRaises(HTTPException) as denied:
                self._resolve(db, 501, "teacher", requested_college_id=42)
            self.assertEqual(denied.exception.status_code, 403)

    def test_super_admin_and_legacy_admin_do_not_gain_membership_implicitly(self):
        with self.Session() as db:
            for user_id, global_role in ((503, "super_admin"), (502, "admin")):
                with self.subTest(global_role=global_role):
                    with self.assertRaises(HTTPException) as denied:
                        self._resolve(db, user_id, global_role, requested_college_id=41)
                    self.assertEqual(denied.exception.status_code, 403)
            # A forged non-platform role cannot override the database role.
            with self.assertRaises(HTTPException) as forged:
                self._resolve(db, 503, "teacher", requested_college_id=41)
            self.assertEqual(forged.exception.status_code, 403)

    def test_membership_role_must_authorize_the_requested_operation(self):
        with self.Session() as db:
            with self.assertRaises(HTTPException) as denied:
                resolve_tenant_context(
                    db, {"id": 501, "role": "teacher"}, allowed_roles=frozenset({"college_admin"}),
                    requested_college_id=41,
                )
            self.assertEqual(denied.exception.status_code, 403)

    def test_membership_lifecycle_is_explicit_pending_and_auditable(self):
        with self.Session.begin() as db:
            pending = create_college_membership(
                db, {"id": 503}, user_id=502, college_id=42, role="college_admin",
            )
            self.assertEqual(pending.status, "pending")
            self.assertEqual(pending.created_by_user_id, 503)
            self.assertIsNone(pending.activated_at)
            activated = activate_college_membership(db, {"id": 503}, membership_id=pending.id)
            self.assertEqual(activated.status, "active")
            self.assertEqual(activated.activated_by_user_id, 503)
            revoked = revoke_college_membership(
                db, {"id": 503}, membership_id=pending.id, reason="synthetic test revocation",
            )
            self.assertEqual(revoked.status, "revoked")
            self.assertEqual(revoked.revoked_by_user_id, 503)
            self.assertEqual(revoked.status_reason, "synthetic test revocation")

    def test_legacy_admin_without_membership_cannot_create_or_activate_grants(self):
        with self.Session.begin() as db:
            with self.assertRaises(HTTPException) as denied:
                create_college_membership(
                    db, {"id": 502}, user_id=501, college_id=42, role="student",
                )
            self.assertEqual(denied.exception.status_code, 403)

    def test_college_admin_may_create_and_activate_only_child_memberships_in_own_college(self):
        with self.Session.begin() as db:
            context = resolve_tenant_context(
                db, {"id": 504, "role": "admin"}, allowed_roles=frozenset({"college_admin"}),
                requested_college_id=41,
            )
            membership = create_college_membership(
                db, {"id": 504}, user_id=505, college_id=41, role="student", college_context=context,
            )
            self.assertEqual(membership.status, "pending")
            activated = activate_college_membership(
                db, {"id": 504}, membership_id=membership.id, college_context=context,
            )
            self.assertEqual(activated.status, "active")
            with self.assertRaises(HTTPException) as denied:
                create_college_membership(
                    db, {"id": 504}, user_id=505, college_id=42, role="student", college_context=context,
                )
            self.assertEqual(denied.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
