"""Fail-closed URL selection for future PostgreSQL integration tests.

This module parses configuration only. It never creates an engine or connects.
Callers must still verify and explicitly approve the disposable server/database.
"""

import os
import re
from pathlib import Path
from typing import Mapping

from dotenv import dotenv_values
from sqlalchemy.engine import URL, make_url


BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_APPLICATION_ENV_FILE = BACKEND_DIR / ".env"
TEST_DATABASE_ENV_VAR = "ATTENDX_TEST_DATABASE_URL"
APPLICATION_DATABASE_ENV_VAR = "DATABASE_URL"
TEST_DATABASE_NAME_PATTERN = re.compile(r"(?:^|[_-])(test|testing|integration|ci)(?:[_-]|$)", re.IGNORECASE)
PRODUCTION_NAME_PATTERN = re.compile(r"(?:^|[_-])(prod|production|stage|staging|live)(?:[_-]|$)", re.IGNORECASE)


class TestDatabaseConfigurationError(ValueError):
    """Sanitized configuration error; never includes URL contents."""


def _application_url(environ: Mapping[str, str], env_file: Path) -> str | None:
    value = environ.get(APPLICATION_DATABASE_ENV_VAR)
    if value:
        return value.strip() or None
    if env_file.is_file():
        # dotenv_values parses locally and does not mutate process environment.
        value = dotenv_values(env_file).get(APPLICATION_DATABASE_ENV_VAR)
        if isinstance(value, str):
            return value.strip() or None
    return None


def _parse_url(value: str) -> URL:
    try:
        return make_url(value)
    except Exception as exc:
        raise TestDatabaseConfigurationError("Database URL is invalid.") from exc


def _host_key(host: str | None) -> str | None:
    if not host:
        return None
    normalized = host.strip().strip("[]").lower()
    if normalized in {"localhost", "127.0.0.1", "::1"}:
        return "loopback"
    return normalized


def _database_identity(url: URL) -> tuple[str, str | None, int, str | None]:
    return (
        url.get_backend_name().lower(),
        _host_key(url.host),
        url.port or 5432,
        url.database,
    )


def require_test_database_url(
    environ: Mapping[str, str] | None = None,
    *,
    application_env_file: Path = DEFAULT_APPLICATION_ENV_FILE,
) -> URL:
    """Return only a clearly named local PostgreSQL test URL, without connecting.

    Never falls back to DATABASE_URL. Requiring a distinct database identity,
    local address, test marker, non-production name and separate role helps
    prevent accidental use of the configured application database. It does
    not prove that the local PostgreSQL cluster itself is disposable.
    """
    env = os.environ if environ is None else environ
    raw_test_url = env.get(TEST_DATABASE_ENV_VAR)
    if not isinstance(raw_test_url, str) or not raw_test_url.strip():
        raise TestDatabaseConfigurationError(
            f"Set {TEST_DATABASE_ENV_VAR} to a verified disposable PostgreSQL test database."
        )

    raw_application_url = _application_url(env, application_env_file)
    if not raw_application_url:
        raise TestDatabaseConfigurationError(
            "Configured application database identity is unavailable; refusing test connection."
        )

    test_url = _parse_url(raw_test_url.strip())
    application_url = _parse_url(raw_application_url)
    if test_url.get_backend_name().lower() != "postgresql":
        raise TestDatabaseConfigurationError("Test database must use PostgreSQL.")
    if application_url.get_backend_name().lower() != "postgresql":
        raise TestDatabaseConfigurationError(
            "Configured application database identity is not a comparable PostgreSQL target."
        )

    host = _host_key(test_url.host)
    if host != "loopback":
        raise TestDatabaseConfigurationError("Test database host must be an explicitly verified loopback address.")
    if not test_url.database or not TEST_DATABASE_NAME_PATTERN.search(test_url.database):
        raise TestDatabaseConfigurationError("Test database name must contain a test, integration, or ci marker.")
    if PRODUCTION_NAME_PATTERN.search(test_url.database):
        raise TestDatabaseConfigurationError("Production-like database names are not allowed for tests.")
    if not test_url.username or not application_url.username or test_url.username == application_url.username:
        raise TestDatabaseConfigurationError("Use a separate non-empty test-only database role.")

    if _database_identity(test_url) == _database_identity(application_url):
        raise TestDatabaseConfigurationError(
            "Test target matches the configured application database; refusing test connection."
        )
    return test_url
