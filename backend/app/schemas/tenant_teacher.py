"""Tenant-safe Teacher directory, management, and assignment contracts."""

from datetime import date, datetime
import re

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class TenantTeacherResponse(BaseModel):
    id: int
    name: str
    department: str | None = None
    is_active: bool
    created_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True, extra="forbid")


class TenantTeacherManagedProfileResponse(TenantTeacherResponse):
    email: str
    employee_id: str
    gender: str | None = None
    designation: str | None = None
    qualification: str | None = None
    mobile: str | None = None
    address: str | None = None
    joining_date: date | None = None


class TenantTeacherSelfProfileResponse(BaseModel):
    """College-scoped profile returned only for the authenticated linked Teacher."""

    id: int
    college_id: int
    college_name: str
    name: str
    email: str
    employee_id: str
    department: str | None = None
    designation: str | None = None
    qualification: str | None = None
    mobile: str | None = None
    address: str | None = None
    joining_date: date | None = None
    is_active: bool
    created_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True, extra="forbid")


class TenantTeacherUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    department: str | None = Field(default=None, max_length=100)
    gender: str | None = Field(default=None, max_length=30)
    designation: str | None = Field(default=None, max_length=100)
    qualification: str | None = Field(default=None, max_length=150)
    mobile: str | None = Field(default=None, max_length=20)
    address: str | None = Field(default=None, max_length=255)
    joining_date: date | None = None

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @field_validator("mobile")
    @classmethod
    def valid_phone(cls, value):
        if value is not None and (not re.fullmatch(r"[0-9+(). -]{7,20}", value) or sum(c.isdigit() for c in value) < 7):
            raise ValueError("Enter a valid contact number.")
        return value

    @model_validator(mode="after")
    def require_change(self):
        if not self.model_fields_set:
            raise ValueError("At least one Teacher profile field must be provided.")
        for key in ("name",):
            if key in self.model_fields_set and getattr(self, key) is None:
                raise ValueError(f"{key.replace('_', ' ').title()} cannot be empty.")
        return self


class TenantTeacherVerificationUpdate(BaseModel):
    verification_status: Literal["verified", "rejected"]
    reason: str = Field(min_length=5, max_length=500)

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class TenantTeacherVerificationResponse(BaseModel):
    teacher_id: int
    college_id: int
    verification_status: Literal["pending", "verified", "rejected"]
    verified_by_admin_id: int | None = None
    verified_at: datetime | None = None
    rejected_by_admin_id: int | None = None
    rejected_at: datetime | None = None
    verification_reason: str | None = None

    model_config = ConfigDict(extra="forbid")


class TenantTeacherManagementAuditResponse(BaseModel):
    id: int
    college_id: int
    teacher_id: int
    related_user_id: int | None = None
    actor_user_id: int
    action: str
    previous_state: dict
    new_state: dict
    reason: str
    evidence_reference: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True, extra="forbid")


class TenantTeacherAssignmentResponse(BaseModel):
    id: int
    teacher_id: int
    class_id: int
    subject_id: int
    academic_year: str | None = None
    semester: int | None = None
    is_active: bool
    effective_from: datetime | None = None
    effective_to: datetime | None = None

    model_config = ConfigDict(from_attributes=True, extra="forbid")
