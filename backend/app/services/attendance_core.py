import hashlib
import hmac
import math
import secrets
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import text


def utcnow():
    return datetime.now(timezone.utc)


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


def get_teacher_for_user(db, user_id: int):
    row = db.execute(
        text(
            """
            SELECT t.*
            FROM teachers t
            JOIN users u
              ON LOWER(u.email) = LOWER(t.email)
            WHERE u.id = :user_id
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
):
    db.execute(
        text(
            """
            INSERT INTO attendance_audit_logs
            (
                user_id,
                action,
                entity_type,
                entity_id,
                metadata
            )
            VALUES
            (
                :user_id,
                :action,
                :entity_type,
                :entity_id,
                CAST(:metadata AS JSONB)
            )
            """
        ),
        {
            "user_id": user_id,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "metadata": "{}"
            if metadata is None
            else str(metadata),
        },
    )