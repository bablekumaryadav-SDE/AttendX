
import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker


# AttendX/backend/app/database.py
# .env file: AttendX/backend/.env

BACKEND_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BACKEND_DIR / ".env"

# Environment variables load karo
load_dotenv(dotenv_path=ENV_FILE)

DATABASE_URL = os.getenv("DATABASE_URL")

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
