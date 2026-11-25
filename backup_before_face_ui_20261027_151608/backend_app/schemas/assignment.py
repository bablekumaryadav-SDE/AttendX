from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AssignmentCreate(BaseModel):
    teacher_id: int
    subject_id: int
    class_id: int
    academic_year: str | None = None
    semester: int | None = None


class AssignmentUpdate(BaseModel):
    teacher_id: int | None = None
    subject_id: int | None = None
    class_id: int | None = None
    academic_year: str | None = None
    semester: int | None = None
    is_active: bool | None = None


class AssignmentResponse(BaseModel):
    id: int
    teacher_id: int
    subject_id: int
    class_id: int
    academic_year: str | None = None
    semester: int | None = None
    is_active: bool
    created_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)