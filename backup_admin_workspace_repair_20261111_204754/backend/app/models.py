import json
import math
import re

from sqlalchemy import (
    Boolean,
    Date,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    JSON,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import validates
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


_COLLEGE_SLUG_PATTERN = re.compile(r"^[a-z0-9_-]{1,80}$")


class Student(Base):
    __tablename__ = "students"
    __table_args__ = (
        UniqueConstraint("id", "college_id", name="uq_students_id_college"),
        Index("ix_students_college_id", "college_id", "id"),
        Index(
            "uq_students_college_enrollment_number",
            "college_id",
            "enrollment_number",
            unique=True,
            sqlite_where=text("college_id IS NOT NULL AND enrollment_number IS NOT NULL"),
            postgresql_where=text("college_id IS NOT NULL AND enrollment_number IS NOT NULL"),
        ),
        Index(
            "uq_students_college_roll_number",
            "college_id",
            "roll_number",
            unique=True,
            sqlite_where=text("college_id IS NOT NULL"),
            postgresql_where=text("college_id IS NOT NULL"),
        ),
        Index(
            "uq_students_unknown_roll_number",
            "roll_number",
            unique=True,
            sqlite_where=text("college_id IS NULL"),
            postgresql_where=text("college_id IS NULL"),
        ),
        CheckConstraint("admission_year IS NULL OR admission_year BETWEEN 1900 AND 2200", name="ck_students_admission_year_range"),
        CheckConstraint("program_duration_years IS NULL OR program_duration_years BETWEEN 1 AND 12", name="ck_students_program_duration_range"),
        CheckConstraint("current_academic_year IS NULL OR current_academic_year BETWEEN 1 AND 12", name="ck_students_current_academic_year_range"),
        CheckConstraint("current_semester IS NULL OR current_semester BETWEEN 1 AND 24", name="ck_students_current_semester_range"),
    )

    id = Column(Integer, primary_key=True, index=True)
    # NULL deliberately means legacy ownership is unknown. Tenant APIs must
    # exclude it; only explicit, reviewed membership workflows may set it.
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="RESTRICT"), nullable=True)
    student_code = Column(String(20), unique=True, nullable=True, index=True)
    name = Column(String(100), nullable=False)
    email = Column(String(150), unique=True, nullable=False, index=True)
    roll_number = Column(String(50), nullable=False)
    department = Column(String(100), nullable=True)
    date_of_birth = Column(Date, nullable=True)
    gender = Column(String(30), nullable=True)
    # Enrollment identifiers are College-local. NULL College ownership remains
    # UNKNOWN and is excluded from this scoped uniqueness constraint.
    enrollment_number = Column(String(80), nullable=True)
    admission_year = Column(Integer, nullable=True)
    admission_session = Column(String(30), nullable=True)
    program_duration_years = Column(Integer, nullable=True)
    current_academic_year = Column(Integer, nullable=True)
    current_semester = Column(Integer, nullable=True)
    section = Column(String(50), nullable=True)
    course = Column(String(120), nullable=True)
    mobile = Column(String(20), nullable=True)
    address = Column(String(255), nullable=True)
    city = Column(String(100), nullable=True)
    state = Column(String(100), nullable=True)
    postal_code = Column(String(20), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    face_registration = relationship(
        "FaceEmbedding",
        back_populates="student",
        uselist=False,
        cascade="all, delete-orphan",
    )

    @property
    def face_registered(self) -> bool:
        if not self.is_active or not self.face_registration:
            return False
        if self.face_registration.status != "registered":
            return False
        try:
            values = json.loads(self.face_registration.embedding_json or "null")
            if not isinstance(values, list) or len(values) != 128:
                return False
            if not all(isinstance(value, (int, float)) and math.isfinite(value) for value in values):
                return False
            norm = math.sqrt(sum(value * value for value in values))
            return 0.999 <= norm <= 1.001
        except (TypeError, ValueError, json.JSONDecodeError):
            return False

    @property
    def face_registered_at(self):
        if self.face_registration and self.face_registration.status == "registered":
            return self.face_registration.registered_at
        return None


class FaceEmbedding(Base):
    """
    Stores the student's registered reference image and SFace embedding.
    API response schemas intentionally omit both biometric fields.
    """

    __tablename__ = "face_embeddings"

    id = Column(Integer, primary_key=True, index=True)

    student_id = Column(
        Integer,
        ForeignKey("students.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )

    image_data = Column(LargeBinary, nullable=False)
    mime_type = Column(String(100), nullable=False, default="image/jpeg")
    image_sha256 = Column(String(64), nullable=False, unique=True, index=True)
    embedding_json = Column(String, nullable=True)

    status = Column(
        String(30),
        nullable=False,
        default="registered",
    )

    registered_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    student = relationship(
        "Student",
        back_populates="face_registration",
    )


class StudentIdCounter(Base):
    __tablename__ = "student_id_counters"

    year = Column(Integer, primary_key=True)
    last_number = Column(Integer, nullable=False, default=0)


class Teacher(Base):
    __tablename__ = "teachers"
    __table_args__ = (
        UniqueConstraint("id", "college_id", name="uq_teachers_id_college"),
        Index("ix_teachers_college_id", "college_id", "id"),
        Index(
            "uq_teachers_college_employee_id",
            "college_id",
            "employee_id",
            unique=True,
            sqlite_where=text("college_id IS NOT NULL"),
            postgresql_where=text("college_id IS NOT NULL"),
        ),
        Index(
            "uq_teachers_unknown_employee_id",
            "employee_id",
            unique=True,
            sqlite_where=text("college_id IS NULL"),
            postgresql_where=text("college_id IS NULL"),
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="RESTRICT"), nullable=True)
    name = Column(String(100), nullable=False)
    email = Column(String(150), unique=True, nullable=False, index=True)
    employee_id = Column(String(50), nullable=False)
    department = Column(String(100), nullable=True)
    gender = Column(String(30), nullable=True)
    designation = Column(String(100), nullable=True)
    qualification = Column(String(150), nullable=True)
    mobile = Column(String(20), nullable=True)
    address = Column(String(255), nullable=True)
    joining_date = Column(Date, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    email = Column(String(150), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(50), default="admin", nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class College(Base):
    """Tenant identity. Creating this ORM model does not create a college row."""

    __tablename__ = "colleges"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'active', 'suspended', 'archived')",
            name="ck_colleges_status",
        ),
    )

    id = Column(Integer, primary_key=True)
    slug = Column(String(80), nullable=False, unique=True, index=True)
    official_name = Column(String(200), nullable=False)
    display_name = Column(String(120), nullable=True)
    college_type = Column(String(80), nullable=True)
    address = Column(String(255), nullable=True)
    city = Column(String(100), nullable=True)
    state = Column(String(100), nullable=True)
    postal_code = Column(String(20), nullable=True)
    country = Column(String(80), nullable=True)
    official_email = Column(String(254), nullable=True)
    contact_number = Column(String(20), nullable=True)
    website = Column(String(2048), nullable=True)
    status = Column(String(20), nullable=False, default="pending", server_default="pending")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    @validates("slug")
    def normalize_slug(self, _key, value):
        slug = str(value or "").strip().lower()
        if not _COLLEGE_SLUG_PATTERN.fullmatch(slug):
            raise ValueError("College slug must contain only letters, numbers, hyphens or underscores.")
        return slug

    @validates("official_name")
    def validate_official_name(self, _key, value):
        name = str(value or "").strip()
        if not name or len(name) > 200:
            raise ValueError("College official name is required and must be at most 200 characters.")
        return name

    @validates("display_name")
    def normalize_display_name(self, _key, value):
        if value is None:
            return None
        name = str(value).strip()
        if not name:
            return None
        if len(name) > 120:
            raise ValueError("College display name must be at most 120 characters.")
        return name


class CollegeMembership(Base):
    """Explicit user-to-college grant, separate from global User.role."""

    __tablename__ = "college_memberships"
    __table_args__ = (
        UniqueConstraint("user_id", "college_id", name="uq_college_memberships_user_college"),
        UniqueConstraint("id", "user_id", "college_id", name="uq_college_memberships_id_user_college"),
        CheckConstraint(
            "status IN ('pending', 'active', 'suspended', 'revoked')",
            name="ck_college_memberships_status",
        ),
        CheckConstraint(
            "role IN ('college_admin', 'teacher', 'student')",
            name="ck_college_memberships_role",
        ),
        Index("ix_college_memberships_user_status", "user_id", "status"),
        Index("ix_college_memberships_college_status", "college_id", "status"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="RESTRICT"), nullable=False)
    role = Column(String(30), nullable=False)
    status = Column(String(20), nullable=False, default="pending", server_default="pending")
    created_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    activated_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    revoked_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    activated_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    status_reason = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class AccountInvitation(Base):
    """Single-use account setup invitation; only a digest of the token is stored."""

    __tablename__ = "account_invitations"
    __table_args__ = (
        ForeignKeyConstraint(
            ["membership_id", "user_id", "college_id"],
            ["college_memberships.id", "college_memberships.user_id", "college_memberships.college_id"],
            name="fk_account_invitations_membership_user_college",
            ondelete="RESTRICT",
        ),
        CheckConstraint("delivery_status IN ('sent', 'failed')", name="ck_account_invitations_delivery_status"),
        Index("ix_account_invitations_college_membership_created", "college_id", "membership_id", "created_at"),
        Index("ix_account_invitations_expiry", "expires_at"),
    )

    id = Column(Integer, primary_key=True)
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="RESTRICT"), nullable=False)
    membership_id = Column(Integer, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    token_digest = Column(String(64), nullable=False, unique=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    consumed_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    delivery_status = Column(String(20), nullable=False)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class CollegeRegistrationApplication(Base):
    """Persisted public application; submitted credentials remain only as a hash."""

    __tablename__ = "college_registration_applications"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'under_review', 'approved', 'rejected')",
            name="ck_college_registration_applications_status",
        ),
        CheckConstraint(
            "provisioning_status IN ('not_started', 'pending_activation', 'activated', 'rejected')",
            name="ck_college_registration_applications_provisioning_status",
        ),
        Index(
            "uq_college_registration_applications_active_official_email",
            "official_email",
            unique=True,
            postgresql_where=text("status <> 'rejected'"),
            sqlite_where=text("status <> 'rejected'"),
        ),
        Index(
            "uq_college_registration_applications_active_admin_email",
            "admin_email",
            unique=True,
            postgresql_where=text("status <> 'rejected'"),
            sqlite_where=text("status <> 'rejected'"),
        ),
        Index("ix_college_registration_applications_status_submitted", "status", "submitted_at"),
    )

    id = Column(Integer, primary_key=True)
    application_reference = Column(String(48), nullable=False, unique=True)
    tracking_token_digest = Column(String(64), nullable=False)
    status = Column(String(20), nullable=False, default="pending", server_default="pending")
    provisioning_status = Column(String(24), nullable=False, default="not_started", server_default="not_started")

    college_name = Column(String(200), nullable=False)
    college_type = Column(String(80), nullable=False)
    address = Column(String(255), nullable=False)
    city = Column(String(100), nullable=False)
    state = Column(String(100), nullable=False)
    postal_code = Column(String(20), nullable=False)
    country = Column(String(80), nullable=False)
    official_email = Column(String(254), nullable=False)
    contact_number = Column(String(20), nullable=False)
    website = Column(String(2048), nullable=True)

    admin_name = Column(String(120), nullable=False)
    admin_email = Column(String(254), nullable=False)
    admin_contact_number = Column(String(20), nullable=False)
    admin_password_hash = Column(String(255), nullable=True)

    submitted_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    reviewed_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    review_reason = Column(String(1000), nullable=True)
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="RESTRICT"), nullable=True)
    admin_user_id = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)


class CollegeRegistrationReview(Base):
    """Append-only review event written by platform API handlers."""

    __tablename__ = "college_registration_reviews"
    __table_args__ = (
        CheckConstraint(
            "decision IN ('under_review', 'approved', 'rejected')",
            name="ck_college_registration_reviews_decision",
        ),
        Index("ix_college_registration_reviews_application_created", "application_id", "created_at"),
    )

    id = Column(Integer, primary_key=True)
    application_id = Column(
        Integer,
        ForeignKey("college_registration_applications.id", ondelete="RESTRICT"),
        nullable=False,
    )
    reviewer_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    decision = Column(String(20), nullable=False)
    reason = Column(String(1000), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class CollegeStatusHistory(Base):
    """Auditable platform status changes for a College."""

    __tablename__ = "college_status_history"
    __table_args__ = (
        CheckConstraint(
            "action IN ('provisioned_pending', 'approved_and_activated', 'suspended', 'reactivated')",
            name="ck_college_status_history_action",
        ),
        CheckConstraint(
            "new_status IN ('pending', 'active', 'suspended', 'archived')",
            name="ck_college_status_history_new_status",
        ),
        Index("ix_college_status_history_college_created", "college_id", "created_at"),
    )

    id = Column(Integer, primary_key=True)
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="RESTRICT"), nullable=False)
    actor_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(32), nullable=False)
    previous_status = Column(String(20), nullable=True)
    new_status = Column(String(20), nullable=False)
    reason = Column(String(1000), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class Attendance(Base):
    __tablename__ = "attendance"
    __table_args__ = (
        UniqueConstraint("id", "college_id", name="uq_attendance_id_college"),
        ForeignKeyConstraint(["student_id", "college_id"], ["students.id", "students.college_id"], name="fk_attendance_student_college", ondelete="RESTRICT"),
        ForeignKeyConstraint(["teacher_id", "college_id"], ["teachers.id", "teachers.college_id"], name="fk_attendance_teacher_college", ondelete="RESTRICT"),
        Index("ix_attendance_college_date", "college_id", "date"),
    )

    id = Column(Integer, primary_key=True, index=True)
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="RESTRICT"), nullable=True)

    student_id = Column(Integer, nullable=False, index=True)
    teacher_id = Column(Integer, nullable=False, index=True)

    date = Column(
        DateTime(timezone=True),
        nullable=False,
    )

    status = Column(
        String(20),
        nullable=False,
        default="present",
    )

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
    )


class Subject(Base):
    __tablename__ = "subjects"
    __table_args__ = (
        UniqueConstraint("id", "college_id", name="uq_subjects_id_college"),
        Index("ix_subjects_college_id", "college_id", "id"),
        Index(
            "uq_subjects_college_code",
            "college_id",
            "code",
            unique=True,
            sqlite_where=text("college_id IS NOT NULL"),
            postgresql_where=text("college_id IS NOT NULL"),
        ),
        Index(
            "uq_subjects_unknown_code",
            "code",
            unique=True,
            sqlite_where=text("college_id IS NULL"),
            postgresql_where=text("college_id IS NULL"),
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="RESTRICT"), nullable=True)
    name = Column(String(100), nullable=False)
    code = Column(String(50), nullable=False)
    department = Column(String(100), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Class(Base):
    __tablename__ = "classes"
    __table_args__ = (
        CheckConstraint("latitude IS NULL OR latitude BETWEEN -90 AND 90", name="ck_classes_latitude_range"),
        CheckConstraint("longitude IS NULL OR longitude BETWEEN -180 AND 180", name="ck_classes_longitude_range"),
        CheckConstraint("(latitude IS NULL) = (longitude IS NULL)", name="ck_classes_coordinate_pair"),
        CheckConstraint("radius_m BETWEEN 10 AND 5000", name="ck_classes_radius_m_range"),
        UniqueConstraint("id", "college_id", name="uq_classes_id_college"),
        Index("ix_classes_college_id", "college_id", "id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="RESTRICT"), nullable=True)
    name = Column(String(100), nullable=False)
    section = Column(String(50), nullable=True)
    department = Column(String(100), nullable=True)
    semester = Column(Integer, nullable=True)
    academic_year = Column(String(20), nullable=True)
    location_name = Column(String(120), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    radius_m = Column(Float, nullable=False, default=100, server_default="100")
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class TeacherAssignment(Base):
    __tablename__ = "teacher_assignments"
    __table_args__ = (
        UniqueConstraint("id", "college_id", name="uq_teacher_assignments_id_college"),
        ForeignKeyConstraint(["teacher_id", "college_id"], ["teachers.id", "teachers.college_id"], name="fk_teacher_assignments_teacher_college", ondelete="RESTRICT"),
        ForeignKeyConstraint(["subject_id", "college_id"], ["subjects.id", "subjects.college_id"], name="fk_teacher_assignments_subject_college", ondelete="RESTRICT"),
        ForeignKeyConstraint(["class_id", "college_id"], ["classes.id", "classes.college_id"], name="fk_teacher_assignments_class_college", ondelete="RESTRICT"),
        Index("ix_teacher_assignments_college_active", "college_id", "is_active"),
    )

    id = Column(Integer, primary_key=True, index=True)
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="RESTRICT"), nullable=True)

    teacher_id = Column(Integer, nullable=False, index=True)
    subject_id = Column(Integer, nullable=False, index=True)
    class_id = Column(Integer, nullable=False, index=True)

    academic_year = Column(String(20), nullable=True)
    semester = Column(Integer, nullable=True)

    is_active = Column(Boolean, default=True, nullable=False)

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
    )


class StudentClassAssignment(Base):
    """Current and historical class membership for a student."""

    __tablename__ = "student_class_assignments"
    __table_args__ = (
        UniqueConstraint("id", "college_id", name="uq_student_class_assignments_id_college"),
        ForeignKeyConstraint(["student_id", "college_id"], ["students.id", "students.college_id"], name="fk_student_class_assignments_student_college", ondelete="RESTRICT"),
        ForeignKeyConstraint(["class_id", "college_id"], ["classes.id", "classes.college_id"], name="fk_student_class_assignments_class_college", ondelete="RESTRICT"),
        Index("ix_student_class_assignments_college_active", "college_id", "is_active"),
    )

    id = Column(Integer, primary_key=True, index=True)
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="RESTRICT"), nullable=True)
    student_id = Column(
        Integer,
        ForeignKey("students.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    class_id = Column(
        Integer,
        ForeignKey("classes.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    academic_year = Column(String(20), nullable=True)
    semester = Column(Integer, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AttendanceRecord(Base):
    __tablename__ = "attendance_records"
    __table_args__ = (
        UniqueConstraint("id", "college_id", name="uq_attendance_records_id_college"),
        ForeignKeyConstraint(["student_id", "college_id"], ["students.id", "students.college_id"], name="fk_attendance_records_student_college", ondelete="RESTRICT"),
        ForeignKeyConstraint(["teacher_id", "college_id"], ["teachers.id", "teachers.college_id"], name="fk_attendance_records_teacher_college", ondelete="RESTRICT"),
        ForeignKeyConstraint(["subject_id", "college_id"], ["subjects.id", "subjects.college_id"], name="fk_attendance_records_subject_college", ondelete="RESTRICT"),
        ForeignKeyConstraint(["class_id", "college_id"], ["classes.id", "classes.college_id"], name="fk_attendance_records_class_college", ondelete="RESTRICT"),
        Index("ix_attendance_records_college_date", "college_id", "attendance_date"),
    )

    id = Column(Integer, primary_key=True, index=True)
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="RESTRICT"), nullable=True)

    student_id = Column(Integer, nullable=False, index=True)
    teacher_id = Column(Integer, nullable=False, index=True)
    subject_id = Column(Integer, nullable=False, index=True)
    class_id = Column(Integer, nullable=False, index=True)

    attendance_date = Column(
        DateTime(timezone=True),
        nullable=False,
    )

    status = Column(
        String(20),
        default="present",
        nullable=False,
    )

    remarks = Column(
        String(255),
        nullable=True,
    )

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
    )


class StudentAcademicHistory(Base):
    """Append-only-by-application academic progression snapshot for a College student."""

    __tablename__ = "student_academic_history"
    __table_args__ = (
        ForeignKeyConstraint(
            ["student_id", "college_id"],
            ["students.id", "students.college_id"],
            name="fk_student_academic_history_student_college",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["class_id", "college_id"],
            ["classes.id", "classes.college_id"],
            name="fk_student_academic_history_class_college",
            ondelete="RESTRICT",
        ),
        Index("ix_student_academic_history_college_student_created", "college_id", "student_id", "created_at"),
        CheckConstraint("action IN ('admitted', 'promoted', 'updated')", name="ck_student_academic_history_action"),
    )

    id = Column(Integer, primary_key=True)
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="RESTRICT"), nullable=False)
    student_id = Column(Integer, nullable=False)
    class_id = Column(Integer, nullable=True)
    admission_year = Column(Integer, nullable=True)
    academic_year = Column(Integer, nullable=True)
    semester = Column(Integer, nullable=True)
    section = Column(String(50), nullable=True)
    action = Column(String(20), nullable=False)
    reason = Column(String(500), nullable=True)
    actor_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class AttendanceSession(Base):
    """College-owned attendance event container; QR secret is sensitive."""

    __tablename__ = "attendance_sessions"
    __table_args__ = (
        UniqueConstraint("id", "college_id", name="uq_attendance_sessions_id_college"),
        ForeignKeyConstraint(["teacher_id", "college_id"], ["teachers.id", "teachers.college_id"], name="fk_attendance_sessions_teacher_college", ondelete="RESTRICT"),
        ForeignKeyConstraint(["subject_id", "college_id"], ["subjects.id", "subjects.college_id"], name="fk_attendance_sessions_subject_college", ondelete="RESTRICT"),
        ForeignKeyConstraint(["class_id", "college_id"], ["classes.id", "classes.college_id"], name="fk_attendance_sessions_class_college", ondelete="RESTRICT"),
        CheckConstraint("status IN ('active', 'closed')", name="ck_attendance_sessions_status"),
        CheckConstraint("ends_at > starts_at", name="ck_attendance_sessions_time"),
        Index("ix_attendance_sessions_college_status_start", "college_id", "status", "starts_at"),
        Index("ix_attendance_sessions_teacher_status", "teacher_id", "status", "starts_at"),
        Index("ix_attendance_sessions_class_subject", "class_id", "subject_id", "starts_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="RESTRICT"), nullable=True)
    teacher_id = Column(Integer, ForeignKey("teachers.id", ondelete="RESTRICT"), nullable=False)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="RESTRICT"), nullable=False)
    class_id = Column(Integer, ForeignKey("classes.id", ondelete="RESTRICT"), nullable=False)
    title = Column(String(180), nullable=False)
    starts_at = Column(DateTime(timezone=True), nullable=False)
    ends_at = Column(DateTime(timezone=True), nullable=False)
    status = Column(String(20), nullable=False, default="active", server_default="active")
    qr_secret = Column(Text, nullable=False)
    qr_expires_at = Column(DateTime(timezone=True), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    radius_m = Column(Float, nullable=False, default=100, server_default="100")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    closed_at = Column(DateTime(timezone=True), nullable=True)


class AttendanceEvent(Base):
    """Sensitive attendance evidence owned by the session's College."""

    __tablename__ = "attendance_events"
    __table_args__ = (
        UniqueConstraint("id", "college_id", name="uq_attendance_events_id_college"),
        UniqueConstraint("session_id", "student_id", name="uq_attendance_event_session_student"),
        ForeignKeyConstraint(["session_id", "college_id"], ["attendance_sessions.id", "attendance_sessions.college_id"], name="fk_attendance_events_session_college", ondelete="RESTRICT"),
        ForeignKeyConstraint(["student_id", "college_id"], ["students.id", "students.college_id"], name="fk_attendance_events_student_college", ondelete="RESTRICT"),
        CheckConstraint("method IN ('qr', 'face', 'manual', 'session_close')", name="ck_attendance_events_method"),
        CheckConstraint("status IN ('present', 'absent', 'late')", name="ck_attendance_events_status"),
        Index("ix_attendance_events_college_student_verified", "college_id", "student_id", "verified_at"),
        Index("ix_attendance_events_college_session_status", "college_id", "session_id", "status"),
        Index("ix_attendance_events_student_verified", "student_id", "verified_at"),
        Index("ix_attendance_events_session_status", "session_id", "status"),
    )

    id = Column(Integer, primary_key=True, index=True)
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="RESTRICT"), nullable=True)
    session_id = Column(Integer, ForeignKey("attendance_sessions.id", ondelete="RESTRICT"), nullable=False)
    student_id = Column(Integer, ForeignKey("students.id", ondelete="RESTRICT"), nullable=False)
    method = Column(String(20), nullable=False)
    status = Column(String(20), nullable=False)
    confidence = Column(Float, nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    distance_m = Column(Float, nullable=True)
    verification_reason = Column(Text, nullable=True)
    device_hash = Column(String(128), nullable=True)
    verified_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class StudentGuardian(Base):
    """Sensitive guardian contact dependent on exactly one student."""

    __tablename__ = "student_guardians"
    __table_args__ = (
        CheckConstraint("guardian_relationship IN ('Father', 'Mother', 'Guardian', 'Brother', 'Sister', 'Other')", name="ck_student_guardians_relationship"),
        CheckConstraint("notification_channel IN ('sms_email', 'sms', 'email')", name="ck_student_guardians_notification_channel"),
        Index("ix_student_guardians_mobile", "guardian_mobile"),
    )

    student_id = Column(Integer, ForeignKey("students.id", ondelete="CASCADE"), primary_key=True)
    guardian_name = Column(String(120), nullable=True)
    guardian_relationship = Column(String(30), nullable=False, default="Father", server_default="Father")
    guardian_mobile = Column(String(20), nullable=True)
    father_name = Column(String(120), nullable=True)
    mother_name = Column(String(120), nullable=True)
    parent_email = Column(String(254), nullable=True)
    alternate_mobile = Column(String(20), nullable=True)
    notify_absence = Column(Boolean, nullable=False, default=True, server_default="true")
    notify_low_attendance = Column(Boolean, nullable=False, default=True, server_default="true")
    notification_channel = Column(String(20), nullable=False, default="sms_email", server_default="sms_email")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class AttendanceAuditLog(Base):
    """Platform audit record; tenant events carry only verified College IDs."""

    __tablename__ = "attendance_audit_logs"
    __table_args__ = (
        UniqueConstraint("id", "college_id", name="uq_attendance_audit_logs_id_college"),
        Index("ix_attendance_audit_logs_college_created", "college_id", "created_at"),
        Index("ix_attendance_audit_logs_created", "created_at"),
        Index("ix_attendance_audit_logs_entity", "entity_type", "entity_id"),
    )

    id = Column(Integer, primary_key=True)
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="RESTRICT"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(Text, nullable=False)
    entity_type = Column(String(100), nullable=True)
    entity_id = Column(Integer, nullable=True)
    event_metadata = Column("metadata", JSON().with_variant(JSONB, "postgresql"), nullable=False, server_default=text("'{}'"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class NotificationEvent(Base):
    """An account-scoped notification queued by a real application event."""

    __tablename__ = "notification_events"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_notification_events_idempotency_key"),
        UniqueConstraint("id", "college_id", name="uq_notification_events_id_college"),
        ForeignKeyConstraint(["student_id", "college_id"], ["students.id", "students.college_id"], name="fk_notification_events_student_college", ondelete="SET NULL"),
        Index("ix_notification_events_user_created", "user_id", "created_at"),
        Index("ix_notification_events_college_created", "college_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    # NULL keeps legacy or account-global events unassigned. A college event
    # with a student must point to that student's same College.
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="RESTRICT"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    student_id = Column(Integer, ForeignKey("students.id", ondelete="SET NULL"), nullable=True, index=True)
    event_type = Column(String(64), nullable=False)
    channel = Column(String(24), nullable=False, default="in_app")
    recipient = Column(String(255), nullable=True)
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    delivery_status = Column(String(20), nullable=False, default="queued")
    idempotency_key = Column(String(180), nullable=False)
    read_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    sent_at = Column(DateTime(timezone=True), nullable=True)
