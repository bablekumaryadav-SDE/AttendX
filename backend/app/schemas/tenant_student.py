"""Minimal Student directory response; excludes global and linked records."""

import re
from datetime import date, datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


class TenantStudentResponse(BaseModel):
    id: int
    student_code: str | None = None
    name: str
    email: str
    roll_number: str
    department: str | None = None
    date_of_birth: date | None = None
    gender: str | None = None
    enrollment_number: str | None = None
    admission_year: int | None = None
    admission_session: str | None = None
    program_duration_years: int | None = None
    current_academic_year: int | None = None
    current_semester: int | None = None
    section: str | None = None
    course: str | None = None
    mobile: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None
    is_active: bool
    face_registered: bool = False
    face_status: Literal["registered", "not_registered"] = "not_registered"
    created_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True, extra="forbid")


class TenantStudentProfileResponse(TenantStudentResponse):
    father_name: str | None = None
    mother_name: str | None = None
    guardian_name: str | None = None
    guardian_relationship: str | None = None
    guardian_mobile: str | None = None
    parent_email: str | None = None

    model_config = ConfigDict(from_attributes=True, extra="forbid")


class TenantStudentSelfProfileResponse(BaseModel):
    """Limited College-scoped profile returned only to its verified Student account."""

    id: int
    college_id: int
    college_name: str
    student_code: str | None = None
    name: str
    email: str
    roll_number: str
    department: str | None = None
    enrollment_number: str | None = None
    admission_year: int | None = None
    admission_session: str | None = None
    program_duration_years: int | None = None
    current_academic_year: int | None = None
    current_semester: int | None = None
    section: str | None = None
    course: str | None = None
    mobile: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None
    is_active: bool
    created_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True, extra="forbid")


class TenantStudentStatusResponse(TenantStudentProfileResponse):
    membership_status: Literal["active", "revoked"] | None = None

    model_config = ConfigDict(from_attributes=True, extra="forbid")


class TenantStudentPage(BaseModel):
    items: list[TenantStudentResponse]
    total: int
    page: int
    page_size: int
    active_count: int
    inactive_count: int
    face_registered_count: int
    face_not_registered_count: int


class TenantStudentUpdate(BaseModel):
    """College Admin profile update. Login email is intentionally immutable."""

    name: str | None = Field(default=None, min_length=2, max_length=100)
    roll_number: str | None = Field(default=None, min_length=1, max_length=50)
    department: str | None = Field(default=None, max_length=100)
    date_of_birth: date | None = None
    gender: str | None = Field(default=None, max_length=30)
    enrollment_number: str | None = Field(default=None, min_length=1, max_length=80)
    admission_year: int | None = Field(default=None, ge=1900, le=2200)
    admission_session: str | None = Field(default=None, max_length=30)
    program_duration_years: int | None = Field(default=None, ge=1, le=12)
    current_academic_year: int | None = Field(default=None, ge=1, le=12)
    current_semester: int | None = Field(default=None, ge=1, le=24)
    section: str | None = Field(default=None, max_length=50)
    course: str | None = Field(default=None, max_length=120)
    mobile: str | None = Field(default=None, max_length=20)
    address: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=100)
    state: str | None = Field(default=None, max_length=100)
    postal_code: str | None = Field(default=None, max_length=20)
    father_name: str | None = Field(default=None, max_length=120)
    mother_name: str | None = Field(default=None, max_length=120)
    parent_mobile: str | None = Field(default=None, max_length=20)
    parent_email: EmailStr | None = Field(default=None, max_length=254)
    guardian_name: str | None = Field(default=None, max_length=120)
    guardian_relationship: str | None = Field(default=None, max_length=30)

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @field_validator("mobile", "parent_mobile")
    @classmethod
    def valid_phone(cls, value):
        if value is not None and (
            not re.fullmatch(r"[0-9+(). -]{7,20}", value)
            or sum(char.isdigit() for char in value) < 7
        ):
            raise ValueError("Enter a valid contact number.")
        return value

    @field_validator("guardian_relationship")
    @classmethod
    def valid_guardian_relationship(cls, value):
        if value is not None and value not in {"Father", "Mother", "Guardian", "Brother", "Sister", "Other"}:
            raise ValueError("Unsupported guardian relationship.")
        return value

    @model_validator(mode="after")
    def validate_update(self):
        if not self.model_fields_set:
            raise ValueError("At least one Student profile field must be provided.")
        for field in ("name", "roll_number"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field.replace('_', ' ').capitalize()} cannot be cleared.")
        if (
            self.program_duration_years is not None
            and self.current_academic_year is not None
            and self.current_academic_year > self.program_duration_years
        ):
            raise ValueError("Current academic year cannot exceed the program duration.")
        return self


class TenantStudentClassAssignmentInput(BaseModel):
    class_id: int = Field(gt=0)
    academic_year: str = Field(min_length=1, max_length=20)
    semester: int | None = Field(default=None, ge=1, le=24)
    effective_from: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    effective_to: datetime | None = None

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @model_validator(mode="after")
    def validate_effective_interval(self):
        if self.effective_from.tzinfo is None or self.effective_from.utcoffset() is None:
            raise ValueError("Enrollment start must include a timezone.")
        if self.effective_to is not None:
            if self.effective_to.tzinfo is None or self.effective_to.utcoffset() is None:
                raise ValueError("Enrollment end must include a timezone.")
            if self.effective_to <= self.effective_from:
                raise ValueError("Enrollment end must be later than its start.")
        return self


class TenantStudentClassAssignmentResponse(BaseModel):
    id: int
    student_id: int
    class_id: int
    academic_year: str | None = None
    semester: int | None = None
    is_active: bool
    created_at: datetime | None = None
    effective_from: datetime | None = None
    effective_to: datetime | None = None

    model_config = ConfigDict(from_attributes=True, extra="forbid")
