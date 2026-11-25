from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import (
    ALLOWED_CORS_HEADERS,
    ALLOWED_CORS_METHODS,
    CORS_ALLOW_CREDENTIALS,
    get_allowed_origins,
)

from app.api.auth import router as auth_router
from app.api.students import router as students_router
from app.api.tenant_students import router as tenant_students_router
from app.api.guardians import router as guardians_router
from app.api.teachers import router as teachers_router
from app.api.attendance import router as attendance_router
from app.api.attendance_sessions import (
    router as attendance_sessions_router,
)
from app.api.subjects import router as subjects_router
from app.api.tenant_subjects import router as tenant_subjects_router
from app.api.tenant_classes import router as tenant_classes_router
from app.api.tenant_teachers import router as tenant_teachers_router
from app.api.tenant_memberships import router as tenant_memberships_router
from app.api.classes import router as classes_router
from app.api.assignments import router as assignments_router
from app.api.attendance_records import (
    router as attendance_records_router,
)
from app.api.tenant_attendance import (
    attendance_router as tenant_attendance_router,
    attendance_records_router as tenant_attendance_records_router,
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
from app.api.face import router as face_router
from app.api.tenant_face import router as tenant_face_router
from app.api.tenant_pilot import router as tenant_pilot_router
from app.api.tenant_dashboard import router as tenant_dashboard_router
from app.api.college_registration import (
    platform_router as college_application_platform_router,
    public_router as college_registration_router,
)
from app.api.platform_colleges import router as platform_colleges_router
from app.api.account_activation import router as account_activation_router
from app.tenant_api_gate import block_unscoped_legacy_business_api


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

ALLOWED_ORIGINS = get_allowed_origins()

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=CORS_ALLOW_CREDENTIALS,
    allow_methods=list(ALLOWED_CORS_METHODS),
    allow_headers=list(ALLOWED_CORS_HEADERS),
)


# ============================================================
# ROUTERS
# ============================================================

# Legacy business schemas/queries do not carry College ownership yet. Fail
# closed at the router boundary so no legacy global query can serve data while
# tenant isolation is incomplete. The auth and tenant-pilot routers are
# intentionally mounted outside this gate.
legacy_business_dependencies = [Depends(block_unscoped_legacy_business_api)]

app.include_router(
    auth_router,
    prefix="/auth",
    tags=["Authentication"],
)

# Explicitly reviewed read-only tenant Student routes precede the legacy
# Student router. All other methods and nested routes remain fail-closed.
app.include_router(
    tenant_students_router,
    prefix="/students",
    tags=["Tenant Students"],
)

# Face enrollment uses explicit College membership routes. The older global
# face and student-attendance routers below remain protected by default-deny.
app.include_router(tenant_face_router)

app.include_router(
    students_router,
    prefix="/students",
    tags=["Students"],
    dependencies=legacy_business_dependencies,
    include_in_schema=False,
)

# Guardian contacts are one-to-one with an existing student and use the
# student_guardians table. Keep their established URLs under /students.
app.include_router(
    guardians_router,
    prefix="/students",
    tags=["Student Guardian Contacts"],
    dependencies=legacy_business_dependencies,
    include_in_schema=False,
)

# Explicitly reviewed tenant Teacher routes precede the legacy Teacher router.
# Unreviewed methods and legacy handlers remain behind the default-deny gate.
app.include_router(
    tenant_teachers_router,
    prefix="/teachers",
    tags=["Tenant Teachers"],
)

app.include_router(
    teachers_router,
    prefix="/teachers",
    tags=["Teachers"],
    dependencies=legacy_business_dependencies,
    include_in_schema=False,
)

# Register the more specific session routes before the legacy
# /attendance/{attendance_id} route so "sessions" is not parsed as an ID.
app.include_router(
    attendance_sessions_router,
    dependencies=legacy_business_dependencies,
    include_in_schema=False,
)

# Explicitly reviewed read-only tenant attendance routes. Legacy writes and
# unreviewed session/nested routes remain behind the default-deny gate.
app.include_router(tenant_attendance_router, prefix="/attendance", tags=["Tenant Attendance"])

app.include_router(
    attendance_router,
    prefix="/attendance",
    tags=["Attendance"],
    dependencies=legacy_business_dependencies,
    include_in_schema=False,
)

app.include_router(student_attendance_router, dependencies=legacy_business_dependencies, include_in_schema=False)
app.include_router(face_router, dependencies=legacy_business_dependencies, include_in_schema=False)
# Explicit tenant Subject routes are registered first. Their reads are
# membership-scoped and College Admin writes are scoped, server-owned, and
# deactivate records instead of deleting history. Legacy paths remain gated.
app.include_router(
    tenant_attendance_records_router,
    prefix="/attendance-records",
    tags=["Tenant Attendance Records"],
)
app.include_router(
    tenant_subjects_router,
    prefix="/subjects",
    tags=["Tenant Subjects"],
)
app.include_router(
    subjects_router,
    prefix="/subjects",
    tags=["Subjects"],
    dependencies=legacy_business_dependencies,
    include_in_schema=False,
)

app.include_router(
    tenant_classes_router,
    prefix="/classes",
    tags=["Tenant Classes"],
)
app.include_router(
    classes_router,
    prefix="/classes",
    tags=["Classes"],
    dependencies=legacy_business_dependencies,
    include_in_schema=False,
)

app.include_router(
    assignments_router,
    prefix="/assignments",
    tags=["Assignments"],
    dependencies=legacy_business_dependencies,
    include_in_schema=False,
)

app.include_router(
    attendance_records_router,
    prefix="/attendance-records",
    tags=["Attendance Records"],
    dependencies=legacy_business_dependencies,
    include_in_schema=False,
)

app.include_router(
    dashboard_router,
    tags=["Dashboard"],
    dependencies=legacy_business_dependencies,
    include_in_schema=False,
)

app.include_router(
    admin_dashboard_router,
    prefix="/admin-dashboard",
    tags=["Admin Dashboard"],
    dependencies=legacy_business_dependencies,
    include_in_schema=False,
)

app.include_router(
    teacher_dashboard_router,
    prefix="/teacher-dashboard",
    tags=["Teacher Dashboard"],
    dependencies=legacy_business_dependencies,
    include_in_schema=False,
)

app.include_router(analytics_router, dependencies=legacy_business_dependencies, include_in_schema=False)
app.include_router(notifications_router, dependencies=legacy_business_dependencies, include_in_schema=False)
app.include_router(tenant_pilot_router)
app.include_router(tenant_memberships_router)
app.include_router(tenant_dashboard_router)
app.include_router(college_registration_router)
app.include_router(college_application_platform_router)
app.include_router(platform_colleges_router)
app.include_router(account_activation_router, prefix="/account-activation", tags=["Account Activation"])


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
