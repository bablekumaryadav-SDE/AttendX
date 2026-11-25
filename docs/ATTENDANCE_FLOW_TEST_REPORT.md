# AttendX Attendance Flow Verification Report

**Date:** 2026-11-04  
**Scope:** Read-only audit plus API/database verification against isolated SQLite test databases. No application or configured database changes.

## Database safety and configuration

- `backend/app/database.py` loads `DATABASE_URL` from `backend/.env`. A redacted parse confirmed the configured scheme is `postgresql+psycopg2`; host, database name, username and password were not emitted or copied here.
- The configured PostgreSQL database was **not connected to**. No development/production data was read or changed.
- Tests used separate in-memory SQLite databases (`sqlite://`, SQLAlchemy `StaticPool`) and disposable fixture rows. A one-off integration run created a new in-memory database, installed FastAPI's dependency override for that engine, then disposed it. Test records existed only inside those test engines.
- `backend/attendx.db` was not opened. No migration, reset, schema change, or database write was made outside the isolated test engines.

## End-to-end API flow verified

The one-off integration run used real `/auth/login` credentials and JWT bearer tokens for Admin, Teacher and Student. It used the real API routes and persisted into isolated SQLite:

1. Admin login succeeded; `GET /auth/me` confirmed the session.
2. Admin created a class and subject.
3. Admin created a teacher and student, then enrolled the student into the class.
4. Admin assigned the teacher to the class and subject.
5. Teacher login succeeded and the teacher created an active attendance session for the assigned class/subject.
6. Teacher requested the session QR. The API generated its signed token.
7. Student login succeeded; the student saw the eligible active session.
8. Student submitted the QR token. API returned **200**, and querying the isolated DB returned exactly one `(student_id, 'qr', 'present')` attendance event.
9. Student submitted the same token a second time. API returned **409 Conflict**; the DB still had exactly one event for that student/session.

The test fixture used the same unique `(session_id, student_id)` rule represented by the PostgreSQL migration. The SQL schema was manually declared in the isolated SQLite test DB to match the route's expected tables; this did not apply a project migration.

## Face registration and recognition

| Check | Result | Evidence / limit |
|---|---|---|
| YuNet/SFace local model loading | **Passed** | OpenCV 5.0.0 loaded the configured YuNet detector and SFace recognizer from the repository's ONNX files. OpenCV emitted target/backend warnings. |
| Real face registration endpoint with blank PNG | **Passed: safely rejected** | Actual image encoder and recognition pipeline were called. `POST /face/me/register` returned **422 `No face detected`**; database contained zero `face_embeddings`; `/face/me/status` remained `not_registered`. |
| Corrupt image handling | **Passed** | Existing isolated API test posts invalid image bytes; endpoint returns 422 and does not create a registration row. |
| Positive registration and live face match | **Not verified / blocked** | No genuine, consented face image or camera capture is available in the project workspace. Repository image search found no JPEG/PNG/WEBP/BMP sample. I did not substitute a synthetic embedding or mock a match. |
| Face attendance persistence | **Not verified** | Depends on a valid registered face and a genuine probe frame. The positive recognition-to-attendance path was not exercised. |
| Liveness / anti-spoofing | **Not implemented / not verified** | No liveness check was found in the inspected registration or face attendance path. Face matching must not be described as liveness protection. |

The existing positive admin face-registration test uses a patched embedding function and a fixture vector; it is a route/storage unit test only. It is **not** counted as real biometric registration or matching evidence.

## QR and duplicate attendance verification

- Existing QR integration test covers teacher session creation, QR retrieval/refresh, rejection of invalid, expired and cross-session tokens, student acceptance, attendance history, live roster, session close and persisted attendance rows.
- The one-off complete API sequence independently verified the admin-created class/subject/teacher/student/enrollment/assignment path through QR attendance insertion.
- Duplicate submission returned **409** and preserved one row. The DB fixture's unique constraint provides a second guard; a concurrent race test was not performed.
- QR validation uses the real token generation/signature validation code. Audit-log and SQLite datetime adapters were patched in the existing fixture only to avoid unrelated database dialect behavior; signing, routing and attendance persistence were not mocked.

## Migration files and test migration state

Inspected migration files:

- `database/migrations/20261101_add_session_face_attendance.sql`: PostgreSQL DDL for student class assignment, attendance session/event/audit tables and unique `(session_id, student_id)` attendance constraint. **Inspected only; not applied.**
- `database/migrations/20261101_allow_session_close_method.sql`: alters the attendance method check constraint to allow `session_close`. **Inspected only; not applied.**
- `database/migrations/20261103_add_notification_events_postgresql.sql`: additive notification table/index DDL. **Inspected only; not applied.**
- `database/migrations/20261103_add_notification_events_sqlite.sql`: SQLite notification table/index DDL. Existing isolated test applies this script to an in-memory SQLite test DB and checks repeatability/idempotency behavior; it is discarded at test teardown and does not change the configured DB.

No Alembic setup or migration-version table was found in the inspected backend/database tree. Consequently, the configured PostgreSQL migration state remains **unknown**. In the one-off attendance test DB, the session/event tables were manually created for the fixture and no project migration was applied. No migration was run without approval.

## Regression test results

Command (from `backend`, using the existing root `.venv` interpreter and temporary D: pytest overlay):

```powershell
$env:PYTHONPATH = 'D:\Temp\AttendX-pytest-packages'
$env:PYTHONDONTWRITEBYTECODE = '1'
..\.venv\Scripts\python.exe -m pytest -q
```

**Result:** `28 passed, 16 warnings, 4 subtests passed` in 5.06 seconds. Warnings were the Starlette legacy-httpx fallback, AnyIO/pytest deprecation, and Python SQLite date/datetime adapter deprecations. This full suite uses isolated fixtures; it did not use the configured PostgreSQL database.

Other observed checks during this verification:

- QR end-to-end one-off API scenario: **passed** (real JWT logins, API create/assign/session/QR/mark routes, DB persistence, duplicate 409).
- Blank-image face API scenario: **passed as rejection** (422, zero registration rows).
- YuNet/SFace model loading: **passed**; genuine face detection/matching: **not verified**.
- Initial ad-hoc run using `@test.invalid` fixture addresses: **failed at request validation with 422** because Pydantic rejects reserved `.invalid` email domains. Re-running with `@example.org` fixture addresses passed. This was a test-data issue, not an application fix.
- Existing `test_face_api_isolated` positive persistence case patches embedding extraction; it is not evidence of real face matching.

## Failures, root causes, and fixes

- **No application workflow failure confirmed** in the tested QR flow. No code fix was made.
- The first ad-hoc test attempt used reserved `.invalid` emails, which failed email validation. Fixture addresses were changed to `.org` and the unchanged application workflow passed.
- Positive face match cannot be verified without an actual consented test capture/image. No sample was fabricated and no mocked positive match was accepted as proof.
- PostgreSQL production/development migration state cannot be known without connecting to that database. It was deliberately left untouched.

## Git and file changes

- Git status before the run: branch `main...team/main`; only the already untracked `docs/` directory and pre-existing `tatus`, `tash list` were present.
- No source file or migration was changed, so no source backup was needed. No cleanup or destructive Git operation was used.
- This report is the only file created for this verification phase.

## Remaining work / blockers

1. Obtain a genuine, consented face registration capture and a separate probe capture, then verify the real register → match → session validation → face attendance persistence flow in an isolated DB.
2. Test face-mismatch and multiple-face cases with real images, and calibrate/document the SFace threshold.
3. Decide and implement a liveness approach only after a feasible model/hardware/test plan is available; currently anti-spoofing remains absent.
4. Inspect PostgreSQL schema/migration state using a separately approved test/staging database, not the configured live DB. No migration should be applied until its target and backup are verified.
5. Add/execute a concurrency test proving the database unique constraint arbitrates simultaneous duplicate attendance submissions.

No larger implementation change is proposed or performed in this report. The positive face workflow and migration rollout should be planned before any feature changes.
