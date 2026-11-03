from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class SubjectBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=150)
    code: str = Field(..., min_length=1, max_length=50)
    department: str | None = Field(default=None, max_length=100)


class SubjectCreate(SubjectBase):
    pass


class SubjectUpdate(BaseModel):
    name: str | None = Field(
        default=None,
        min_length=1,
        max_length=150,
    )

    code: str | None = Field(
        default=None,
        min_length=1,
        max_length=50,
    )

    department: str | None = Field(default=None, max_length=100)

    is_active: bool | None = None


class SubjectResponse(BaseModel):
    id: int
    name: str
    code: str
    is_active: bool
    department: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
