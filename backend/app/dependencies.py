
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.security import decode_access_token


oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/auth/login"
)


class AuthenticatedPrincipal(dict):
    """
    Existing API endpoints ko dictionary aur object,
    dono tarah ka authenticated user interface deta hai.

    Role aur account status database se aate hain,
    JWT ke role claim par blindly trust nahi kiya jata.
    """

    def __init__(self, user: User):
        self._user = user

        super().__init__(
            sub=str(user.id),
            id=user.id,
            user_id=user.id,
            name=user.name,
            email=user.email,
            role=str(user.role or "").strip().lower(),
            is_active=bool(user.is_active),
        )

    def __getattr__(self, name):
        if name in self:
            return self[name]

        try:
            return getattr(self._user, name)
        except AttributeError as exc:
            raise AttributeError(name) from exc


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> AuthenticatedPrincipal:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired login session. Please sign in again.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    payload = decode_access_token(token)
    subject = payload.get("sub")

    if subject is None or not str(subject).strip():
        raise credentials_exception

    subject = str(subject).strip()
    user = None

    # New tokens use the database user ID.
    if subject.isdigit():
        user = (
            db.query(User)
            .filter(User.id == int(subject))
            .first()
        )

    # Backward compatibility for tokens issued with email as sub.
    if user is None:
        user = (
            db.query(User)
            .filter(func.lower(User.email) == subject.lower())
            .first()
        )

    if user is None or not user.is_active:
        raise credentials_exception

    # The user's current role is taken from the database.
    return AuthenticatedPrincipal(user)


def get_current_admin(
    current_user: AuthenticatedPrincipal = Depends(get_current_user),
):
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access required.",
        )

    return current_user


def get_current_teacher(
    current_user: AuthenticatedPrincipal = Depends(get_current_user),
):
    if current_user.get("role") not in {"teacher", "admin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Teacher access required.",
        )

    return current_user
