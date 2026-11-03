from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User, Student, AttendanceRecord, Subject
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
    if str(current_user.role).strip().lower() != "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Student access required.",
        )

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
    if not student.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Student account is inactive.",
        )

    records = (
        db.query(AttendanceRecord, Subject)
        .join(
            Subject,
            AttendanceRecord.subject_id == Subject.id,
        )
        .filter(
            AttendanceRecord.student_id == student.id
        )
        .order_by(AttendanceRecord.attendance_date.desc(), AttendanceRecord.id.desc())
        .all()
    )

    total_classes = len(records)
    present_classes = sum(
        1 for record, subject in records
        if (record.status or "").lower() in {"present", "late"}
    )
    absent_classes = sum(
        1 for record, subject in records
        if (record.status or "").lower() == "absent"
    )

    attendance_percentage = (
        round((present_classes / total_classes) * 100, 2)
        if total_classes > 0
        else 0.0
    )

    subject_data = {}

    for record, subject in records:
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

        if (record.status or "").lower() in {"present", "late"}:
            item["present_classes"] += 1
        elif (record.status or "").lower() == "absent":
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
