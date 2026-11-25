"""Alembic environment using the existing AttendX SQLAlchemy engine."""

from alembic import context

from app.database import Base, engine
from app import models  # noqa: F401 - register all tables in Base.metadata


config = context.config
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    # Do not render a URL containing credentials into generated SQL or logs.
    raise RuntimeError("Offline Alembic migrations are disabled; use the configured online database connection.")


def run_migrations_online() -> None:
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
            version_table_schema="public" if connection.dialect.name == "postgresql" else None,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
