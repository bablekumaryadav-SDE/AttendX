from pydantic import BaseModel
from typing import List


class TeacherAssignmentSummary(BaseModel):
    assignment_id: int
    subject_id: int
    subject_name: str
    class_id: int
    class_name: str
    location_name: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    radius_m: float = 100


class TeacherDashboardResponse(BaseModel):
    teacher_id: int
    teacher_name: str
    total_assignments: int
    assignments: List[TeacherAssignmentSummary]
