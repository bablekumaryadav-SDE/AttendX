from sqlalchemy import text

from app.database import (
    Base,
    SessionLocal,
    engine,
)

from app import models

from app.models import User

from app.security import (
    get_password_hash,
    verify_password,
)


# ============================================================
# ADMIN DETAILS
# ============================================================

ADMIN_NAME = "AttendX Administrator"

ADMIN_EMAIL = "admin@attendx.com"

ADMIN_PASSWORD = "Admin@123"


print("=" * 60)
print("ATTENDX ADMIN SETUP")
print("=" * 60)


# ============================================================
# DATABASE TEST
# ============================================================

print()
print("Testing PostgreSQL...")

with engine.connect() as connection:

    result = connection.execute(
        text(
            """
            SELECT
                current_database(),
                current_user
            """
        )
    )

    database_name, database_user = (
        result.fetchone()
    )


print(
    "Database :",
    database_name,
)

print(
    "User     :",
    database_user,
)


# ============================================================
# CREATE TABLES
# ============================================================

print()
print("Creating tables...")

Base.metadata.create_all(
    bind=engine
)

print("Tables ready.")


# ============================================================
# DATABASE SESSION
# ============================================================

db = SessionLocal()


try:

    email = (
        ADMIN_EMAIL
        .strip()
        .lower()
    )


    # --------------------------------------------------------
    # SEARCH ADMIN
    # --------------------------------------------------------

    admin = (
        db.query(User)
        .filter(
            User.email == email
        )
        .first()
    )


    # --------------------------------------------------------
    # HASH PASSWORD
    # --------------------------------------------------------

    hashed_password = get_password_hash(
        ADMIN_PASSWORD
    )


    # --------------------------------------------------------
    # CREATE / UPDATE
    # --------------------------------------------------------

    if admin is None:

        print()
        print(
            "Admin not found."
        )

        print(
            "Creating admin account..."
        )

        admin = User(
            name=ADMIN_NAME,
            email=email,
            hashed_password=hashed_password,
            role="admin",
            is_active=True,
        )

        db.add(admin)

    else:

        print()
        print(
            "Admin already exists."
        )

        print(
            "Updating admin account..."
        )

        admin.name = ADMIN_NAME

        admin.email = email

        admin.hashed_password = (
            hashed_password
        )

        admin.role = "admin"

        admin.is_active = True


    # --------------------------------------------------------
    # SAVE
    # --------------------------------------------------------

    db.commit()

    db.refresh(admin)


    # --------------------------------------------------------
    # VERIFY PASSWORD
    # --------------------------------------------------------

    password_ok = verify_password(
        ADMIN_PASSWORD,
        admin.hashed_password,
    )


    print()
    print("=" * 60)
    print("ADMIN ACCOUNT READY")
    print("=" * 60)

    print(
        "ID       :",
        admin.id,
    )

    print(
        "Name     :",
        admin.name,
    )

    print(
        "Email    :",
        admin.email,
    )

    print(
        "Password :",
        ADMIN_PASSWORD,
    )

    print(
        "Role     :",
        admin.role,
    )

    print(
        "Active   :",
        admin.is_active,
    )

    print(
        "Password test:",
        password_ok,
    )

    print("=" * 60)


except Exception as error:

    db.rollback()

    print()
    print("=" * 60)
    print("ADMIN CREATION FAILED")
    print("=" * 60)

    print(repr(error))

    print("=" * 60)

    raise

finally:

    db.close()