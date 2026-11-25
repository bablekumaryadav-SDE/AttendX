# AttendX Project Audit

**Audit date:** 2026-11-04  
**Repository:** `C:/Users/Asus/OneDrive/Desktop/MainProject/AttendX`  
**Branch:** `main` (tracking `team/main`)

## Scope and method

This is the initial code and environment audit requested before implementation. Source files, routes, models, migrations, frontend services and tests were inspected. Presence of code is not treated as proof of successful runtime operation. Hardware and live database workflows have not been demonstrated.

## Actual architecture

- **Frontend:** React 19, Vite 7, React Router 7, Axios, plain JavaScript/JSX. Source is under `frontend/src`.
- **Backend:** FastAPI, SQLAlchemy, Pydantic-style schemas and PostgreSQL driver (`psycopg2-binary`). API source is under `backend/app`.
- **Authentication:** JWT-based auth dependencies and an Axios request interceptor that sends the stored bearer token.
- **Face recognition:** OpenCV YuNet face detection and SFace embeddings using local ONNX model files in `backend/app/models/face`.
- **Attendance:** session-based `attendance_sessions` and `attendance_events`, with QR and face submission endpoints, class membership and teacher assignment checks, optional geofence validation, transaction handling, audit logging and a unique `(session_id, student_id)` database constraint in the additive migration.
- **Database configuration:** `backend/app/database.py` reads `DATABASE_URL` from `backend/.env`; the current secret/config values were not copied into this report.
- **Deployment:** No root Docker Compose/Nginx configuration was identified in the inspected root listing. A full deployment audit remains pending.

## Implemented (source inspection only; not runtime verified)

- Authentication, protected frontend routes, and separate Admin, Teacher and Student workspaces.
- Student, teacher, class, subject, assignment, attendance, analytics, dashboard, notification and related API routers.
- Admin student face registration API and student-owned face status/registration APIs.
- Student dashboard and attendance page offer QR and face attendance flows.
- Real YuNet/SFace embedding extraction; no mock matching found in the inspected face engine.
- Active-session, class-membership, active teacher assignment, registered face, session-time, optional location and duplicate attendance checks in student face attendance.
- QR token validation and optional geofence checks in QR attendance.
- Additive SQL migrations for session-based attendance and notification events are present.
- Existing backend test files and frontend Node test files are present.

## Partially implemented / not verified

- Face registration and verification are implemented in source, but no valid registered face round trip was executed.
- SFace comparison uses a configurable similarity threshold (`ATTENDX_FACE_THRESHOLD`, default `0.363`); project-specific false accept/reject calibration evidence was not found in this audit.
- Face endpoint accepts a camera frame but does not demonstrate liveness or anti-spoofing. A still image/video replay could therefore remain a risk.
- The attendance session unique constraint is in SQL migration source, but the configured database schema and migration state were not verified. Runtime safety depends on that migration being applied.
- Camera UI handles permission and capture paths in source; a real browser camera flow was not executed.
- QR and GIS logic are present in source; live session, location boundary and hardware/browser paths were not exercised.
- Database driver/configuration are present, but database connectivity and read-only schema status were not verified in the baseline due missing/incompatible local test tooling.
- Production build and tests are blocked in this environment by process-spawn restrictions (frontend) and missing/incompatible Python test dependencies.

## Not established by this audit

- Successful authenticated login for each role against the configured database.
- Successful Admin, Teacher and Student end-to-end browser workflows.
- Liveness/anti-spoofing effectiveness.
- Whether current database migrations have been applied and match source models.
- Verified database backup and restore.
- Production Docker/Nginx/HTTPS readiness.
- Mobile responsive visual behavior at actual viewport sizes.

## Bugs and risks found or requiring follow-up

1. **Baseline tooling is not runnable as currently invoked:** system Python lacks FastAPI/pytest; the repository-local Python environment(s) lack pytest; installed Starlette's TestClient requires missing `httpx2`.
2. **Frontend build/test processes fail to spawn:** Vite build and Node test runner fail with Windows `spawn EPERM`. This is an environment execution limitation; it does not establish source correctness or a code defect.
3. **Liveness is absent in inspected face matching flow:** face match alone is not proof of a live person. Document and test this before claiming protection against print/screen/replay attacks.
4. **Migration application is unverified:** the migration defines database duplicate protection, but schema state has not been inspected. Do not apply migrations to a production database without backup and approval.
5. **Biometric storage:** face registration stores the source image bytes and embedding in the database. Access controls, encryption-at-rest, retention and deletion handling need a full review.
6. **Untracked user files:** Git reports `tatus` and `tash list` as untracked. They were preserved and not opened or changed.

No definitive source-level root cause for the user's original face issue is established yet. The feature exists end-to-end in source; the remaining work is to run it in a suitable environment and inspect failures rather than assume the UI or API is missing.

## Prioritized development plan

1. Restore a runnable, project-compatible baseline test/build environment without changing user data or secrets.
2. Inspect and verify current database schema/migration state using safe read-only access; establish isolated test database before integration tests.
3. Exercise student authentication → face status → registration → live capture → session checks → unique attendance persistence, and isolate actual failures.
4. Review and document biometric privacy/security, threshold calibration, and liveness limitations; add only supportable measures.
5. Run QR, geofence, teacher/admin/student workflows and regression tests in a safe test environment.
6. Complete production configuration, backup/restore, deployment and acceptance documentation based on verified behavior.

## Files and areas inspected

`README.md`; `backend/requirements.txt`; `frontend/package.json`; `backend/app/main.py`; `backend/app/database.py`; `backend/app/config.py`; `backend/app/models.py`; `backend/app/api/face.py`; `backend/app/api/student_attendance.py`; `backend/app/services/face_engine.py`; frontend routes, API client, auth context, student dashboard and student attendance page; session attendance migrations; existing backend and frontend tests; `.gitignore`.

## Changes made

Only this audit document was created. Application source, database and untracked files were not modified.
