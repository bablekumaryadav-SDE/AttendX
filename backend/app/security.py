import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import bcrypt
from dotenv import load_dotenv
from fastapi import HTTPException, status
from jose import JWTError, jwt


BACKEND_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BACKEND_DIR / ".env"

# Keep the established isolated-test opt-out effective for every backend
# configuration module. Normal application startup still loads the same file.
if os.getenv("ATTENDX_SKIP_DOTENV") != "1":
    load_dotenv(dotenv_path=ENV_FILE)


def validate_jwt_settings(secret_key, algorithm, expiry_minutes):
    """Validate JWT settings without ever including secret material in errors."""
    if (
        not secret_key
        or secret_key == "attendx-development-secret-key-change-later"
        or len(secret_key.encode("utf-8")) < 32
    ):
        raise RuntimeError(
            "Backend .env mein kam se kam 32 bytes ka strong SECRET_KEY set karein. "
            f"Environment file: {ENV_FILE}"
        )
    if algorithm != "HS256":
        raise RuntimeError("ALGORITHM must be HS256 for AttendX JWT signing.")
    try:
        expiry_minutes = int(expiry_minutes)
    except (TypeError, ValueError) as exc:
        raise RuntimeError("ACCESS_TOKEN_EXPIRE_MINUTES ek integer hona chahiye.") from exc
    if expiry_minutes <= 0:
        raise RuntimeError("ACCESS_TOKEN_EXPIRE_MINUTES zero se zyada hona chahiye.")
    return expiry_minutes


SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = validate_jwt_settings(
    SECRET_KEY,
    ALGORITHM,
    os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"),
)


def get_password_hash(password: str) -> str:
    """Password ko bcrypt se hash karta hai."""
    password_bytes = password.encode("utf-8")

    if len(password_bytes) > 72:
        raise ValueError(
            "Password bcrypt ki 72-byte limit se zyada hai."
        )

    hashed = bcrypt.hashpw(
        password_bytes,
        bcrypt.gensalt(),
    )

    return hashed.decode("utf-8")


def verify_password(
    plain_password: str,
    hashed_password: str,
) -> bool:
    """Entered password ko stored hash se verify karta hai."""
    password_bytes = plain_password.encode("utf-8")

    if len(password_bytes) > 72:
        return False

    try:
        return bcrypt.checkpw(
            password_bytes,
            hashed_password.encode("utf-8"),
        )
    except (ValueError, TypeError, AttributeError):
        return False


def create_access_token(data: dict) -> str:
    """JWT token create karta hai aur expiry add karta hai."""
    payload = data.copy()

    expiry = datetime.now(timezone.utc) + timedelta(
        minutes=ACCESS_TOKEN_EXPIRE_MINUTES
    )

    payload["exp"] = expiry

    return jwt.encode(
        payload,
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def decode_access_token(token: str) -> dict:
    """JWT verify karta hai aur valid payload return karta hai."""
    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM],
        )

        if payload.get("sub") is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication token.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        return payload

    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
