"""Strict aggregate responses for the College Admin dashboard."""

from pydantic import BaseModel, ConfigDict


class TenantEntityCounts(BaseModel):
    total: int
    active: int
    inactive: int

    model_config = ConfigDict(extra="forbid")


class TenantDashboardSummary(BaseModel):
    students: TenantEntityCounts
    teachers: TenantEntityCounts
    classes: TenantEntityCounts
    subjects: TenantEntityCounts

    model_config = ConfigDict(extra="forbid")


class TenantAttendanceSummary(BaseModel):
    legacy_attendance_rows: int
    attendance_record_rows: int
    present_records: int
    late_records: int
    absent_records: int
    unclassified_status_records: int
    classified_records_denominator: int
    recorded_presence_rate_percent: float | None
    trend_available: bool
    trend_unavailable_reason: str

    model_config = ConfigDict(extra="forbid")
