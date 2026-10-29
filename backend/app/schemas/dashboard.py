from pydantic import BaseModel
from typing import List


class SubjectAttendance(BaseModel):
    subject_id: int
    subject_name: str
    total_classes: int
    present_classes: int
    absent_classes: int
    attendance_percentage: float


class AttendanceSummary(BaseModel):
    total_classes: int
    present_classes: int
    absent_classes: int
    attendance_percentage: float
    subjects: List[SubjectAttendance]