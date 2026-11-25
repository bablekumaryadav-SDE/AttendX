
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class StudentCreate(BaseModel):
    """
    Data required when creating a new student.
    Student ID is generated automatically by the backend.
    """

    name: str = Field(
        ...,
        min_length=2,
        max_length=100,
        description="Student full name",
    )

    email: EmailStr = Field(
        ...,
        max_length=150,
        description="Student email address",
    )

    password: str = Field(
        ...,
        min_length=8,
        max_length=72,
        description="Initial student login password",
    )

    roll_number: str = Field(
        ...,
        min_length=1,
        max_length=50,
        description="Unique student roll number",
    )

    department: str | None = Field(
        default=None,
        max_length=100,
        description="Student department",
    )


class StudentUpdate(BaseModel):
    """
    Data allowed when updating an existing student.

    Student ID, email and roll number are handled by the backend.
    """

    name: str | None = Field(
        default=None,
        min_length=2,
        max_length=100,
        description="Student full name",
    )

    email: EmailStr | None = Field(
        default=None,
        max_length=150,
        description="Student email address",
    )

    roll_number: str | None = Field(
        default=None,
        min_length=1,
        max_length=50,
        description="Unique student roll number",
    )

    department: str | None = Field(
        default=None,
        max_length=100,
        description="Student department",
    )

    is_active: bool | None = Field(
        default=None,
        description="Whether the student account is active",
    )


class FaceRegistrationResponse(BaseModel):
    """
    Public face-registration information.

    The actual image bytes are NEVER returned through the API.
    """

    status: str | None = None

    model_config = ConfigDict(
        from_attributes=True
    )


class StudentResponse(BaseModel):
    """
    Student data returned by the API.
    """

    id: int

    student_code: str

    name: str

    email: EmailStr

    roll_number: str

    department: str | None = None

    is_active: bool

    created_at: datetime | None = None

    face_registration: FaceRegistrationResponse | None = None

    @property
    def face_registered(self) -> bool:
        """
        Convenience property for backend usage.

        Returns True when a registered face record exists.
        """

        return (
            self.face_registration is not None
            and self.face_registration.status == "registered"
        )

    model_config = ConfigDict(
        from_attributes=True
    )
