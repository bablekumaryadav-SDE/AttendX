from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AttendanceRecordCreate(BaseModel):
    student_id: int
    teacher_id: int
    subject_id: int
    class_id: int
    attendance_date: datetime
    status: str = "present"
    remarks: str | None = None


class AttendanceRecordUpdate(BaseModel):
    status: str | None = None
    remarks: str | None = None


class AttendanceRecordResponse(BaseModel):
    id: int
    student_id: int
    teacher_id: int
    subject_id: int
    class_id: int
    attendance_date: datetime
    status: str
    remarks: str | None = None
    created_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)