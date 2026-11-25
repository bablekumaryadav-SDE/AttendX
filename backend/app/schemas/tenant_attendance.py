"""Minimal tenant attendance history responses; never expose event evidence."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class TenantAttendanceResponse(BaseModel):
    id: int
    student_id: int
    teacher_id: int
    date: datetime
    status: str
    created_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True, extra="forbid")


class TenantAttendanceRecordResponse(BaseModel):
    id: int
    student_id: int
    teacher_id: int
    subject_id: int
    class_id: int
    attendance_date: datetime
    status: str
    created_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True, extra="forbid")
