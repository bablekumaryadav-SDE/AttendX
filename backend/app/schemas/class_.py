from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ClassCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=2, max_length=100)
    section: str | None = Field(default=None, max_length=50)
    department: str | None = Field(default=None, max_length=100)
    semester: int | None = Field(default=None, ge=1, le=24)
    academic_year: str | None = Field(default=None, max_length=20)
    location_name: str | None = Field(default=None, max_length=120)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    radius_m: float = Field(default=100, ge=10, le=5000)

    @model_validator(mode="after")
    def validate_location(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Latitude and longitude must be configured together.")
        if self.location_name and self.latitude is None:
            raise ValueError("Set valid coordinates before naming a classroom location.")
        return self


class ClassUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=2, max_length=100)
    section: str | None = Field(default=None, max_length=50)
    department: str | None = Field(default=None, max_length=100)
    semester: int | None = Field(default=None, ge=1, le=24)
    academic_year: str | None = Field(default=None, max_length=20)
    is_active: bool | None = None
    location_name: str | None = Field(default=None, max_length=120)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    radius_m: float | None = Field(default=None, ge=10, le=5000)

    @model_validator(mode="after")
    def name_cannot_be_cleared(self):
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("Class name cannot be empty.")
        return self


class ClassResponse(BaseModel):
    id: int
    name: str
    section: str | None = None
    department: str | None = None
    semester: int | None = None
    academic_year: str | None = None
    location_name: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    radius_m: float = 100
    is_active: bool
    created_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)
