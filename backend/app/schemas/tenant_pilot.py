from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TenantCollegeProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    gps_accuracy_limit_m: int | None = Field(default=None, ge=1, le=150)

    model_config = ConfigDict(extra="forbid")

    @field_validator("display_name")
    @classmethod
    def trim_display_name(cls, value):
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("Display name cannot be blank.")
        return normalized


class TenantCollegeProfileResponse(BaseModel):
    id: int
    slug: str
    official_name: str
    display_name: str | None
    status: str
    gps_accuracy_limit_m: int = 100
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)
