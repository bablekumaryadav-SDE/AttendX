# AttendX GIS + GPS Geofencing Implementation Report

**Updated:** 2026-11-04  
**Scope:** Approved phase-wise recovery and GIS/GPS implementation. All automated database tests used in-memory SQLite. The configured PostgreSQL database was not connected to, and no migration was applied.

## Summary

Restored the missing Leaflet classroom map component from the preserved D: WIP files, kept the recovered legacy `backend/app/schemas/attendance.py` byte-for-byte unchanged, and added GIS-aware request schemas in a separate module. QR routes, Student QR payloads, and the face attendance multipart form now carry GPS accuracy consistently. Classroom radius is inherited when a session request omits it. Admin classroom configuration and map selection, teacher classroom/session map display, and backend GPS coordinate/accuracy/distance checks are in place.

QR expiration/token validation, active session timing, class enrollment, teacher assignment, and duplicate attendance protections remain active. Automated isolated integration tests exercise successful and rejected QR+GPS submissions, including duplicate 409 behavior.

## Phase 1 — recovery blockers addressed

1. **Legacy schema preserved:** `backend/app/schemas/attendance.py` remains unchanged from the verified restore. Its workspace SHA-256 still matches the verified pre-GIS backup: `A7F40F7C7BF104463B99EEC6D72B76BF8106B1829DB20872164386C06DAA87FC`.
2. **GIS request schemas separated:** new `backend/app/schemas/attendance_gis.py` extends the legacy request models with `accuracy_m` (0–10,000 m) and makes session radius optional to distinguish omitted radius from an explicit value. It validates coordinate pairs and keeps coordinate bounds enforced by the inherited schema fields.
3. **Routes aligned:** session creation, teacher QR verification and student QR attendance use those GIS-aware request types. Student QR pages send latitude, longitude and `accuracy_m`; face attendance sends the same coordinates and accuracy as multipart fields.
4. **Radius fallback corrected:** omitted session radius now inherits the classroom radius. Class and session radii remain in metres, constrained to 10–5,000 m. Existing classes receive the additive SQL default of 100 m if the migration is later approved and applied.
5. **Map restored:** `LocationMap.jsx` and `.css` restored from `D:\Temp\AttendX-gis-work-in-progress`, then fixed so null coordinates mean “not configured” rather than `(0,0)`. Source and D: WIP hashes matched at restoration before this null-coordinate correction.
6. **Phase 1 validation:** the focused GIS + QR test run passed: **6 passed**, including tests of the legacy schema contract and class-radius fallback. An initial test attempt had two invalid short QR fixture tokens; the fixture strings were corrected before the passing run.

## Phase 2 — GIS/GPS behavior

- Admin class create/edit UI manages location name, latitude, longitude and geofence radius. Coordinates are range checked in the frontend, Pydantic schemas, SQLAlchemy model constraints, and the prepared SQL migration. The Leaflet map displays a classroom marker and radius boundary and lets an admin select coordinates by clicking the map.
- Leaflet uses OpenStreetMap tiles with required attribution and no API key. The map is informational; the backend calculates Haversine distance in metres and decides attendance.
- Teacher assignment data now includes the classroom GIS details. Teacher session creation preloads the selected class location and radius; the session page displays the active session location and boundary.
- Student QR flow gets a fresh browser GPS fix for sessions with configured coordinates and sends latitude, longitude and reported accuracy. The face attendance multipart request also sends those values when the session has a geofence.
- The server rejects missing coordinates/accuracy, non-finite or out-of-range coordinates, negative/non-finite accuracy, inaccurate fixes (accuracy must be no worse than the smaller of the fence radius and 100 m), and positions outside the session radius. Browser permission denied/unavailable errors remain user-visible.
- These checks validate the browser-reported fix and distance, but browser GPS is not cryptographically attested; a modified client or spoofed device location can still submit fabricated coordinates. No anti-spoofing guarantee is claimed.

## Changed files

### GIS implementation and tests in this work

- `backend/app/api/attendance_sessions.py`
- `backend/app/api/classes.py` (existing partial GIS endpoints retained)
- `backend/app/api/student_attendance.py`
- `backend/app/api/teacher_dashboard.py`
- `backend/app/models.py` (existing partial GIS fields/constraints retained)
- `backend/app/schemas/attendance_gis.py` (new; legacy attendance schema unchanged)
- `backend/app/schemas/class_.py` (existing partial GIS validation retained)
- `backend/app/schemas/teacher_dashboard.py`
- `backend/app/services/attendance_core.py`
- `backend/tests/test_admin_crud_isolated.py`
- `backend/tests/test_attendance_monitor_roster.py` (fixture now includes the classroom table required by the route's location join)
- `backend/tests/test_gis_geofence_isolated.py` (new)
- `backend/tests/test_qr_flow_isolated.py`
- `database/migrations/20261104_add_classroom_gis_location_postgresql.sql` (prepared only; not applied)
- `frontend/package.json`, `frontend/package-lock.json` (Leaflet 1.9.4 was already pinned in the partial work)
- `frontend/src/components/LocationMap.jsx`, `frontend/src/components/LocationMap.css` (restored; null coordinate handling corrected)
- `frontend/src/pages/auth/admin/Classes.jsx`, `frontend/src/pages/auth/admin/Classes.css`
- `frontend/src/pages/teacher/TeacherAttendance.jsx`, `frontend/src/pages/teacher/TeacherAttendance.css`
- `frontend/src/pages/student/StudentAttendance.jsx`, `frontend/src/pages/student/StudentDashboard.jsx`
- `frontend/src/services/attendance.js`
- `frontend/tests/gis-geofence.test.mjs` (new)

Existing face-registration modifications in `backend/app/api/students.py`, `backend/tests/test_face_api_isolated.py`, `frontend/src/pages/auth/admin/Students.jsx`, and `frontend/tests/camera-registration.test.mjs` were already present and were preserved; they are not GIS changes from this phase. Existing untracked files/backups were preserved.

Pre-edit copies for touched files are on D: under `D:\Temp\AttendX-gis-phase1-backup-20261104` and `D:\Temp\AttendX-gis-phase2-backup-20261104`. The original D: WIP source files remain untouched.

## Tests and validation

### Python syntax

Command (from `backend`):

```powershell
$env:PYTHONPYCACHEPREFIX='D:\Temp\AttendX-pycache'
..\.venv\Scripts\python.exe -m py_compile app\api\attendance_sessions.py app\api\classes.py app\api\student_attendance.py app\api\teacher_dashboard.py app\models.py app\schemas\attendance.py app\schemas\attendance_gis.py app\schemas\class_.py app\schemas\teacher_dashboard.py app\services\attendance_core.py tests\test_admin_crud_isolated.py tests\test_gis_geofence_isolated.py tests\test_qr_flow_isolated.py
```

**Result:** passed.

### Backend tests

Command (from `backend`):

```powershell
$env:DATABASE_URL='sqlite://'
$env:PYTHONPATH='D:\Temp\AttendX-pytest-packages'
$env:PYTHONDONTWRITEBYTECODE='1'
..\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider tests
```

**Result:** **40 passed, 19 warnings, 8 subtests passed** in 7.00 seconds. The test suite uses isolated `sqlite://` fixtures; the environment override also keeps the application-level fallback engine in-memory. Warnings are existing AnyIO/pytest, Starlette/httpx and SQLite datetime adapter deprecations.

Backend GIS/QR coverage includes coordinate/radius schema validation, accuracy and missing-location rejection, Haversine metre calculation, class GIS create/update and invalid coordinate rejection, teacher classroom GIS response, inherited classroom radius, outside-geofence rejection, low-accuracy rejection, accepted QR+GPS attendance, and duplicate 409 response.

A broader `pytest -q` from the `backend` directory also discovered the top-level PostgreSQL diagnostic `backend/test_db.py`. With the safe SQLite override it failed collection because that diagnostic executes PostgreSQL-only `current_database()`. No configured PostgreSQL connection occurred. The actual project test suite under `backend/tests/` passed as recorded above.

### Frontend tests

Command (from `frontend`):

```powershell
node --test tests/*.test.mjs
```

**Result:** **19 passed, 0 failed**.

GIS source-contract tests verify Leaflet circle/coordinate behavior, admin/teacher map wiring, accuracy field delivery for QR and face submissions, and visible permission/unavailable messages. They do not simulate a real browser, GPS hardware or map tile server.

### Production build

The first attempt included unsupported Vite `--cacheDir`; it exited before compilation. The corrected command was run from `frontend` with a verified-new D: output path:

```powershell
$env:TEMP='D:\Temp'
$env:TMP='D:\Temp'
$env:npm_config_cache='D:\Temp\npm-cache'
npm --cache 'D:\Temp\npm-cache' run build -- --outDir 'D:\Temp\AttendX-gis-build-20261104-phase3b'
```

**Result:** passed; Vite 7.3.7 transformed 1,931 modules and wrote output to D:. Existing `use client` directive warnings remain. Minified JS is about **803.5 kB**, above Vite's 500 kB advisory threshold (Leaflet and the current app bundle are included).

`git diff --check`: **passed**.

## Disk and database status

- Before build, C: had **5.15 GiB free**; after all checks/build, C: had **5.12 GiB free**. The 1.5 GiB stop threshold was not reached. No dependency install was run on C:.
- D: had approximately **246.19 GiB free** at final check. Backups, caches and build output were kept on D:.
- `backend/app/database.py` uses `DATABASE_URL` from the backend environment. Automated tests explicitly overrode it to in-memory SQLite. No production/development PostgreSQL connection was opened by these tests.
- `database/migrations/20261104_add_classroom_gis_location_postgresql.sql` is additive and prepared. It adds GIS columns/defaults/check constraints to `classes`; it adds no tables. **It has not been applied.** Existing database schema/migration state is still unknown and existing environments will not expose the new GIS columns until this migration is reviewed and approved for a separately backed-up target DB.

## Remaining limitations

- No real browser map interaction, external OSM tile loading, camera/device GPS permission flow, indoor GPS accuracy, or physical geofence boundary was tested. Automated frontend assertions are source-contract tests only.
- The map needs browser internet access for OpenStreetMap tiles. Tile-provider requests can reveal the viewed area to that provider; no API key is configured or required by this integration.
- Browser-provided coordinates and accuracy can be spoofed. Server-side Haversine validation is required for the attendance decision but is not device attestation.
- Migration application and live PostgreSQL schema verification remain pending explicit target/backup approval. No schema/data migration was applied.
- Face liveness remains separate and unimplemented; this GIS work makes no liveness claim.
