import hashlib
import hmac
import json
import math
import secrets
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import text


def utcnow():
    return datetime.now(timezone.utc)


def normalize_session_datetimes(row):
    """Normalize raw SQL session timestamps for both PostgreSQL and SQLite."""
    if row is None:
        return row

    normalized = dict(row)
    for field in ("starts_at", "ends_at", "qr_expires_at", "created_at", "closed_at"):
        value = normalized.get(field)
        if isinstance(value, str):
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if isinstance(value, datetime) and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        normalized[field] = value
    return normalized


def new_qr_secret():
    return secrets.token_urlsafe(32)


def build_qr_token(session_id: int, secret: str, expires_at):
    timestamp = int(expires_at.timestamp())

    payload = f"{session_id}:{timestamp}"

    signature = hmac.new(
        secret.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    return f"AXQR.{session_id}.{timestamp}.{signature}"


def verify_qr_token(token: str, session_id: int, secret: str):
    try:
        prefix, token_session, timestamp, signature = token.split(".")

        if prefix != "AXQR":
            return False

        if int(token_session) != int(session_id):
            return False

        payload = f"{session_id}:{int(timestamp)}"

        expected = hmac.new(
            secret.encode("utf-8"),
            payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        if not hmac.compare_digest(
            signature,
            expected,
        ):
            return False

        if int(timestamp) < int(utcnow().timestamp()):
            return False

        return True

    except (ValueError, TypeError):
        return False


def verify_current_qr_token(token: str, session_id: int, secret: str, expires_at):
    """Verify signature and require this token to be the currently published QR."""
    if not expires_at or not verify_qr_token(token, session_id, secret):
        return False
    try:
        prefix, token_session, timestamp, _signature = token.split(".")
        return (
            prefix == "AXQR"
            and int(token_session) == int(session_id)
            and int(timestamp) == int(expires_at.timestamp())
        )
    except (AttributeError, ValueError, TypeError):
        return False


def haversine_m(
    lat1,
    lon1,
    lat2,
    lon2,
):
    if None in (lat1, lon1, lat2, lon2):
        return None

    radius = 6371000

    p1 = math.radians(float(lat1))
    p2 = math.radians(float(lat2))

    delta_p = math.radians(
        float(lat2) - float(lat1)
    )

    delta_l = math.radians(
        float(lon2) - float(lon1)
    )

    a = (
        math.sin(delta_p / 2) ** 2
        + math.cos(p1)
        * math.cos(p2)
        * math.sin(delta_l / 2) ** 2
    )

    return (
        2
        * radius
        * math.atan2(
            math.sqrt(a),
            math.sqrt(1 - a),
        )
    )


def validate_geofence_fix(latitude, longitude, accuracy_m, radius_m, accuracy_limit_m=100):
    """Validate measured GPS accuracy independently from the classroom fence radius."""
    from fastapi import HTTPException

    if latitude is None or longitude is None:
        raise HTTPException(status_code=400, detail="Location permission is required for this attendance session.")
    latitude = float(latitude)
    longitude = float(longitude)
    if (
        not math.isfinite(latitude)
        or not math.isfinite(longitude)
        or not -90 <= latitude <= 90
        or not -180 <= longitude <= 180
    ):
        raise HTTPException(status_code=400, detail="GPS coordinates are outside valid latitude/longitude ranges.")
    if accuracy_m is None:
        raise HTTPException(status_code=400, detail="GPS accuracy was not provided. Refresh your location and retry.")
    accuracy_m = float(accuracy_m)
    radius_m = float(radius_m)
    if not math.isfinite(accuracy_m) or accuracy_m < 0:
        raise HTTPException(status_code=400, detail="GPS accuracy must be a finite, non-negative distance in metres.")
    if not math.isfinite(radius_m) or radius_m <= 0:
        raise HTTPException(status_code=500, detail="The attendance geofence is not configured with a valid radius.")
    try:
        accuracy_limit_m = float(accuracy_limit_m)
    except (TypeError, ValueError):
        raise HTTPException(status_code=500, detail="The College GPS accuracy limit is invalid.")
    if not math.isfinite(accuracy_limit_m) or not 1 <= accuracy_limit_m <= 150:
        raise HTTPException(status_code=500, detail="The College GPS accuracy limit is invalid.")
    if accuracy_m > accuracy_limit_m:
        raise HTTPException(
            status_code=403,
            detail=f"GPS accuracy is too low ({round(accuracy_m)} m). This College requires accuracy within {accuracy_limit_m:g} m. Retry with a more precise location.",
        )
    return accuracy_m


def get_college_gps_accuracy_limit(db, college_id):
    """Read the persisted limit for the session's College; never use a client value."""
    from fastapi import HTTPException
    from sqlalchemy.exc import SQLAlchemyError

    from app.models import College

    if college_id is None:
        raise HTTPException(status_code=503, detail="College GPS accuracy settings are unavailable for this session.")
    try:
        limit_m = db.query(College.gps_accuracy_limit_m).filter(College.id == college_id).scalar()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=503,
            detail="College GPS accuracy settings are unavailable. The reviewed College settings migration may be required.",
        ) from exc
    if isinstance(limit_m, bool) or not isinstance(limit_m, int) or not 1 <= limit_m <= 150:
        raise HTTPException(status_code=503, detail="College GPS accuracy settings are unavailable or invalid.")
    return limit_m


def get_teacher_for_user(db, user_id: int):
    row = db.execute(
        text(
            """
            SELECT t.*
            FROM teachers t
            JOIN users u
              ON LOWER(u.email) = LOWER(t.email)
            WHERE u.id = :user_id
              AND t.is_active = TRUE
            LIMIT 1
            """
        ),
        {"user_id": user_id},
    ).mappings().first()

    if not row:
        raise HTTPException(
            status_code=404,
            detail="Teacher profile not found.",
        )

    return row


def ensure_teacher_or_admin(db, current_user):
    role = current_user.get("role")

    if role == "teacher":
        return get_teacher_for_user(
            db,
            int(current_user["sub"]),
        )

    if role == "admin":
        return None

    raise HTTPException(
        status_code=403,
        detail="Teacher or admin access required.",
    )


def log_audit(
    db,
    user_id,
    action,
    entity_type=None,
    entity_id=None,
    metadata=None,
    college_id=None,
):
    """Write an audit event; tenant callers must pass a resolved context ID.

    Existing callers omit college_id and remain global/unknown. This helper
    never infers tenant ownership from entity IDs or the user's global role.
    """
    db.execute(
        text(
            """
            INSERT INTO attendance_audit_logs
            (
                user_id,
                college_id,
                action,
                entity_type,
                entity_id,
                metadata
            )
            VALUES
            (
                :user_id,
                :college_id,
                :action,
                :entity_type,
                :entity_id,
                CAST(:metadata AS JSONB)
            )
            """
        ),
        {
            "user_id": user_id,
            "college_id": college_id,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "metadata": json.dumps(metadata or {}, separators=(",", ":"), default=str),
        },
    )
