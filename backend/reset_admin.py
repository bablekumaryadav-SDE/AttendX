from app.database import SessionLocal
from app.models import User
from app.security import get_password_hash


ADMIN_EMAIL = "admin@gmail.com"
# Development passwor.
# After successful login, change it from the application's
# user/account management flow when that feature is available.
NEW_PASSWORD = "Admin12345"


def reset_admin():
    db = SessionLocal()

    try:
        user = (
            db.query(User)
            .filter(User.email == ADMIN_EMAIL)
            .first()
        )

        if user is None:
            print("Admin user not found.")
            print("Creating admin account...")

            user = User(
                email=ADMIN_EMAIL,
                hashed_password=get_password_hash(
                    NEW_PASSWORD
                ),
                role="admin",
                is_active=True,
            )

            db.add(user)
            db.commit()
            db.refresh(user)

            print("Admin account created.")
            print(f"Email: {ADMIN_EMAIL}")
            print("Password: Admin@12345")
            return

        user.hashed_password = get_password_hash(
            NEW_PASSWORD
        )
        user.role = "admin"
        user.is_active = True

        db.commit()

        print("Admin account reset successfully.")
        print(f"Email: {ADMIN_EMAIL}")
        print("Password: Admin@12345")
        print("Role: admin")
        print("Active: True")

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()


if __name__ == "__main__":
    reset_admin()