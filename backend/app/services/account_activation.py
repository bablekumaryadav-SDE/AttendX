"""Secret-safe one-time account activation and invitation delivery."""

import hashlib
import logging
import os
import secrets
import smtplib
import ssl
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from urllib.parse import urlsplit

from fastapi import HTTPException, Request, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models import (
    AccountInvitation,
    College,
    CollegeMembership,
    Student,
    Teacher,
    User,
)
from app.password_policy import is_password_policy_valid
from app.security import get_password_hash


logger = logging.getLogger(__name__)
GENERIC_ACTIVATION_ERROR = "This activation link is invalid, expired, or already used. Request a new invitation."


def _smtp_configuration():
    """Read configuration at delivery time; never include values in diagnostics."""
    names = (
        "ATTENDX_ACTIVATION_SMTP_HOST",
        "ATTENDX_ACTIVATION_SMTP_PORT",
        "ATTENDX_ACTIVATION_SMTP_USERNAME",
        "ATTENDX_ACTIVATION_SMTP_PASSWORD",
        "ATTENDX_ACTIVATION_FROM_EMAIL",
        "ATTENDX_PUBLIC_URL",
    )
    values = {name: os.getenv(name) for name in names}
    if any(not value for value in values.values()):
        return None
    try:
        port = int(values["ATTENDX_ACTIVATION_SMTP_PORT"])
    except (TypeError, ValueError):
        return None
    if not 1 <= port <= 65535:
        return None
    parsed = urlsplit(values["ATTENDX_PUBLIC_URL"])
    loopback_http = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if (
        parsed.scheme not in {"https", "http"}
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or (parsed.scheme != "https" and not loopback_http)
    ):
        return None
    return values, port, values["ATTENDX_PUBLIC_URL"].rstrip("/")


def _invitation_ttl():
    """Return a bounded operator-configured TTL; default to 24 hours."""
    raw_hours = os.getenv("ATTENDX_ACTIVATION_TTL_HOURS", "24")
    try:
        hours = int(raw_hours)
    except (TypeError, ValueError):
        hours = 24
    if not 1 <= hours <= 168:
        hours = 24
    return timedelta(hours=hours)


def _deliver_email(host, port, username, password, sender, recipient, activation_url):
    message = EmailMessage()
    message["Subject"] = "Set up your AttendX account"
    message["From"] = sender
    message["To"] = recipient
    message.set_content(
        "Use this one-time link within 24 hours to set your AttendX password:\n\n"
        f"{activation_url}\n\nIf you did not expect this invitation, ignore this message."
    )
    context = ssl.create_default_context()
    with smtplib.SMTP(host, port, timeout=15) as client:
        client.ehlo()
        client.starttls(context=context)
        client.ehlo()
        client.login(username, password)
        client.send_message(message)


def issue_invitation(db: Session, *, user: User, membership: CollegeMembership, actor_user_id: int):
    """Persist a digest before delivery; never return or log the raw token."""
    configuration = _smtp_configuration()
    if configuration is None:
        return "not_configured"

    values, port, public_url = configuration
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    try:
        locked_membership = db.query(CollegeMembership).filter(
            CollegeMembership.id == membership.id,
            CollegeMembership.user_id == user.id,
            CollegeMembership.college_id == membership.college_id,
            CollegeMembership.status == "pending",
        ).with_for_update().one_or_none()
        if locked_membership is None or user.is_active:
            db.rollback()
            return "unavailable"
        db.query(AccountInvitation).filter(
            AccountInvitation.membership_id == locked_membership.id,
            AccountInvitation.consumed_at.is_(None),
            AccountInvitation.revoked_at.is_(None),
        ).update({AccountInvitation.revoked_at: now}, synchronize_session=False)
        invitation = AccountInvitation(
            college_id=membership.college_id,
            membership_id=membership.id,
            user_id=user.id,
            token_digest=hashlib.sha256(token.encode("utf-8")).hexdigest(),
            expires_at=now + _invitation_ttl(),
            delivery_status="failed",
            created_by_user_id=actor_user_id,
        )
        db.add(invitation)
        db.commit()
        db.refresh(invitation)
    except SQLAlchemyError:
        db.rollback()
        return "unavailable"

    # The one-time token is sent only in the message body and is never returned
    # to the caller, persisted in plaintext, or included in logs/exceptions.
    activation_url = f"{public_url}/activate-account#token={token}"
    try:
        _deliver_email(
            values["ATTENDX_ACTIVATION_SMTP_HOST"],
            port,
            values["ATTENDX_ACTIVATION_SMTP_USERNAME"],
            values["ATTENDX_ACTIVATION_SMTP_PASSWORD"],
            values["ATTENDX_ACTIVATION_FROM_EMAIL"],
            user.email,
            activation_url,
        )
        invitation.delivery_status = "sent"
        invitation.sent_at = datetime.now(timezone.utc)
        db.commit()
        return "sent"
    except Exception:
        db.rollback()
        try:
            failed = db.query(AccountInvitation).filter(AccountInvitation.id == invitation.id).one_or_none()
            if failed is not None:
                failed.delivery_status = "failed"
                db.commit()
        except SQLAlchemyError:
            db.rollback()
        logger.warning("Account invitation delivery failed; invitation_id=%s", invitation.id)
        return "failed"


def invitation_status(db: Session, membership: CollegeMembership):
    invitation = db.query(AccountInvitation).filter(
        AccountInvitation.membership_id == membership.id,
        AccountInvitation.college_id == membership.college_id,
    ).order_by(AccountInvitation.created_at.desc(), AccountInvitation.id.desc()).first()
    if membership.status == "active":
        return {"status": "activated", "expires_at": None}
    if invitation is None:
        return {"status": "not_sent", "expires_at": None}
    if invitation.revoked_at is not None:
        return {"status": "revoked", "expires_at": invitation.expires_at}
    if invitation.consumed_at is not None:
        return {"status": "activated", "expires_at": invitation.expires_at}
    expiry = invitation.expires_at
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    if expiry <= datetime.now(timezone.utc):
        return {"status": "expired", "expires_at": invitation.expires_at}
    return {"status": invitation.delivery_status, "expires_at": invitation.expires_at}


def _valid_password(password: str) -> bool:
    return is_password_policy_valid(password)


async def complete_activation(request: Request, db: Session):
    """Consume an invitation atomically without echoing request secrets in 422s."""
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Activation request is invalid.") from None
    if not isinstance(payload, dict) or set(payload) != {"token", "password"}:
        raise HTTPException(status_code=400, detail="Activation request is invalid.")
    token = payload.get("token")
    password = payload.get("password")
    if not isinstance(token, str) or not isinstance(password, str) or not token or len(token) > 256:
        raise HTTPException(status_code=400, detail="Activation request is invalid.")
    if not _valid_password(password):
        raise HTTPException(
            status_code=400,
            detail="Choose a password with at least 12 characters, uppercase and lowercase letters, a number, and a symbol.",
        )

    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc)
    try:
        candidate = db.query(AccountInvitation.id, AccountInvitation.membership_id).filter(
            AccountInvitation.token_digest == digest,
        ).one_or_none()
        if candidate is None:
            raise HTTPException(status_code=400, detail=GENERIC_ACTIVATION_ERROR)
        # Resend and activation lock in the same order (membership, invitation)
        # to serialize issuance/consumption without lock-order deadlocks.
        membership = db.query(CollegeMembership).filter(
            CollegeMembership.id == candidate.membership_id,
            CollegeMembership.status == "pending",
        ).with_for_update().one_or_none()
        invitation = db.query(AccountInvitation).filter(
            AccountInvitation.id == candidate.id,
            AccountInvitation.token_digest == digest,
        ).with_for_update().one_or_none()
        if invitation is None:
            raise HTTPException(status_code=400, detail=GENERIC_ACTIVATION_ERROR)
        expires_at = invitation.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if membership is not None and (
            membership.user_id != invitation.user_id
            or membership.college_id != invitation.college_id
        ):
            membership = None
        user = db.query(User).filter(User.id == invitation.user_id, User.is_active.is_(False)).one_or_none()
        college = db.query(College).filter(College.id == invitation.college_id, College.status == "active").one_or_none()
        if (
            invitation.revoked_at is not None
            or invitation.consumed_at is not None
            or expires_at <= now
            or invitation.delivery_status != "sent"
            or membership is None
            or user is None
            or college is None
            or user.email.strip().lower() == ""
        ):
            raise HTTPException(status_code=400, detail=GENERIC_ACTIVATION_ERROR)
        if membership.role == "student":
            entity = db.query(Student).filter(
                Student.college_id == invitation.college_id,
                Student.email == user.email,
                Student.is_active.is_(False),
            ).one_or_none()
        elif membership.role == "teacher":
            entity = db.query(Teacher).filter(
                Teacher.college_id == invitation.college_id,
                Teacher.email == user.email,
                Teacher.is_active.is_(False),
            ).one_or_none()
        else:
            entity = None
        if entity is None:
            raise HTTPException(status_code=400, detail=GENERIC_ACTIVATION_ERROR)

        user.hashed_password = get_password_hash(password)
        user.is_active = True
        entity.is_active = True
        membership.status = "active"
        membership.activated_by_user_id = user.id
        membership.activated_at = now
        membership.status_reason = "Activated by the account holder using a valid invitation."
        invitation.consumed_at = now
        db.commit()
        return {"status": "activated", "message": "Account activated. You can now sign in."}
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Account activation is temporarily unavailable.") from None
    finally:
        # Reduce accidental retention in local variables; Python strings are
        # immutable, so this is best-effort and not a memory-erasure guarantee.
        password = None
        token = None
