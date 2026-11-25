from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


# ============================================================
# Legacy Attendance CRUD Schemas
# ============================================================

class AttendanceCreate(BaseModel):
    student_id: int
    teacher_id: int
    date: date
    status: Literal[
        "present",
        "absent",
        "late",
    ] = "present"


class AttendanceUpdate(BaseModel):
    student_id: Optional[int] = None
    teacher_id: Optional[int] = None
    date: Optional[date] = None
    status: Optional[
        Literal[
            "present",
            "absent",
            "late",
        ]
    ] = None


class AttendanceResponse(BaseModel):
    id: int
    student_id: int
    teacher_id: int
    date: date
    status: str

    model_config = ConfigDict(
        from_attributes=True
    )


# ============================================================
# Attendance Session
# ============================================================

class AttendanceSessionCreate(BaseModel):
    subject_id: int
    class_id: int

    title: str = Field(
        min_length=2,
        max_length=180,
    )

    starts_at: datetime
    ends_at: datetime

    latitude: Optional[float] = Field(
        default=None,
        ge=-90,
        le=90,
    )

    longitude: Optional[float] = Field(
        default=None,
        ge=-180,
        le=180,
    )

    radius_m: float = Field(
        default=100,
        ge=10,
        le=5000,
    )

    @model_validator(mode="after")
    def validate_window(self):
        if self.ends_at <= self.starts_at:
            raise ValueError(
                "ends_at must be later than starts_at"
            )

        return self


class AttendanceSessionResponse(BaseModel):
    id: int
    teacher_id: int
    subject_id: int
    class_id: int

    title: str

    starts_at: datetime
    ends_at: datetime

    status: str

    qr_expires_at: Optional[datetime] = None

    latitude: Optional[float] = None
    longitude: Optional[float] = None

    radius_m: float

    created_at: datetime

    model_config = ConfigDict(
        from_attributes=True
    )


# ============================================================
# QR
# ============================================================

class QRResponse(BaseModel):
    session_id: int
    token: str
    expires_at: datetime
    ttl_seconds: int


class QRVerifyRequest(BaseModel):
    token: str = Field(
        min_length=20,
        max_length=1000,
    )

    latitude: Optional[float] = Field(
        default=None,
        ge=-90,
        le=90,
    )

    longitude: Optional[float] = Field(
        default=None,
        ge=-180,
        le=180,
    )

    device_hash: Optional[str] = Field(
        default=None,
        max_length=128,
    )


class StudentQrAttendanceRequest(BaseModel):
    token: str = Field(
        min_length=10,
        max_length=1000,
    )

    latitude: Optional[float] = Field(
        default=None,
        ge=-90,
        le=90,
    )

    longitude: Optional[float] = Field(
        default=None,
        ge=-180,
        le=180,
    )

    device_hash: Optional[str] = Field(
        default=None,
        max_length=128,
    )


# ============================================================
# Manual Attendance
# ============================================================

class ManualAttendanceRequest(BaseModel):
    student_id: int

    status: Literal[
        "present",
        "absent",
        "late",
    ] = "present"

    remarks: Optional[str] = Field(
        default=None,
        max_length=255,
    )


# ============================================================
# Live Attendance
# ============================================================

class LiveAttendanceItem(BaseModel):
    student_id: int

    student_code: Optional[str] = None

    name: str

    roll_number: str

    status: str

    method: Optional[str] = None

    verified_at: Optional[datetime] = None

    distance_m: Optional[float] = None

    model_config = ConfigDict(
        from_attributes=True
    )


# ============================================================
# Attendance Event Response
# ============================================================

class AttendanceEventResponse(BaseModel):
    id: int
    session_id: int
    student_id: int

    status: str
    method: str

    confidence: Optional[float] = None
    distance_m: Optional[float] = None

    verified_at: datetime

    model_config = ConfigDict(
        from_attributes=True
    )