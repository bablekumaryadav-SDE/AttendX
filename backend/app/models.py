import json
import math

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class Student(Base):
    __tablename__ = "students"

    id = Column(Integer, primary_key=True, index=True)
    student_code = Column(String(20), unique=True, nullable=True, index=True)
    name = Column(String(100), nullable=False)
    email = Column(String(150), unique=True, nullable=False, index=True)
    roll_number = Column(String(50), unique=True, nullable=False, index=True)
    department = Column(String(100), nullable=True)
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

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    email = Column(String(150), unique=True, nullable=False, index=True)
    employee_id = Column(String(50), unique=True, nullable=False, index=True)
    department = Column(String(100), nullable=True)
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


class Attendance(Base):
    __tablename__ = "attendance"

    id = Column(Integer, primary_key=True, index=True)

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

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    code = Column(String(50), unique=True, nullable=False, index=True)
    department = Column(String(100), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Class(Base):
    __tablename__ = "classes"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    section = Column(String(50), nullable=True)
    department = Column(String(100), nullable=True)
    semester = Column(Integer, nullable=True)
    academic_year = Column(String(20), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class TeacherAssignment(Base):
    __tablename__ = "teacher_assignments"

    id = Column(Integer, primary_key=True, index=True)

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

    id = Column(Integer, primary_key=True, index=True)
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

    id = Column(Integer, primary_key=True, index=True)

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


class NotificationEvent(Base):
    """An account-scoped notification queued by a real application event."""

    __tablename__ = "notification_events"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_notification_events_idempotency_key"),
        Index("ix_notification_events_user_created", "user_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
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
