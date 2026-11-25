from datetime import datetime

import re
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class PlatformCollegeProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    official_name: str | None = Field(default=None, min_length=1, max_length=200)
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    college_type: str | None = Field(default=None, max_length=80)
    address: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=100)
    state: str | None = Field(default=None, max_length=100)
    postal_code: str | None = Field(default=None, max_length=20)
    country: str | None = Field(default=None, max_length=80)
    official_email: str | None = Field(default=None, max_length=254)
    contact_number: str | None = Field(default=None, max_length=32)
    website: str | None = Field(default=None, max_length=2048)

    @field_validator("official_name", "display_name")
    @classmethod
    def trim_names(cls, value):
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("College names cannot be blank.")
        return normalized

    @field_validator("college_type", "address", "city", "state", "postal_code", "country")
    @classmethod
    def trim_optional_text(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("official_email")
    @classmethod
    def validate_email(cls, value):
        if value is None:
            return None
        normalized = value.strip().lower()
        if not re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+", normalized):
            raise ValueError("Enter a valid official email address.")
        return normalized

    @field_validator("contact_number")
    @classmethod
    def validate_phone(cls, value):
        if value is None:
            return None
        normalized = re.sub(r"[ ()-]", "", value.strip())
        if not re.fullmatch(r"\+[1-9][0-9]{7,14}", normalized):
            raise ValueError("Enter the phone in international format.")
        return normalized

    @field_validator("website")
    @classmethod
    def validate_website(cls, value):
        if value is None or not value.strip():
            return None
        normalized = value.strip()
        parsed = urlsplit(normalized)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Website must be an HTTP or HTTPS URL without embedded credentials.")
        return normalized

    @model_validator(mode="after")
    def require_a_profile_change(self):
        if not self.model_fields_set:
            raise ValueError("Provide at least one permitted profile field.")
        if "official_name" in self.model_fields_set and self.official_name is None:
            raise ValueError("Official College name cannot be null.")
        return self


class PlatformCollegeStatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str
    reason: str = Field(min_length=3, max_length=1000)

    @field_validator("status")
    @classmethod
    def allowed_target(cls, value):
        normalized = value.strip().lower()
        if normalized not in {"active", "suspended"}:
            raise ValueError("College status can only be set to active or suspended.")
        return normalized

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value):
        normalized = value.strip()
        if len(normalized) < 3:
            raise ValueError("A status-change reason is required.")
        return normalized


class PlatformCollegeListItem(BaseModel):
    id: int
    slug: str
    official_name: str
    display_name: str | None
    status: str
    created_at: datetime
    updated_at: datetime | None
    application_reference: str | None = None
    application_status: str | None = None
    provisioning_status: str | None = None

    model_config = ConfigDict(from_attributes=True)


class PlatformCollegeAdmin(BaseModel):
    user_id: int
    name: str
    email: str
    account_active: bool
    membership_id: int
    membership_status: str


class PlatformCollegeDetail(PlatformCollegeListItem):
    application_id: int | None = None
    college_type: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None
    country: str | None = None
    official_email: str | None = None
    contact_number: str | None = None
    website: str | None = None
    admin_name: str | None = None
    admin_email: str | None = None
    admin_contact_number: str | None = None
    admins: list[PlatformCollegeAdmin]


class CollegeStatusHistoryEvent(BaseModel):
    id: int
    actor_user_id: int | None
    action: str
    previous_status: str | None
    new_status: str
    reason: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
