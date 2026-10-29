from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    auth,
    students,
    teachers,
    attendance,
    subjects,
    classes,
    assignments,
    attendance_records,
    dashboard,
    admin_dashboard,
    teacher_dashboard,
)

from app.api.attendance_sessions import (
    router as attendance_sessions_router,
)

from app.api.analytics import (
    router as analytics_router,
)

from app.api.notifications import (
    router as notifications_router,
)

from app.api.student_attendance import (
    router as student_attendance_router,
)


app = FastAPI(
    title="AttendX API",
    version="0.80.0",
    description=(
        "AttendX smart attendance platform "
        "with verified QR and geo-fence attendance."
    ),
)


# ============================================================
# CORS
# ============================================================

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:5176",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5175",
    "http://127.0.0.1:5176",
]


app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=(
        r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


# ============================================================
# Authentication
# ============================================================

app.include_router(
    auth.router,
    prefix="/auth",
    tags=["Authentication"],
)


# ============================================================
# Students
# ============================================================

app.include_router(
    students.router,
    prefix="/students",
    tags=["Students"],
)


# ============================================================
# Teachers
# ============================================================

app.include_router(
    teachers.router,
    prefix="/teachers",
    tags=["Teachers"],
)


# ============================================================
# Legacy attendance CRUD
# ============================================================

app.include_router(
    attendance.router,
    prefix="/attendance",
    tags=["Attendance"],
)


# ============================================================
# Academic
# ============================================================

app.include_router(
    subjects.router,
    prefix="/subjects",
    tags=["Subjects"],
)

app.include_router(
    classes.router,
    prefix="/classes",
    tags=["Classes"],
)

app.include_router(
    assignments.router,
    prefix="/assignments",
    tags=["Teacher Assignments"],
)


# ============================================================
# Attendance records
# ============================================================

app.include_router(
    attendance_records.router,
    prefix="/attendance-records",
    tags=["Attendance Records"],
)


# ============================================================
# Dashboards
# ============================================================

app.include_router(
    dashboard.router,
    prefix="/dashboard",
    tags=["Dashboard"],
)

app.include_router(
    admin_dashboard.router,
    prefix="/admin-dashboard",
    tags=["Admin Dashboard"],
)

app.include_router(
    teacher_dashboard.router,
    prefix="/teacher-dashboard",
    tags=["Teacher Dashboard"],
)


# ============================================================
# Attendance sessions
# ============================================================

app.include_router(
    attendance_sessions_router,
)


# ============================================================
# Analytics
# ============================================================

app.include_router(
    analytics_router,
)


# ============================================================
# Notifications
# ============================================================

app.include_router(
    notifications_router,
)


# ============================================================
# Student verified attendance
# ============================================================

app.include_router(
    student_attendance_router,
)


# ============================================================
# Health
# ============================================================

@app.get("/")
def root():
    return {
        "status": "AttendX API is Running",
        "version": "0.80.0",
    }


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "service": "AttendX API",
        "version": "0.80.0",
    }