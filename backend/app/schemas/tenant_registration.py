"""College-scoped registration and academic progression contracts."""

from datetime import date, datetime, timezone
import re

from pydantic import BaseModel, ConfigDict, EmailStr, Field, SecretStr, field_validator, model_validator

from app.password_policy import is_password_policy_valid


class TenantStudentCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: EmailStr = Field(max_length=150)
    roll_number: str = Field(min_length=1, max_length=50)
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
    guardian_relationship: str = Field(default="Guardian", max_length=30)
    initial_class_id: int | None = Field(default=None, gt=0)
    password: SecretStr
    password_confirmation: SecretStr

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @field_validator("guardian_relationship")
    @classmethod
    def valid_guardian_relationship(cls, value):
        allowed = {"Father", "Mother", "Guardian", "Brother", "Sister", "Other"}
        if value not in allowed:
            raise ValueError("Unsupported guardian relationship.")
        return value

    @field_validator("mobile", "parent_mobile")
    @classmethod
    def valid_phone(cls, value):
        if value is None:
            return None
        if not re.fullmatch(r"[0-9+(). -]{7,20}", value) or sum(char.isdigit() for char in value) < 7:
            raise ValueError("Enter a valid contact number.")
        return value

    @model_validator(mode="after")
    def academic_year_fits_program(self):
        if self.program_duration_years and self.current_academic_year and self.current_academic_year > self.program_duration_years:
            raise ValueError("Current academic year cannot exceed the program duration.")
        return self

    @model_validator(mode="after")
    def validate_permanent_password(self):
        password = self.password.get_secret_value()
        confirmation = self.password_confirmation.get_secret_value()
        if not is_password_policy_valid(password):
            raise ValueError("Password must be at least 12 characters with uppercase, lowercase, a number, and a symbol; maximum 72 UTF-8 bytes.")
        if password != confirmation:
            raise ValueError("Password confirmation does not match.")
        return self


class TenantTeacherAssignmentInput(BaseModel):
    subject_id: int = Field(gt=0)
    class_id: int = Field(gt=0)
    academic_year: str = Field(min_length=1, max_length=20)
    semester: int = Field(ge=1, le=24)
    effective_from: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    effective_to: datetime | None = None

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @model_validator(mode="after")
    def validate_effective_interval(self):
        if self.effective_from.tzinfo is None or self.effective_from.utcoffset() is None:
            raise ValueError("Assignment start must include a timezone.")
        if self.effective_to is not None:
            if self.effective_to.tzinfo is None or self.effective_to.utcoffset() is None:
                raise ValueError("Assignment end must include a timezone.")
            if self.effective_to <= self.effective_from:
                raise ValueError("Assignment end must be later than its start.")
        return self


class TenantTeacherCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: EmailStr = Field(max_length=150)
    department: str | None = Field(default=None, max_length=100)
    gender: str | None = Field(default=None, max_length=30)
    designation: str | None = Field(default=None, max_length=100)
    qualification: str | None = Field(default=None, max_length=150)
    mobile: str | None = Field(default=None, max_length=20)
    address: str | None = Field(default=None, max_length=255)
    joining_date: date | None = None
    assignments: list[TenantTeacherAssignmentInput] = Field(default_factory=list, max_length=100)
    password: SecretStr
    password_confirmation: SecretStr

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @field_validator("mobile")
    @classmethod
    def valid_phone(cls, value):
        if value is None:
            return None
        if not re.fullmatch(r"[0-9+(). -]{7,20}", value) or sum(char.isdigit() for char in value) < 7:
            raise ValueError("Enter a valid contact number.")
        return value

    @model_validator(mode="after")
    def assignments_are_unique(self):
        keys = [
            (item.class_id, item.subject_id, item.academic_year, item.semester)
            for item in self.assignments
        ]
        if len(keys) != len(set(keys)):
            raise ValueError("Duplicate class and subject assignment was submitted.")
        password = self.password.get_secret_value()
        confirmation = self.password_confirmation.get_secret_value()
        if not is_password_policy_valid(password):
            raise ValueError("Password must be at least 12 characters with uppercase, lowercase, a number, and a symbol; maximum 72 UTF-8 bytes.")
        if password != confirmation:
            raise ValueError("Password confirmation does not match.")
        return self


class TenantStudentPromotion(BaseModel):
    current_academic_year: int = Field(ge=1, le=12)
    current_semester: int = Field(ge=1, le=24)
    section: str | None = Field(default=None, max_length=50)
    class_id: int | None = Field(default=None, gt=0)
    reason: str = Field(min_length=3, max_length=500)

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class TenantPasswordReset(BaseModel):
    password: SecretStr
    password_confirmation: SecretStr

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_new_password(self):
        password = self.password.get_secret_value()
        if not is_password_policy_valid(password):
            raise ValueError("Password must be at least 12 characters with uppercase, lowercase, a number, and a symbol; maximum 72 UTF-8 bytes.")
        if password != self.password_confirmation.get_secret_value():
            raise ValueError("Password confirmation does not match.")
        return self


class TenantStudentAcademicHistoryResponse(BaseModel):
    id: int
    student_id: int
    admission_year: int | None = None
    academic_year: int | None = None
    semester: int | None = None
    section: str | None = None
    class_id: int | None = None
    action: str
    reason: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True, extra="forbid")


class TenantStudentRegisteredResponse(BaseModel):
    id: int
    student_code: str | None = None
    name: str
    email: EmailStr
    roll_number: str
    enrollment_number: str | None = None
    admission_year: int | None = None
    admission_session: str | None = None
    program_duration_years: int | None = None
    current_academic_year: int | None = None
    current_semester: int | None = None
    section: str | None = None
    is_active: bool
    account_activation: str = "active"
    invitation_status: str = "not_required"

    model_config = ConfigDict(from_attributes=True, extra="forbid")


class TenantTeacherRegisteredResponse(BaseModel):
    id: int
    name: str
    employee_id: str
    department: str | None = None
    is_active: bool
    account_activation: str = "active"
    invitation_status: str = "not_required"
    profile_verification_status: str = "verified"

    model_config = ConfigDict(from_attributes=True, extra="forbid")
