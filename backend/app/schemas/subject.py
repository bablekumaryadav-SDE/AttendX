from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SubjectBase(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(..., min_length=1, max_length=100)
    code: str = Field(..., min_length=1, max_length=50)
    department: str | None = Field(default=None, max_length=100)


class SubjectCreate(SubjectBase):
    pass


class SubjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str | None = Field(
        default=None,
        min_length=1,
        max_length=100,
    )

    code: str | None = Field(
        default=None,
        min_length=1,
        max_length=50,
    )

    department: str | None = Field(default=None, max_length=100)

    is_active: bool | None = None

    @model_validator(mode="after")
    def require_a_change(self):
        if not self.model_fields_set:
            raise ValueError("At least one Subject field must be provided.")
        return self


class SubjectResponse(BaseModel):
    id: int
    name: str
    code: str
    is_active: bool
    department: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
