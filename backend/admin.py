from app.database import SessionLocal
from app.models import User
from app.security import get_password_hash


def create_admin():
    db = SessionLocal()

    try:
        email = "admin@attendx.com"

        existing_user = db.query(User).filter(User.email == email).first()

        if existing_user:
            print("Admin user already exists.")
            return

        admin = User(
            name="AttendX Admin",
            email=email,
            hashed_password=get_password_hash("Admin@123"),
            role="admin",
            is_active=True,
        )

        db.add(admin)
        db.commit()
        db.refresh(admin)

        print("Admin user created successfully.")
        print("Email: admin@attendx.com")
        print("Password: Admin@123")

    finally:
        db.close()


if __name__ == "__main__":
    create_admin()