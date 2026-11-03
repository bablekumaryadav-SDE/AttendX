from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user


router = APIRouter(prefix="/notifications", tags=["Notifications"])


def _require_notification_schema(db: Session) -> None:
    if not inspect(db.get_bind()).has_table("notification_events"):
        raise HTTPException(
            status_code=503,
            detail=(
                "Notification storage is not installed in this database. "
                "Apply the reviewed notification_events migration after a verified backup."
            ),
        )


@router.get("/mine")
@router.get("/history")
def my_notifications(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _require_notification_schema(db)
    rows = db.execute(
        text(
            """
            SELECT id, event_type, channel, recipient, title, message,
                   delivery_status, read_at, created_at, sent_at
            FROM notification_events
            WHERE user_id = :user_id
            ORDER BY created_at DESC, id DESC
            LIMIT 100
            """
        ),
        {"user_id": int(current_user["sub"])},
    ).mappings().all()
    return [dict(row) for row in rows]


@router.post("/{notification_id}/read")
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _require_notification_schema(db)
    result = db.execute(
        text(
            """
            UPDATE notification_events
            SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
            WHERE id = :id AND user_id = :user_id
            """
        ),
        {
            "id": notification_id,
            "user_id": int(current_user["sub"]),
        },
    )
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(status_code=404, detail="Notification not found.")
    db.commit()
    return {"success": True, "notification_id": notification_id, "read": True}
