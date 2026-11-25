"""Small environment-backed application configuration helpers."""
import os
from urllib.parse import urlsplit


DEFAULT_ALLOWED_ORIGINS = (
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:5176",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5175",
    "http://127.0.0.1:5176",
)


def parse_allowed_origins(value: str | None) -> list[str]:
    """Parse a comma-separated list of explicit HTTP(S) browser origins."""
    if value is None or not value.strip():
        return list(DEFAULT_ALLOWED_ORIGINS)

    origins = []
    for candidate in value.split(","):
        origin = candidate.strip().rstrip("/")
        if not origin:
            continue
        if origin == "*":
            raise ValueError("CORS_ALLOWED_ORIGINS must not contain '*'.")

        parsed = urlsplit(origin)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.netloc
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError(
                "CORS_ALLOWED_ORIGINS entries must be bare HTTP(S) origins."
            )
        if origin not in origins:
            origins.append(origin)

    if not origins:
        raise ValueError("CORS_ALLOWED_ORIGINS must include at least one origin.")
    return origins


def get_allowed_origins() -> list[str]:
    try:
        return parse_allowed_origins(os.getenv("CORS_ALLOWED_ORIGINS"))
    except ValueError as exc:
        raise RuntimeError(str(exc)) from exc
