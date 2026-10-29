from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User, Student, AttendanceRecord, Attendance, Subject
from app.schemas.dashboard import AttendanceSummary, SubjectAttendance


router = APIRouter(
    prefix="/dashboard",
    tags=["Dashboard"]
)


@router.get(
    "/student/attendance",
    response_model=AttendanceSummary
)
def get_student_attendance(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    student = (
        db.query(Student)
        .filter(Student.email == current_user.email)
        .first()
    )

    if not student:
        raise HTTPException(
            status_code=404,
            detail="Student profile not found"
        )

    records = (
        db.query(AttendanceRecord, Attendance, Subject)
        .join(
            Attendance,
            AttendanceRecord.attendance_id == Attendance.id
        )
        .join(
            Subject,
            Attendance.subject_id == Subject.id
        )
        .filter(
            AttendanceRecord.student_id == student.id
        )
        .all()
    )

    total_classes = len(records)
    present_classes = sum(
        1 for record, attendance, subject in records
        if record.status.lower() == "present"
    )
    absent_classes = total_classes - present_classes

    attendance_percentage = (
        round((present_classes / total_classes) * 100, 2)
        if total_classes > 0
        else 0.0
    )

    subject_data = {}

    for record, attendance, subject in records:
        if subject.id not in subject_data:
            subject_data[subject.id] = {
                "subject_id": subject.id,
                "subject_name": subject.name,
                "total_classes": 0,
                "present_classes": 0,
                "absent_classes": 0,
            }

        item = subject_data[subject.id]

        item["total_classes"] += 1

        if record.status.lower() == "present":
            item["present_classes"] += 1
        else:
            item["absent_classes"] += 1

    subjects = []

    for item in subject_data.values():
        total = item["total_classes"]
        present = item["present_classes"]

        item["attendance_percentage"] = (
            round((present / total) * 100, 2)
            if total > 0
            else 0.0
        )

        subjects.append(
            SubjectAttendance(**item)
        )

    return AttendanceSummary(
        total_classes=total_classes,
        present_classes=present_classes,
        absent_classes=absent_classes,
        attendance_percentage=attendance_percentage,
        subjects=subjects
    )