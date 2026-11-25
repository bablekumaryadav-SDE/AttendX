"""Create the fixed AttendX owner as a one-time development Super Admin.

This script deliberately refuses production targets and refuses to promote or
overwrite an existing account. Production provisioning requires a separately
reviewed operator procedure.
"""

import getpass
import os
import sys
from pathlib import Path

from sqlalchemy import func, inspect, text

# Support the documented invocation from the backend directory.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal, engine
from app.models import User
from app.security import get_password_hash


OWNER_EMAIL = "by706734@gmail.com"
OWNER_NAME = "Bablu Kumar Yadav"


def main() -> int:
    if os.getenv("ATTENDX_BOOTSTRAP_ENV") != "development":
        print("Refusing bootstrap: set ATTENDX_BOOTSTRAP_ENV=development for an approved local development database.")
        return 2

    if engine.dialect.name != "postgresql":
        print("Refusing bootstrap: this command currently requires PostgreSQL.")
        return 2
    if (engine.url.host or "").strip("[]").lower() not in {"localhost", "127.0.0.1", "::1"}:
        print("Refusing bootstrap: development bootstrap is limited to a loopback PostgreSQL host.")
        return 2

    inspector = inspect(engine)
    if not inspector.has_table("attendance_audit_logs"):
        print("Refusing bootstrap: apply and verify the existing attendance audit migration on this non-production database first.")
        return 2
    required_audit_columns = {"user_id", "action", "entity_type", "entity_id", "metadata"}
    actual_audit_columns = {column["name"] for column in inspector.get_columns("attendance_audit_logs")}
    if not required_audit_columns.issubset(actual_audit_columns):
        print("Refusing bootstrap: attendance audit table does not match the expected schema.")
        return 2

    confirmation = input("Type DEVELOPMENT to confirm the selected local database is non-production: ").strip()
    if confirmation != "DEVELOPMENT":
        print("Bootstrap cancelled.")
        return 1

    password = getpass.getpass("Set the owner's password (input hidden): ")
    confirmation_password = getpass.getpass("Re-enter the password (input hidden): ")
    if password != confirmation_password:
        print("Passwords did not match.")
        return 1
    if len(password) < 12 or len(password.encode("utf-8")) > 72:
        print("Password must be at least 12 characters and at most 72 UTF-8 bytes.")
        return 1

    db = SessionLocal()
    try:
        existing_super_admin = db.query(User.id).filter(
            func.lower(User.role) == "super_admin"
        ).first()
        if existing_super_admin:
            print("A Super Admin already exists. Bootstrap is one-time and will not create another.")
            return 1

        existing_owner = db.query(User).filter(
            func.lower(User.email) == OWNER_EMAIL
        ).first()
        if existing_owner:
            print("The owner email already exists. No account was changed; use a separately reviewed recovery process.")
            return 1

        user = User(
            name=OWNER_NAME,
            email=OWNER_EMAIL,
            hashed_password=get_password_hash(password),
            role="super_admin",
            is_active=True,
        )
        db.add(user)
        db.flush()
        db.execute(
            text(
                """
                INSERT INTO attendance_audit_logs
                    (user_id, action, entity_type, entity_id, metadata)
                VALUES
                    (:user_id, :action, :entity_type, :entity_id, CAST(:metadata AS JSONB))
                """
            ),
            {
                "user_id": user.id,
                "action": "super_admin_bootstrap",
                "entity_type": "user",
                "entity_id": user.id,
                "metadata": '{"email":"by706734@gmail.com","source":"one_time_local_bootstrap"}',
            },
        )
        db.commit()
        print("Super Admin account created and bootstrap event recorded. Password was not displayed.")
        print("Sign in through the common AttendX login page with the configured owner email.")
        return 0
    except Exception as exc:
        db.rollback()
        print(f"Bootstrap failed; the transaction was rolled back ({type(exc).__name__}).")
        return 1
    finally:
        password = ""
        confirmation_password = ""
        db.close()


if __name__ == "__main__":
    sys.exit(main())
