
import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker


# AttendX/backend/app/database.py
# .env file: AttendX/backend/.env

BACKEND_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BACKEND_DIR / ".env"
SKIP_DOTENV_ENV = "ATTENDX_SKIP_DOTENV"
ISOLATED_DATABASE_URL_ENV = "ATTENDX_TEST_SQLALCHEMY_URL"


def resolve_database_url(environ=None, *, dotenv_loader=load_dotenv):
    """Resolve the normal application URL or an explicit isolated test URL.

    Production behavior is unchanged unless ATTENDX_SKIP_DOTENV=1 is explicitly
    set. In that mode, do not read DATABASE_URL or the dotenv file; require a
    separate test URL so test imports cannot silently fall back to application
    configuration.
    """
    values = os.environ if environ is None else environ
    if values.get(SKIP_DOTENV_ENV) == "1":
        test_url = values.get(ISOLATED_DATABASE_URL_ENV)
        if not isinstance(test_url, str) or not test_url.strip():
            raise RuntimeError(f"{ISOLATED_DATABASE_URL_ENV} is required when dotenv loading is disabled.")
        return test_url.strip()

    dotenv_loader(dotenv_path=ENV_FILE)
    database_url = values.get("DATABASE_URL")
    if not database_url and environ is None:
        database_url = os.getenv("DATABASE_URL")
    return database_url


DATABASE_URL = resolve_database_url()

if not DATABASE_URL:
    raise RuntimeError(
        f"DATABASE_URL missing hai. .env file check karo: {ENV_FILE}"
    )

# SQLAlchemy engine configuration
engine_options = {
    "pool_pre_ping": True,
}

# SQLite ke liye required configuration
if DATABASE_URL.startswith("sqlite"):
    engine_options["connect_args"] = {
        "check_same_thread": False,
    }

# Database engine
engine = create_engine(
    DATABASE_URL,
    **engine_options,
)

# Database session
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

# ORM base class
Base = declarative_base()


def get_db():
    """Har API request ke liye database session provide karo."""
    db = SessionLocal()

    try:
        yield db
    finally:
        db.close()
