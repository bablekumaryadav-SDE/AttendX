from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user


router = APIRouter(
    prefix="/notifications",
    tags=["Notifications"],
)


@router.get("/mine")
def my_notifications(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    user_id = int(
        current_user["sub"]
    )

    rows = db.execute(
        text(
            """
            SELECT
                id,
                notification_type,
                channel,
                title,
                message,
                status,
                created_at,
                sent_at
            FROM notification_events
            WHERE user_id = :user_id
            ORDER BY created_at DESC
            LIMIT 100
            """
        ),
        {
            "user_id": user_id,
        },
    ).mappings().all()

    return [
        dict(row)
        for row in rows
    ]


@router.post("/{notification_id}/read")
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    user_id = int(
        current_user["sub"]
    )

    result = db.execute(
        text(
            """
            UPDATE notification_events
            SET status = 'read'
            WHERE id = :id
              AND user_id = :user_id
            RETURNING id
            """
        ),
        {
            "id": notification_id,
            "user_id": user_id,
        },
    )

    updated = result.scalar()

    if not updated:
        raise HTTPException(
            status_code=404,
            detail="Notification not found.",
        )

    db.commit()

    return {
        "success": True,
        "notification_id": notification_id,
        "status": "read",
    }