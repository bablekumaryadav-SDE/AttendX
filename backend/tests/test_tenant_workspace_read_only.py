from types import SimpleNamespace

from sqlalchemy.dialects import sqlite

from app.api import tenant_workspace
from app import models
from app.models import NotificationEvent, Student, StudentGuardian


class QueryStub:
    def __init__(self, rows=(), total=None):
        self.rows = list(rows)
        self.total = len(self.rows) if total is None else total
        self.filters = []

    def join(self, *args, **kwargs):
        return self

    def filter(self, *conditions):
        self.filters.extend(conditions)
        return self

    def count(self):
        return self.total

    def order_by(self, *args, **kwargs):
        return self

    def offset(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def all(self):
        return self.rows


class ReadOnlyDB:
    def __init__(self, query):
        self._query = query
        self.rollback_count = 0

    def query(self, *entities):
        return self._query

    def rollback(self):
        self.rollback_count += 1


def _compiled_predicates(query):
    return [str(predicate.compile(dialect=sqlite.dialect())) for predicate in query.filters]


def test_guardian_directory_requires_admin_context_and_filters_by_context_college(monkeypatch):
    guardian = SimpleNamespace(
        guardian_name="Synthetic Guardian", father_name=None, mother_name=None,
        guardian_relationship="Guardian", guardian_mobile="5550100",
        alternate_mobile=None, parent_email="guardian@example.invalid",
    )
    student = SimpleNamespace(id=7, name="Synthetic Student", roll_number="R-7", is_active=True)
    query = QueryStub([(guardian, student)], total=1)
    db = ReadOnlyDB(query)
    context_calls = []

    def context(*args, **kwargs):
        context_calls.append(kwargs)
        return SimpleNamespace(college_id=42)

    monkeypatch.setattr(tenant_workspace, "resolve_tenant_context", context)
    result = tenant_workspace.list_tenant_guardians(77, "Synthetic", None, 1, 20, db, {"id": 8})

    assert result.total == 1
    assert result.items[0].student_id == 7
    assert result.items[0].guardian_name == "Synthetic Guardian"
    assert context_calls[0]["allowed_roles"] == frozenset({"college_admin"})
    assert context_calls[0]["requested_college_id"] == 77
    # Even if an untrusted selector is supplied, the query uses only the resolved context.
    assert "students.college_id = ?" in _compiled_predicates(query)
    assert all("student_guardians" not in predicate or "college_id" not in predicate for predicate in _compiled_predicates(query))


def test_notification_event_history_filters_by_context_college_and_exposes_record_not_delivery_claim(monkeypatch):
    event = SimpleNamespace(
        id=3, student_id=7, user_id=8, event_type="attendance_notice", channel="email",
        recipient="guardian@example.invalid", title="Synthetic event", message="Synthetic body",
        delivery_status="queued", read_at=None, created_at=__import__("datetime").datetime(2026, 1, 1),
        sent_at=None,
    )
    query = QueryStub([event], total=1)
    db = ReadOnlyDB(query)
    monkeypatch.setattr(tenant_workspace, "resolve_tenant_context", lambda *a, **k: SimpleNamespace(college_id=42))

    result = tenant_workspace.list_tenant_notification_events(42, None, None, 1, 20, db, {"id": 8})

    assert result.items[0].record_status == "queued"
    assert result.items[0].read_at is None
    assert "notification_events.college_id = ?" in _compiled_predicates(query)
    assert not hasattr(db, "add")
    assert not hasattr(db, "commit")


def test_coursework_models_are_removed_without_removing_academic_mappings():
    assert StudentGuardian.__tablename__ == "student_guardians"
    assert NotificationEvent.__tablename__ == "notification_events"
    assert Student.__tablename__ == "students"
    assert hasattr(models, "TeacherAssignment")
    assert hasattr(models, "StudentClassAssignment")
    assert not hasattr(models, "CourseworkAssignment")
    assert not hasattr(models, "CourseworkSubmission")
    assert not hasattr(models, "CourseworkSubmissionRevision")
    assert not hasattr(models, "Submission")
    assert not hasattr(tenant_workspace, "TeacherAssignment")
