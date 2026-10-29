from app.database import (
    Base,
    engine,
)

# IMPORTANT:
# Import models so SQLAlchemy registers every model
# before create_all() is executed.
from app import models


print("=" * 60)
print("ATTENDX DATABASE SETUP")
print("=" * 60)

print()
print("Database driver :", engine.url.drivername)
print("Database name   :", engine.url.database)
print("Database host   :", engine.url.host)
print("Database port   :", engine.url.port)

print()
print("Testing PostgreSQL connection...")


try:

    with engine.connect() as connection:

        connection.exec_driver_sql(
            "SELECT 1"
        )

    print("PostgreSQL connection: OK")

except Exception as error:

    print()
    print("POSTGRESQL CONNECTION FAILED")
    print("-" * 60)
    print(repr(error))
    print("-" * 60)
    raise


print()
print("Creating AttendX tables...")

Base.metadata.create_all(
    bind=engine
)

print()
print("=" * 60)
print("ALL TABLES CREATED SUCCESSFULLY")
print("=" * 60)