from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.students import router as students_router
from app.api.teachers import router as teachers_router
from app.api.attendance import router as attendance_router
from app.api.attendance_sessions import (
    router as attendance_sessions_router,
)
from app.api.subjects import router as subjects_router
from app.api.classes import router as classes_router
from app.api.assignments import router as assignments_router
from app.api.attendance_records import (
    router as attendance_records_router,
)
from app.api.dashboard import router as dashboard_router
from app.api.admin_dashboard import (
    router as admin_dashboard_router,
)
from app.api.teacher_dashboard import (
    router as teacher_dashboard_router,
)
from app.api.analytics import router as analytics_router
from app.api.notifications import router as notifications_router
from app.api.student_attendance import (
    router as student_attendance_router,
)


# ============================================================
# APPLICATION
# ============================================================

app = FastAPI(
    title="AttendX API",
    version="0.80.0",
    description="AttendX Smart Attendance Management API",
)


# ============================================================
# CORS CONFIGURATION
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
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# ROUTERS
# ============================================================

app.include_router(
    auth_router,
    prefix="/auth",
    tags=["Authentication"],
)

app.include_router(
    students_router,
    prefix="/students",
    tags=["Students"],
)

app.include_router(
    teachers_router,
    prefix="/teachers",
    tags=["Teachers"],
)

app.include_router(
    attendance_router,
    prefix="/attendance",
    tags=["Attendance"],
)

app.include_router(attendance_sessions_router)
app.include_router(student_attendance_router)
app.include_router(
    subjects_router,
    prefix="/subjects",
    tags=["Subjects"],
)

app.include_router(
    classes_router,
    prefix="/classes",
    tags=["Classes"],
)

app.include_router(
    assignments_router,
    prefix="/assignments",
    tags=["Assignments"],
)

app.include_router(
    attendance_records_router,
    prefix="/attendance-records",
    tags=["Attendance Records"],
)

app.include_router(
    dashboard_router,
    prefix="/dashboard",
    tags=["Dashboard"],
)

app.include_router(
    admin_dashboard_router,
    prefix="/admin-dashboard",
    tags=["Admin Dashboard"],
)

app.include_router(
    teacher_dashboard_router,
    prefix="/teacher-dashboard",
    tags=["Teacher Dashboard"],
)

app.include_router(analytics_router)
app.include_router(notifications_router)


# ============================================================
# ROOT ENDPOINT
# ============================================================

@app.get("/")
def read_root():
    return {
        "status": "AttendX API is Running",
        "version": "0.80.0",
    }


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "AttendX API",
        "version": "0.80.0",
    }
