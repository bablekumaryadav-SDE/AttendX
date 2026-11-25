from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CourseworkAssignmentCreate(BaseModel):
    teacher_assignment_id: int = Field(gt=0)
    title: str = Field(min_length=1, max_length=240)
    instructions: str = Field(min_length=1, max_length=20000)
    issued_at: datetime
    due_at: datetime
    maximum_marks: Decimal | None = Field(default=None, ge=0, max_digits=8, decimal_places=2)

    @model_validator(mode="after")
    def validate_times(self):
        if self.issued_at.tzinfo is None or self.due_at.tzinfo is None:
            raise ValueError("Issue and due times must include a timezone.")
        if self.due_at <= self.issued_at:
            raise ValueError("The due time must be later than the issue time.")
        if not self.title.strip() or not self.instructions.strip():
            raise ValueError("Title and instructions cannot be blank.")
        return self


class CourseworkAssignmentDraftUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=240)
    instructions: str | None = Field(default=None, min_length=1, max_length=20000)
    issued_at: datetime | None = None
    due_at: datetime | None = None
    maximum_marks: Decimal | None = Field(default=None, ge=0, max_digits=8, decimal_places=2)

    @model_validator(mode="after")
    def validate_values(self):
        if self.title is not None and not self.title.strip():
            raise ValueError("Title cannot be blank.")
        if self.instructions is not None and not self.instructions.strip():
            raise ValueError("Instructions cannot be blank.")
        if self.issued_at is not None and self.issued_at.tzinfo is None:
            raise ValueError("Issue time must include a timezone.")
        if self.due_at is not None and self.due_at.tzinfo is None:
            raise ValueError("Due time must include a timezone.")
        if self.issued_at is not None and self.due_at is not None and self.due_at <= self.issued_at:
            raise ValueError("The due time must be later than the issue time.")
        return self


class CourseworkReason(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def validate_reason(self):
        if not self.reason.strip():
            raise ValueError("A reason is required.")
        return self


class CourseworkSubmissionCreate(BaseModel):
    idempotency_key: UUID
    content: str = Field(min_length=1, max_length=50000)

    @model_validator(mode="after")
    def validate_content(self):
        if not self.content.strip():
            raise ValueError("Submission text cannot be blank.")
        return self


class CourseworkAssignmentResponse(BaseModel):
    id: int
    college_id: int
    teacher_assignment_id: int
    created_by_user_id: int
    title: str
    instructions: str
    issued_at: datetime
    due_at: datetime
    status: str
    maximum_marks: Decimal | None
    published_at: datetime | None
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CourseworkTeacherMappingResponse(BaseModel):
    id: int
    class_id: int
    class_name: str
    subject_id: int
    subject_name: str
    academic_year: str | None
    semester: int | None


class CourseworkRevisionResponse(BaseModel):
    id: int
    revision_number: int
    content: str
    submitted_at: datetime
    is_late: bool

    model_config = ConfigDict(from_attributes=True)

class CourseworkGradeCreate(BaseModel):
    marks_awarded: Decimal = Field(ge=0, max_digits=8, decimal_places=2)
    feedback: str | None = Field(default=None, max_length=5000)


class CourseworkGradeResponse(BaseModel):
    id: int
    revision_id: int
    version: int
    marks_awarded: Decimal
    feedback: str | None
    graded_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CourseworkSubmissionResponse(BaseModel):
    submission_id: int
    coursework_assignment_id: int
    revisions: list[CourseworkRevisionResponse]


class CourseworkStudentAssignmentResponse(CourseworkAssignmentResponse):
    submission_id: int | None
    latest_revision: CourseworkRevisionResponse | None
    current_grade: CourseworkGradeResponse | None = None
    state: str


class CourseworkAdminSummaryResponse(CourseworkAssignmentResponse):
    teacher_id: int
    teacher_name: str
    class_id: int
    class_name: str
    subject_id: int
    subject_name: str
    academic_year: str | None
    semester: int | None
    submission_count: int
    enrolled_count: int
    pending_count: int
    late_submission_count: int
    completion_percentage: float


class CourseworkAdminFacetResponse(BaseModel):
    id: int
    name: str


class CourseworkAdminTotalsResponse(BaseModel):
    total: int
    published: int
    draft: int
    archived: int
    submissions: int
    pending_submissions: int
    late_submissions: int


class CourseworkAdminListResponse(BaseModel):
    items: list[CourseworkAdminSummaryResponse]
    total: int
    limit: int
    offset: int
    summary: CourseworkAdminTotalsResponse
    teachers: list[CourseworkAdminFacetResponse]
    classes: list[CourseworkAdminFacetResponse]
    subjects: list[CourseworkAdminFacetResponse]


class CourseworkSubmissionMonitorResponse(BaseModel):
    student_id: int
    student_name: str
    roll_number: str
    submission_id: int | None
    state: str
    latest_revision: CourseworkRevisionResponse | None


class CourseworkSubmissionDetailResponse(BaseModel):
    student_id: int
    student_name: str
    roll_number: str
    submission_id: int
    state: str
    revisions: list[CourseworkRevisionResponse]
    current_grade: CourseworkGradeResponse | None = None


class TenantNotificationResponse(BaseModel):
    id: int
    event_type: str
    channel: str
    title: str
    message: str
    read_at: datetime | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TenantNotificationPageResponse(BaseModel):
    items: list[TenantNotificationResponse]
    total: int
    limit: int
    offset: int


class TenantNotificationUnreadCountResponse(BaseModel):
    unread_count: int
