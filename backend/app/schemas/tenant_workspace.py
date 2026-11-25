"""Read-only tenant workspace records for parent contacts and notification events."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class TenantGuardianItem(BaseModel):
    student_id: int
    student_name: str
    student_roll_number: str
    student_active: bool
    guardian_name: str | None = None
    guardian_relationship: str
    guardian_mobile: str | None = None
    parent_email: str | None = None

    model_config = ConfigDict(extra="forbid")


class TenantGuardianPage(BaseModel):
    items: list[TenantGuardianItem]
    total: int
    page: int
    page_size: int


class TenantNotificationEventItem(BaseModel):
    id: int
    student_id: int | None = None
    event_type: str
    channel: str
    title: str
    message: str
    record_status: str
    read_at: datetime | None = None
    created_at: datetime
    sent_at: datetime | None = None

    model_config = ConfigDict(extra="forbid")


class TenantNotificationEventPage(BaseModel):
    items: list[TenantNotificationEventItem]
    total: int
    page: int
    page_size: int
