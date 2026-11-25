from datetime import datetime, timezone

from sqlalchemy import inspect, text

from app.database import SessionLocal, engine
from app.models import (
    FaceEmbedding,
    Student,
    StudentIdCounter,
)


STUDENT_CODE_PREFIX = "ATX"


def ensure_student_module_schema() -> None:
    """
    Create/migrate only the database objects required by
    the Students module.

    Existing student records are preserved.
    """

    inspector = inspect(engine)

    if "students" not in inspector.get_table_names():
        Student.__table__.create(
            bind=engine,
            checkfirst=True,
        )

    inspector = inspect(engine)

    student_columns = {
        column["name"]
        for column in inspector.get_columns("students")
    }

    with engine.begin() as connection:

        if "student_code" not in student_columns:

            if engine.dialect.name == "postgresql":
                connection.execute(
                    text(
                        "ALTER TABLE students "
                        "ADD COLUMN IF NOT EXISTS "
                        "student_code VARCHAR(20)"
                    )
                )

            else:
                connection.execute(
                    text(
                        "ALTER TABLE students "
                        "ADD COLUMN student_code VARCHAR(20)"
                    )
                )

        connection.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS "
                "uq_students_student_code "
                "ON students(student_code)"
            )
        )

    FaceEmbedding.__table__.create(
        bind=engine,
        checkfirst=True,
    )

    StudentIdCounter.__table__.create(
        bind=engine,
        checkfirst=True,
    )

    _backfill_student_codes()


def _backfill_student_codes() -> None:
    """
    Give existing legacy students a permanent AttendX ID.
    """

    db = SessionLocal()

    try:
        year = datetime.now(timezone.utc).year

        students = (
            db.query(Student)
            .filter(Student.student_code.is_(None))
            .order_by(Student.id.asc())
            .all()
        )

        used_numbers = set()

        existing_codes = (
            db.query(Student.student_code)
            .filter(
                Student.student_code.is_not(None)
            )
            .all()
        )

        for (code,) in existing_codes:
            try:
                number = int(
                    str(code).rsplit("-", 1)[1]
                )

                used_numbers.add(number)

            except (ValueError, IndexError):
                continue

        next_number = (
            max(used_numbers, default=0) + 1
        )

        for student in students:

            number = max(
                student.id,
                next_number,
            )

            while number in used_numbers:
                number += 1

            student.student_code = (
                f"{STUDENT_CODE_PREFIX}-"
                f"{year}-"
                f"{number:04d}"
            )

            used_numbers.add(number)

            next_number = number + 1

        counter = (
            db.query(StudentIdCounter)
            .filter(
                StudentIdCounter.year == year
            )
            .first()
        )

        current_max = max(
            used_numbers,
            default=0,
        )

        if counter is None:

            counter = StudentIdCounter(
                year=year,
                last_number=current_max,
            )

            db.add(counter)

        elif counter.last_number < current_max:

            counter.last_number = current_max

        db.commit()

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()


def next_student_code(db) -> str:
    """
    Generate a concurrency-safe ID.

    Example:
        ATX-2026-0001
        ATX-2026-0002
    """

    year = datetime.now(timezone.utc).year

    if engine.dialect.name == "postgresql":

        db.execute(
            text(
                "SELECT pg_advisory_xact_lock(:lock_key)"
            ),
            {
                "lock_key": year,
            },
        )

        db.execute(
            text(
                "INSERT INTO student_id_counters "
                "(year, last_number) "
                "VALUES (:year, 0) "
                "ON CONFLICT (year) DO NOTHING"
            ),
            {
                "year": year,
            },
        )

    else:

        counter = (
            db.query(StudentIdCounter)
            .filter(
                StudentIdCounter.year == year
            )
            .first()
        )

        if counter is None:

            db.add(
                StudentIdCounter(
                    year=year,
                    last_number=0,
                )
            )

            db.flush()

    counter = (
        db.query(StudentIdCounter)
        .filter(
            StudentIdCounter.year == year
        )
        .with_for_update()
        .one()
    )

    counter.last_number += 1

    return (
        f"{STUDENT_CODE_PREFIX}-"
        f"{year}-"
        f"{counter.last_number:04d}"
    )