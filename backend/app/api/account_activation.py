"""Public one-time password setup endpoint for pending student/teacher accounts."""

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.account_activation import complete_activation


router = APIRouter()


@router.post("/complete")
async def complete_account_activation(request: Request, db: Session = Depends(get_db)):
    return await complete_activation(request, db)
