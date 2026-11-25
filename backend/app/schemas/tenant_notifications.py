"""Response contracts for recipient-scoped in-app notifications."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class TenantNotificationResponse(BaseModel):
    id: int
    event_type: str
    channel: str
    title: str
    message: str
    read_at: datetime | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TenantNotificationPageResponse(BaseModel):
    items: list[TenantNotificationResponse]
    total: int
    limit: int
    offset: int


class TenantNotificationUnreadCountResponse(BaseModel):
    unread_count: int
