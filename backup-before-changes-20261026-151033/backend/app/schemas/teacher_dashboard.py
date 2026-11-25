from pydantic import BaseModel
from typing import List


class TeacherAssignmentSummary(BaseModel):
    assignment_id: int
    subject_id: int
    subject_name: str
    class_id: int
    class_name: str


class TeacherDashboardResponse(BaseModel):
    teacher_id: int
    teacher_name: str
    total_assignments: int
    assignments: List[TeacherAssignmentSummary]