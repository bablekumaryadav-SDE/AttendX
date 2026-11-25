import re
from datetime import datetime
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, SecretStr, ValidationInfo, field_validator


_EMAIL = re.compile(r"^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$")
_PHONE = re.compile(r"^\+[1-9][0-9]{7,14}$")


def _email(value: str) -> str:
    normalized = value.strip().lower()
    if len(normalized) > 254 or not _EMAIL.fullmatch(normalized):
        raise ValueError("Enter a valid email address.")
    return normalized


def _phone(value: str) -> str:
    normalized = re.sub(r"[ ()-]", "", value.strip())
    if not _PHONE.fullmatch(normalized):
        raise ValueError("Enter a phone number in international format, for example +14155550123.")
    return normalized


class CollegeRegistrationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    college_name: str = Field(min_length=2, max_length=200)
    college_type: str = Field(min_length=2, max_length=80)
    address: str = Field(min_length=4, max_length=255)
    city: str = Field(min_length=2, max_length=100)
    state: str = Field(min_length=2, max_length=100)
    postal_code: str = Field(min_length=2, max_length=20)
    country: str = Field(min_length=2, max_length=80)
    official_email: str = Field(max_length=254)
    contact_number: str = Field(max_length=32)
    website: str | None = Field(default=None, max_length=2048)
    admin_name: str = Field(min_length=2, max_length=120)
    # College Admin accounts are stored in the legacy users.email VARCHAR(150).
    admin_email: str = Field(max_length=150)
    admin_contact_number: str = Field(max_length=32)
    password: SecretStr
    password_confirmation: SecretStr

    @field_validator(
        "college_name", "college_type", "address", "city", "state", "postal_code",
        "country", "admin_name", mode="before",
    )
    @classmethod
    def trim_required_text(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("official_email", "admin_email")
    @classmethod
    def normalize_email(cls, value):
        return _email(value)

    @field_validator("contact_number", "admin_contact_number")
    @classmethod
    def normalize_phone(cls, value):
        return _phone(value)

    @field_validator("website")
    @classmethod
    def validate_website(cls, value):
        if value is None or not value.strip():
            return None
        normalized = value.strip()
        parsed = urlsplit(normalized)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Website must be a valid HTTP or HTTPS URL without embedded credentials.")
        return normalized

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: SecretStr):
        raw = value.get_secret_value()
        if len(raw.encode("utf-8")) > 72:
            raise ValueError("Password must be no longer than 72 UTF-8 bytes.")
        if len(raw) < 12 or not any(c.islower() for c in raw) or not any(c.isupper() for c in raw) or not any(c.isdigit() for c in raw) or not any(not c.isalnum() for c in raw):
            raise ValueError("Password must be at least 12 characters and include uppercase, lowercase, numeric and symbol characters.")
        return value

    @field_validator("password_confirmation")
    @classmethod
    def passwords_match(cls, value: SecretStr, info: ValidationInfo):
        password = info.data.get("password")
        if password is not None and password.get_secret_value() != value.get_secret_value():
            raise ValueError("Password confirmation does not match.")
        return value


class CollegeRegistrationSubmission(BaseModel):
    application_reference: str
    status: str
    tracking_token: str


class CollegeRegistrationStatusRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    application_reference: str = Field(min_length=20, max_length=48)
    tracking_token: SecretStr = Field(min_length=32, max_length=128)


class CollegeRegistrationStatusResponse(BaseModel):
    application_reference: str
    status: str
    submitted_at: datetime
    reviewed_at: datetime | None


class CollegeApplicationListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    application_reference: str
    college_name: str
    official_email: str
    city: str
    state: str
    status: str
    provisioning_status: str
    submitted_at: datetime


class CollegeApplicationDetail(CollegeApplicationListItem):
    college_type: str
    address: str
    postal_code: str
    country: str
    contact_number: str
    website: str | None
    admin_name: str
    admin_email: str
    admin_contact_number: str
    reviewed_at: datetime | None
    reviewed_by_user_id: int | None
    review_reason: str | None
    college_id: int | None
    admin_user_id: int | None


class CollegeApplicationDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str | None = Field(default=None, max_length=1000)

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value):
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class CollegeApplicationReviewEvent(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    reviewer_user_id: int | None
    decision: str
    reason: str | None
    created_at: datetime


class CollegeApplicationReviewResult(BaseModel):
    application_reference: str
    status: str
    provisioning_status: str
    college_id: int | None
    admin_user_id: int | None
