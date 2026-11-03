from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class StudentClassAssignmentUpdate(BaseModel):
    class_id: int = Field(gt=0)
    academic_year: str | None = Field(default=None, max_length=20)
    semester: int | None = None


class StudentClassAssignmentResponse(BaseModel):
    id: int
    student_id: int
    class_id: int
    academic_year: str | None = None
    semester: int | None = None
    is_active: bool
    created_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)
