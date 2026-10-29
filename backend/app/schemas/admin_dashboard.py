from pydantic import BaseModel


class AdminDashboardResponse(BaseModel):
    total_students: int
    total_teachers: int
    total_users: int
    total_subjects: int
    total_classes: int
    total_attendance_records: int