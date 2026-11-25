# AttendX Phase 6 Browser E2E Test Report

**Date:** 2026-11-04  
**Scope:** Browser-based role workflow verification and regression checks. Tests used a dedicated SQLite database on D:. No live PostgreSQL connection, production database write, or migration was performed.

## Environment and safety

- Chrome 142 headless was used as a real browser with an isolated browser profile and DevTools Protocol. Backend and Vite were bound to `127.0.0.1` only.
- The test database was `D:\Temp\AttendX-browser-e2e-phase6-bb31239fcf5d47859f2a8c0211ab592e.sqlite3`. Its tables were created for this test; the project migration was not run. Browser-created test users, class, subject, assignment, session and test credentials were stored only there.
- The API server received `DATABASE_URL=sqlite:///D:/Temp/AttendX-browser-e2e-phase6-bb31239fcf5d47859f2a8c0211ab592e.sqlite3`; Python regression tests used `DATABASE_URL=sqlite://` (in-memory SQLite).
- C: free space was **5,383,401,472 bytes** before the production build and **5,376,851,968 bytes** afterward. Build output and npm cache were redirected to D:. This stayed above the 1.5 GiB stop threshold.
- The prepared PostgreSQL migration `database/migrations/20261104_add_classroom_gis_location_postgresql.sql` was inspected. It adds optional class GIS fields and constraints. It was **not applied**. Live PostgreSQL migration state remains **unknown**.
- Existing Git modifications, untracked files and backup folders were preserved. This phase added only the report and the narrow fixes listed below.

## Workflow results

| Workflow | Status | Evidence / limit |
|---|---|---|
| Admin login and role dashboard | **PASS** | Browser login and `/auth/me` returned 200; admin workspace rendered. |
| Admin create/manage student | **PARTIAL** | Student creation returned 201 and enrollment/class assignment returned 200. The UI then called nonexistent `PUT /students/{id}/guardian`, which returned 404 and displayed “Student details saved. Not Found”. Backend has no guardian route/model. This needs a separately reviewed persistence/API design; not added in this phase. |
| Admin create/manage teacher | **PASS** | Teacher create returned 201 and rendered in the admin UI. Teacher edit was not exercised. |
| Admin create/edit classroom GIS | **PASS** | Browser created class (201), edited its radius (PUT 200), and reloaded saved coordinates/name/radius. Leaflet marker, radius circle and OpenStreetMap tiles rendered. |
| Admin subject and teacher assignment | **PASS** | Subject and assignment creation each returned 201; teacher and class assignment displayed. |
| Teacher login and assignment visibility | **PASS** | Teacher login and `/auth/me` returned 200; assigned class and subject appeared. |
| Teacher attendance session creation | **PASS** | Session create returned 201; session became active, roster loaded, and teacher map showed the 175 m classroom boundary. |
| QR generation / refresh / expiry | **PARTIAL** | QR refresh returned 200 and the browser displayed a signed `AXQR...` token with a roughly 60-second lifetime. Initial QR retrieval exposed a backend 500 (root cause and fix below). A fresh physical QR scan was not tested; expiry rejection was covered only by automated tests. |
| Teacher live monitor | **PASS** | `/attendance/sessions/1/live` returned 200 repeatedly; test student appeared as pending. |
| Student login/dashboard/history | **PASS** | Browser login and student dashboard/active-sessions/attendance-history requests returned 200. The student was enrolled and saw the active session and empty history. |
| Student QR camera scan / QR + GPS submission | **NOT TESTED** | No physical camera/QR scan was available. Browser UI exposed the manual QR token field, but a complete accepted student submission was not completed. |
| GPS denied permission behavior | **PASS** | Chrome browser permission denial produced the visible message “Location permission was denied.” |
| GPS granted/accurate fix, outside fence and inaccurate fix | **NOT TESTED** | Chrome DevTools geolocation emulation was attempted but did not yield a usable location in the UI. Automated GIS tests cover server-side range, accuracy and fence decisions; that is not hardware/browser GPS evidence. |
| Face registration / matching | **NOT TESTED** | No genuine consented face sample was available. No camera capture or biometric registration was performed. No liveness detection claim is made. |
| Duplicate / concurrent attendance | **PARTIAL** | Existing backend QR tests verify duplicate rejection. Concurrent browser submissions were not attempted because a full student QR submission was not completed. |
| Role authorization | **PASS** | A student-authenticated browser request to admin-only `GET /students/` returned 403 “Administrator access required.” |
| PostgreSQL migration state | **NOT TESTED** | No live PostgreSQL connection was made; state remains unknown. |
| Physical browser camera/GPS/hardware | **NOT TESTED** | Headless Chrome is a real browser, but no physical camera or GPS device was available. |

## Root causes and narrow fixes

1. **Class admin screen previously failed to render:** `LocationMap.jsx` used JSX without importing the React binding required by the project's JSX transform. Browser console showed `ReferenceError: React is not defined`. A copy of the pre-edit file was saved to `D:\Temp\AttendX-phase6-source-backup\frontend\src\components\LocationMap.jsx`; the component now imports `React` alongside its hooks. The class management screen and map then rendered successfully.
2. **QR retrieval failed on SQLite:** the session loader returned timestamp columns as strings from raw SQL; `get_qr` compared the expiry string to a Python `datetime`, causing `TypeError: '<=' not supported between instances of 'str' and 'datetime.datetime'` and a 500 (which the browser surfaced as a CORS error because the unhandled 500 lacked CORS headers). `normalize_session_datetimes` now parses raw session timestamp strings to timezone-aware UTC datetimes in both teacher and student loaders. The QR test no longer patches those loaders, so it exercises the actual route helpers. The source copies are preserved under `D:\Temp\AttendX-phase6-source-backup\backend\...`.
3. **Guardian save is incomplete:** the frontend invokes `/students/{id}/guardian`, but no matching backend route or guardian model exists. This was not papered over with fake success or an unapproved schema/migration change.

## Automated checks (separate from browser checks)

All backend tests used in-memory SQLite. Frontend tests and build do not connect to a database.

| Check | Command | Result |
|---|---|---|
| Backend suite | From `backend`: `$env:PYTHONPATH='D:\Temp\AttendX-pytest-packages;.'; $env:DATABASE_URL='sqlite://'; $env:PYTHONDONTWRITEBYTECODE='1'; ..\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider tests` | **40 passed, 19 warnings, 8 subtests passed, 5.52s.** Warnings include the current Starlette `httpx` fallback deprecation and Python SQLite datetime adapter deprecations. |
| Frontend suite | From `frontend`: `node --test tests/*.test.mjs` | **19 passed, 0 failed.** |
| Production build | From `frontend`: `$env:TEMP='D:\Temp'; $env:TMP='D:\Temp'; $env:npm_config_cache='D:\Temp\npm-cache'; npm --cache 'D:\Temp\npm-cache' run build -- --outDir 'D:\Temp\AttendX-phase6-final-build-20261104'` | **Passed**, 1,931 modules transformed. Output on D:. Existing advisories: ignored `use client` directives and an 803.48 kB JS chunk (>500 kB). |

An initial backend test invocation from the project root omitted `backend` from `PYTHONPATH` and failed collection with `ModuleNotFoundError: app`; no tests ran in that attempt. The corrected command above passed.

## Browser evidence

Screenshots are preserved on D: (outside the workspace):

- `D:\Temp\AttendX-phase6-admin-students.png`
- `D:\Temp\AttendX-phase6-admin-classes.png`
- `D:\Temp\AttendX-phase6-gis-class-saved.png`
- `D:\Temp\AttendX-phase6-gis-class-edit.png`
- `D:\Temp\AttendX-phase6-teacher-attendance-setup.png`
- `D:\Temp\AttendX-phase6-teacher-gis-prefill.png`
- `D:\Temp\AttendX-phase6-teacher-session-active.png`

The browser console showed no new React runtime exception after the `LocationMap` import correction. The earlier QR 500/CORS console event occurred before the timestamp fix and backend restart. An initial startup attempt lacked `PYTHONPATH` and failed before any database file was created; the isolated setup was then retried successfully.

## Remaining work / limitations

- Resolve the missing guardian persistence/API contract before claiming the entire student administration form succeeds.
- Run an interactive browser session with available camera hardware and a genuine consented face sample; independently verify QR scanning and capture screenshots/logs.
- Verify an allowed GPS fix, outside-fence rejection, poor-accuracy rejection, expired QR and a duplicate/concurrent browser submission end to end. Automated GIS/QR tests pass but do not substitute for these browser/device checks.
- Teacher edit and reports/analytics/notification UI workflows were not fully exercised in this browser session. Backend/frontend automated regression suites passed, but that does not establish all interactive workflows.
- Inspect the migration against the approved PostgreSQL target and verify its migration ledger only after explicit database access approval. No migration has been applied and the live migration state is unknown.
- GPS spoofing protection is not guaranteed. The server validates submitted coordinates, reported accuracy and geofence distance; browser-reported GPS can be spoofed. Face matching and liveness are separate; liveness remains unverified/unimplemented in this test scope.
