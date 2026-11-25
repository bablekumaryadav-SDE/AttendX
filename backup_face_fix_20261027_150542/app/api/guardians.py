import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_admin
from app.models import Student


router = APIRouter()


GUARDIAN_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS student_guardians (
    student_id INTEGER PRIMARY KEY
        REFERENCES students(id)
        ON DELETE CASCADE,

    guardian_name VARCHAR(120) NOT NULL,

    guardian_relationship VARCHAR(30)
        NOT NULL
        DEFAULT 'Father',

    guardian_mobile VARCHAR(20)
        NOT NULL,

    alternate_mobile VARCHAR(20),

    notify_absence BOOLEAN
        NOT NULL
        DEFAULT TRUE,

    notify_low_attendance BOOLEAN
        NOT NULL
        DEFAULT TRUE,

    notification_channel VARCHAR(20)
        NOT NULL
        DEFAULT 'sms_email',

    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),

    updated_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW()
)
"""


class GuardianPayload(BaseModel):
    guardian_name: str = Field(
        min_length=2,
        max_length=120,
    )

    guardian_relationship: str = Field(
        default="Father",
        max_length=30,
    )

    guardian_mobile: str = Field(
        min_length=10,
        max_length=20,
    )

    alternate_mobile: str | None = Field(
        default=None,
        max_length=20,
    )

    notify_absence: bool = True

    notify_low_attendance: bool = True

    notification_channel: str = Field(
        default="sms_email",
        max_length=20,
    )


class GuardianResponse(
    GuardianPayload
):
    model_config = ConfigDict(
        from_attributes=True
    )

    student_id: int

    created_at: datetime

    updated_at: datetime


ALLOWED_RELATIONSHIPS = {
    "Father",
    "Mother",
    "Guardian",
    "Other",
}

ALLOWED_CHANNELS = {
    "sms_email",
    "sms",
    "email",
}


def _ensure_guardian_table(
    db: Session,
) -> None:
    """
    Create the guardian table if it does not
    already exist.

    This keeps the feature compatible with the
    current project without requiring a separate
    migration tool at this stage.
    """

    db.execute(
        text(GUARDIAN_TABLE_SQL)
    )

    db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS
            ix_student_guardians_mobile
            ON student_guardians (guardian_mobile)
            """
        )
    )

    db.commit()


def _normalize_phone(
    value: str,
    field_name: str,
) -> str:
    """
    Normalize Indian 10-digit numbers to +91.
    International numbers are retained using
    their + country-code representation.
    """

    raw = value.strip()

    digits = re.sub(
        r"\D",
        "",
        raw,
    )

    if len(digits) == 10:
        return f"+91{digits}"

    if len(digits) < 10:
        raise HTTPException(
            status_code=422,
            detail=(
                f"{field_name} must contain "
                "a valid mobile number."
            ),
        )

    if len(digits) > 15:
        raise HTTPException(
            status_code=422,
            detail=(
                f"{field_name} must contain "
                "a valid mobile number."
            ),
        )

    return f"+{digits}"


def _validate_payload(
    data: GuardianPayload,
) -> dict:
    """
    Validate and normalize guardian information
    before writing to PostgreSQL.
    """

    name = " ".join(
        data.guardian_name
        .strip()
        .split()
    )

    relationship = (
        data.guardian_relationship
        .strip()
        .title()
    )

    if len(name) < 2:
        raise HTTPException(
            status_code=422,
            detail=(
                "Parent / guardian name "
                "is required."
            ),
        )

    if (
        relationship
        not in ALLOWED_RELATIONSHIPS
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                "Please select a valid "
                "guardian relationship."
            ),
        )

    if (
        data.notification_channel
        not in ALLOWED_CHANNELS
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                "Please select a valid "
                "notification channel."
            ),
        )

    guardian_mobile = _normalize_phone(
        data.guardian_mobile,
        "Parent / guardian mobile number",
    )

    alternate_mobile = None

    if data.alternate_mobile:
        alternate_mobile = (
            _normalize_phone(
                data.alternate_mobile,
                "Alternate mobile number",
            )
        )

        if (
            alternate_mobile
            == guardian_mobile
        ):
            raise HTTPException(
                status_code=422,
                detail=(
                    "Alternate mobile number "
                    "must be different from "
                    "the primary number."
                ),
            )

    return {
        "guardian_name": name,
        "guardian_relationship": (
            relationship
        ),
        "guardian_mobile": (
            guardian_mobile
        ),
        "alternate_mobile": (
            alternate_mobile
        ),
        "notify_absence": (
            data.notify_absence
        ),
        "notify_low_attendance": (
            data.notify_low_attendance
        ),
        "notification_channel": (
            data.notification_channel
        ),
    }


def _get_student(
    db: Session,
    student_id: int,
) -> Student:
    student = (
        db.query(Student)
        .filter(
            Student.id == student_id
        )
        .first()
    )

    if not student:
        raise HTTPException(
            status_code=404,
            detail="Student not found.",
        )

    return student


def _row_to_response(
    row,
) -> GuardianResponse:
    mapping = row._mapping

    return GuardianResponse(
        student_id=mapping[
            "student_id"
        ],
        guardian_name=mapping[
            "guardian_name"
        ],
        guardian_relationship=mapping[
            "guardian_relationship"
        ],
        guardian_mobile=mapping[
            "guardian_mobile"
        ],
        alternate_mobile=mapping[
            "alternate_mobile"
        ],
        notify_absence=mapping[
            "notify_absence"
        ],
        notify_low_attendance=mapping[
            "notify_low_attendance"
        ],
        notification_channel=mapping[
            "notification_channel"
        ],
        created_at=mapping[
            "created_at"
        ],
        updated_at=mapping[
            "updated_at"
        ],
    )


# =========================================================
# GET GUARDIAN
# GET /students/{student_id}/guardian
# =========================================================

@router.get(
    "/{student_id}/guardian",
    response_model=GuardianResponse,
    tags=["Student Guardian Contacts"],
)
def get_guardian(
    student_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(
        get_current_admin
    ),
):
    _ensure_guardian_table(db)

    _get_student(
        db,
        student_id,
    )

    row = db.execute(
        text(
            """
            SELECT
                student_id,
                guardian_name,
                guardian_relationship,
                guardian_mobile,
                alternate_mobile,
                notify_absence,
                notify_low_attendance,
                notification_channel,
                created_at,
                updated_at
            FROM student_guardians
            WHERE student_id = :student_id
            """
        ),
        {
            "student_id": student_id
        },
    ).first()

    if not row:
        raise HTTPException(
            status_code=404,
            detail=(
                "Parent / guardian details "
                "are not registered yet."
            ),
        )

    return _row_to_response(row)


# =========================================================
# SAVE / UPDATE GUARDIAN
# PUT /students/{student_id}/guardian
# =========================================================

@router.put(
    "/{student_id}/guardian",
    response_model=GuardianResponse,
    status_code=status.HTTP_200_OK,
    tags=["Student Guardian Contacts"],
)
def save_guardian(
    student_id: int,
    data: GuardianPayload,
    db: Session = Depends(get_db),
    current_user=Depends(
        get_current_admin
    ),
):
    _ensure_guardian_table(db)

    _get_student(
        db,
        student_id,
    )

    values = _validate_payload(
        data
    )

    now = datetime.now(
        timezone.utc
    )

    db.execute(
        text(
            """
            INSERT INTO student_guardians (
                student_id,
                guardian_name,
                guardian_relationship,
                guardian_mobile,
                alternate_mobile,
                notify_absence,
                notify_low_attendance,
                notification_channel,
                created_at,
                updated_at
            )
            VALUES (
                :student_id,
                :guardian_name,
                :guardian_relationship,
                :guardian_mobile,
                :alternate_mobile,
                :notify_absence,
                :notify_low_attendance,
                :notification_channel,
                :now,
                :now
            )

            ON CONFLICT (student_id)

            DO UPDATE SET
                guardian_name =
                    EXCLUDED.guardian_name,

                guardian_relationship =
                    EXCLUDED.guardian_relationship,

                guardian_mobile =
                    EXCLUDED.guardian_mobile,

                alternate_mobile =
                    EXCLUDED.alternate_mobile,

                notify_absence =
                    EXCLUDED.notify_absence,

                notify_low_attendance =
                    EXCLUDED.notify_low_attendance,

                notification_channel =
                    EXCLUDED.notification_channel,

                updated_at =
                    EXCLUDED.updated_at
            """
        ),
        {
            "student_id": student_id,
            **values,
            "now": now,
        },
    )

    db.commit()

    row = db.execute(
        text(
            """
            SELECT
                student_id,
                guardian_name,
                guardian_relationship,
                guardian_mobile,
                alternate_mobile,
                notify_absence,
                notify_low_attendance,
                notification_channel,
                created_at,
                updated_at
            FROM student_guardians
            WHERE student_id = :student_id
            """
        ),
        {
            "student_id": student_id
        },
    ).first()

    return _row_to_response(row)


# =========================================================
# ROUTER ATTACHMENT
# =========================================================

def attach_guardian_routes(
    target_router: APIRouter,
) -> None:
    """
    Attach guardian routes to the existing
    Students APIRouter.

    This allows the endpoints to remain:

        /students/{id}/guardian
    """

    existing_paths = {
        getattr(
            route,
            "path",
            None,
        )
        for route in target_router.routes
    }

    for route in router.routes:
        route_path = getattr(
            route,
            "path",
            None,
        )

        if (
            route_path
            not in existing_paths
        ):
            target_router.routes.append(
                route
            )