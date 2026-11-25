"""GIS-aware request schemas kept separate from the restored legacy baseline."""

from typing import Literal

from pydantic import Field, model_validator

from app.schemas.attendance import (
    AttendanceSessionCreate,
    QRVerifyRequest,
    StudentQrAttendanceRequest,
)


class AttendanceSessionGISCreate(AttendanceSessionCreate):
    # The Teacher explicitly chooses whether this session start requires GPS.
    # There is deliberately no default: older/ambiguous clients fail closed.
    location_verification_mode: Literal["gps_on", "gps_off"] | None = None
    # The classroom point and radius are controlled by the College Admin.
    radius_m: float | None = Field(default=None, ge=10, le=5000)
    teacher_latitude: float | None = Field(default=None, ge=-90, le=90)
    teacher_longitude: float | None = Field(default=None, ge=-180, le=180)
    teacher_accuracy_m: float | None = Field(default=None, ge=0, le=10000)

    @model_validator(mode="after")
    def validate_coordinate_pair(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Latitude and longitude must be provided together.")
        if (self.teacher_latitude is None) != (self.teacher_longitude is None):
            raise ValueError("Teacher latitude and longitude must be provided together.")
        has_teacher_fix = any(value is not None for value in (
            self.teacher_latitude, self.teacher_longitude, self.teacher_accuracy_m,
        ))
        if self.location_verification_mode == "gps_on" and not all(value is not None for value in (
            self.teacher_latitude, self.teacher_longitude, self.teacher_accuracy_m,
        )):
            raise ValueError("GPS verification requires a complete fresh Teacher location fix.")
        if self.location_verification_mode == "gps_off" and has_teacher_fix:
            raise ValueError("Teacher GPS values must be omitted when GPS verification is off.")
        return self


class QRVerifyGISRequest(QRVerifyRequest):
    accuracy_m: float | None = Field(default=None, ge=0, le=10000)

    @model_validator(mode="after")
    def validate_coordinate_pair(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Latitude and longitude must be provided together.")
        return self


class StudentQrAttendanceGISRequest(StudentQrAttendanceRequest):
    accuracy_m: float | None = Field(default=None, ge=0, le=10000)

    @model_validator(mode="after")
    def validate_coordinate_pair(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Latitude and longitude must be provided together.")
        return self
