from sqlalchemy import text

from app.database import engine


print("=" * 60)
print("ATTENDX POSTGRESQL CONNECTION TEST")
print("=" * 60)


try:

    with engine.connect() as connection:

        result = connection.execute(
            text(
                """
                SELECT
                    current_database(),
                    current_user,
                    version()
                """
            )
        )

        database_name, database_user, version = (
            result.fetchone()
        )


    print()
    print("DATABASE :", database_name)
    print("USER     :", database_user)
    print(
        "POSTGRES :",
        version.split(",")[0],
    )

    print()
    print("Connection successful: 1")

except Exception as error:

    print()
    print("=" * 60)
    print("DATABASE CONNECTION FAILED")
    print("=" * 60)
    print(repr(error))
    print("=" * 60)

    raise