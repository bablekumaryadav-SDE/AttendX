from pydantic import BaseModel, ConfigDict


class CollegeMembershipOption(BaseModel):
    college_id: int
    college_name: str
    membership_role: str

    model_config = ConfigDict(extra="forbid")
