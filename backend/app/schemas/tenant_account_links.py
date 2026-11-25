"""Request/response contracts for explicitly verified profile-account links."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class TenantAccountLinkCreate(BaseModel):
    user_id: int = Field(gt=0)
    # This is an accountable College Admin attestation, not automatic identity proof.
    # The workflow must perform its approved human identity check before submission.
    identity_verified: Literal[True]

    model_config = ConfigDict(extra="forbid")


class TenantAccountLinkRevoke(BaseModel):
    reason: str = Field(min_length=3, max_length=500)

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class TenantLegacyTeacherReconciliation(BaseModel):
    """Explicit Admin attestation for one selected profile/account pair.

    This confirms the institutional relationship only. It does not verify the
    login mailbox or set User.email_verified.
    """

    user_id: int = Field(gt=0)
    relationship_attested: Literal[True]
    reason: str | None = Field(default=None, max_length=500)

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class TenantTeacherAccountLinkCandidateResponse(BaseModel):
    """An active same-College login candidate for a human-verified link."""

    user_id: int
    name: str
    email: str
    college_id: int
    membership_status: Literal["active"]

    model_config = ConfigDict(extra="forbid")


class TenantStudentAccountLinkCandidateResponse(BaseModel):
    """An active same-College Student login candidate for human verification."""

    user_id: int
    name: str
    email: str
    college_id: int
    membership_status: Literal["active"]

    model_config = ConfigDict(extra="forbid")


class TenantAccountLinkResponse(BaseModel):
    id: int
    profile_id: int
    user_id: int
    college_id: int
    link_status: Literal["active", "revoked"]
    verified_by_user_id: int
    verified_at: datetime
    revoked_by_user_id: int | None = None
    revoked_at: datetime | None = None
    revocation_reason: str | None = None
    profile_is_active: bool | None = None
    user_is_active: bool | None = None
    membership_status: str | None = None

    model_config = ConfigDict(from_attributes=True, extra="forbid")


class TenantLegacyTeacherReconciliationResponse(TenantAccountLinkResponse):
    profile_verification_status: Literal["pending", "verified", "rejected"]
    membership_created: bool
    ownership_established: bool
