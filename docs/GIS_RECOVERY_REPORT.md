# AttendX GIS Recovery Report

**Date:** 2026-11-04  
**Scope:** Safe recovery and audit only. No GIS feature work resumed, no database was connected, and no migration was applied.

## Recovery and workspace preservation

- Restored `backend/app/schemas/attendance.py` from the pre-GIS backup at `D:\Temp\AttendX-gis-source-backup-20261104\backend\app\schemas\attendance.py`.
- Verified source size **4,899 bytes**, restored size **4,899 bytes**, SHA-256 **A7F40F7C7BF104463B99EEC6D72B76BF8106B1829DB20872164386C06DAA87FC** on both files. The backup was not overwritten or deleted.
- The target file was absent before recovery (Git showed it deleted); after recovery it contains the pre-GIS attendance schemas. This is a safe restoration, not a GIS schema update.
- Git status was checked. Tracked modifications preserved: `backend/app/api/attendance_sessions.py`, `backend/app/api/classes.py`, `backend/app/api/student_attendance.py`, `backend/app/api/students.py`, `backend/app/models.py`, `backend/app/schemas/class_.py`, `backend/app/services/attendance_core.py`, `backend/tests/test_face_api_isolated.py`, `frontend/package-lock.json`, `frontend/package.json`, `frontend/src/pages/auth/admin/Classes.css`, `frontend/src/pages/auth/admin/Classes.jsx`, `frontend/src/pages/auth/admin/Students.jsx`, `frontend/tests/camera-registration.test.mjs`. Untracked `docs/`, `tash list`, and `tatus` were preserved. The modified student/face files and their tests predate the GIS recovery scope; they were not reverted.
- D: pre-GIS source backup folder contains 19 project copies. Integrity hashes were computed during inspection. The attendance schema is the verified restoration source. D: GIS WIP files remain preserved: `20261104_add_classroom_gis_location_postgresql.sql` (1,224 bytes), `LocationMap.jsx` (3,163 bytes), `LocationMap.css` (303 bytes). No backup/WIP files were deleted or modified.

## Disk-space status

- D: free space observed via filesystem statistics: **264,353,689,600 bytes (~246.2 GiB)**.
- C: free space observed via filesystem statistics: **412,119,040 bytes (~0.38 GiB)**. PowerShell `Get-PSDrive` inside the restricted shell incorrectly reported 0 for both drives; filesystem statistics were used instead.
- No C: copy, dependency install, or frontend build was attempted during this recovery. Frontend build remains deferred because C: is still critically low and the existing Vite build was previously shown to require D: redirection/out-of-sandbox execution.

## Partial GIS changes audit

### Changes present in workspace

- `backend/app/models.py`: adds `Class.location_name`, latitude/longitude and radius columns plus coordinate/radius check constraints.
- `backend/app/schemas/class_.py`: adds GIS fields and range/pair validation.
- `backend/app/api/classes.py`: maps GIS fields during class create/update and checks paired coordinates.
- `backend/app/services/attendance_core.py`: adds GPS accuracy requirement helper; distance uses existing Haversine helper.
- `backend/app/api/attendance_sessions.py` and `backend/app/api/student_attendance.py`: class location fallback/session location response and server-side distance/geofence checks.
- `frontend/src/pages/auth/admin/Classes.jsx` and `Classes.css`: add location fields and map interaction to the admin class form.
- `frontend/package.json` and lockfile: add pinned `leaflet@1.9.4`. The current `frontend/node_modules/leaflet` is a junction to `D:\Temp\AttendX-gis-runtime\node_modules\leaflet`, so the current local install depends on D:.
- SQL migration and map component source were moved out of the workspace and are preserved in the D: WIP folder. No GIS migration appears in the project tree and none was applied.

### Incomplete or inconsistent

1. **Broken frontend import:** `Classes.jsx` imports `../../../components/LocationMap`, but `frontend/src/components/LocationMap.jsx` and its stylesheet are absent from the workspace. They exist only in the D: WIP folder. Frontend build was not run; this missing module is a source-level blocker.
2. **Attendance schema mismatch:** the restored pre-GIS `backend/app/schemas/attendance.py` has no `accuracy_m` field in `StudentQrAttendanceRequest` or `QRVerifyRequest`. Both QR attendance route paths now access `body.accuracy_m` when session coordinates are configured. That can raise `AttributeError` for geofenced submissions. Frontend student QR payloads currently send latitude/longitude but not accuracy. This restoration intentionally retained the verified pre-GIS schema; reconciling the contract requires reviewed GIS work.
3. **Session radius fallback mismatch:** restored `AttendanceSessionCreate.radius_m` defaults to `100` and is non-optional. The new route uses the class radius only when request `radius_m` is `None`; under this schema the class's configured radius will normally be shadowed by 100 unless explicitly sent. This creates model/schema/route behavior inconsistency.
4. **Database migration gap:** SQLAlchemy model and route queries expect `classes.location_name`, `latitude`, `longitude`, `radius_m`; the additive GIS SQL is only on D:. Without a reviewed migration applied to a target DB, existing DB schemas will not contain these fields. Migration state was not inspected against any DB because the configured database was not connected. No reset or migration was run.
5. **Teacher/student GIS experience is partial:** existing teacher session form already supports session coordinates/radius, and student attendance UI shows session geofence data. No GIS map component is available in the workspace, so map visualization cannot be verified. Browser/GPS behavior, location permission errors, accuracy behavior, and real map tiles were not tested.
6. **Location safety logic is source-only:** Haversine distance and an accuracy gate are present, but route behavior is not integration-tested in this recovery. No claim is made that the GIS attendance path works end to end.
7. **Dependency/runtime state:** Leaflet is pinned in package manifests, but the active node_modules junction points to a temporary D: runtime location; a clean install/build in the recovered workspace was not validated.

No accidental truncation or zero-byte damage was observed in the inspected workspace files after the schema restoration. The known deleted schema is restored. The three GIS WIP files are preserved on D: as above.

## Validation

- **Python syntax:** passed. Command run from `backend`:

  ```powershell
  $env:PYTHONPYCACHEPREFIX='D:\Temp\AttendX-pycache'
  ..\.venv\Scripts\python.exe -m py_compile app\api\attendance_sessions.py app\api\classes.py app\api\student_attendance.py app\api\students.py app\models.py app\schemas\attendance.py app\schemas\class_.py app\services\attendance_core.py tests\test_face_api_isolated.py
  ```

- **Backend pytest:** not run. The combined elevated command was rejected by automatic approval review because it invoked the full pytest suite without explicitly configuring a separate test database, creating a risk of touching the configured database. I did not retry or route around that rejection. Existing `docs/TEST_RESULTS.md` records prior isolated-suite results, but those are not a fresh validation of this partial GIS state.
- **Frontend tests/build:** not run. Build was explicitly deferred due low C: space; missing `LocationMap` source already establishes a build blocker.
- **Production/development DB connectivity, data, and migrations:** not accessed. No migration applied.

## Remaining work (requires approval before GIS resumes)

- Reconcile `accuracy_m` and `radius_m` request/route contracts while preserving QR compatibility.
- Restore/review the D: `LocationMap` component and stylesheet and confirm the dependency installation strategy does not rely on a temporary junction.
- Review the D: SQL migration against the existing PostgreSQL schema and use a separate test database after explicit database isolation is established. Do not apply it to any shared/production DB without approval.
- Run isolated backend GIS/API tests and frontend tests/build only in the correct environment with generated output/cache on D:.
- Exercise actual browser map selection and GPS permission/accuracy paths. These remain unverified.

**GIS implementation remains paused. No new feature work should resume until the user approves the recovery findings and next steps.**
