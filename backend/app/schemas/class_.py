from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ClassCreate(BaseModel):
    name: str
    section: str | None = None
    department: str | None = None
    semester: int | None = None
    academic_year: str | None = None


class ClassUpdate(BaseModel):
    name: str | None = None
    section: str | None = None
    department: str | None = None
    semester: int | None = None
    academic_year: str | None = None
    is_active: bool | None = None


class ClassResponse(BaseModel):
    id: int
    name: str
    section: str | None = None
    department: str | None = None
    semester: int | None = None
    academic_year: str | None = None
    is_active: bool
    created_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)