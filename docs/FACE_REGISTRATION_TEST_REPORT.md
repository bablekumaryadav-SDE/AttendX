# Face Registration Root Cause and Verification Report

**Date:** 2026-11-04  
**Repository:** `C:/Users/Asus/OneDrive/Desktop/MainProject/AttendX`  
**Scope:** Admin face registration UI/API flow, input safety and isolated test verification. No configured database access or migration.

## Root cause found in the source flow

The capture itself did not save an image to the server. In `frontend/src/pages/auth/admin/Students.jsx`, `captureFace` awaits `canvas.toBlob`, creates a JPEG `File`, stops the camera and calls only `setFaceFile(capturedFile)`. There was no API call at capture time.

For a new student, the first `handleSubmit` creates the student, saves the class/guardian data and intentionally returns after switching the modal to edit mode. Face bytes are uploaded only later in the generic form submit path. Consequently, after capturing the photo the administrator had to click **Save Changes** a second time; closing the form or treating “Photo ready” as saved discarded the local-only capture. The source footer itself said “Save changes to send it…”.

The API contract was aligned in source: `frontend/src/services/students.js` posts to `/students/{studentId}/face`, sends multipart fields `file` and `consent=true`, and the shared Axios client attaches the stored bearer token. The backend route accepts the same fields, requires an Admin principal, confirms consent and active student status, checks MIME/signature/size, computes a YuNet/SFace embedding, and persists image bytes plus embedding/status/hash in `face_embeddings` linked by unique `student_id`. The route commits before it returns `StudentResponse`; the frontend checks `face_registered` before showing completion. No URL, field-name, token-interceptor or student-ID mismatch was found.

This is the confirmed source-level reason capture could look complete while no photo had been stored. No runtime browser session or the user's original failed request was available, so this does not prove whether an individual prior **Save Changes** request also failed for another reason.

## Minimal changes made

1. Added a separate **Register Face Photo** action beside the captured preview. It calls the existing upload endpoint immediately without resubmitting the entire student form.
2. The UI retains the photo and shows a readable error unless the API response confirms `face_registered`; after confirmation it refreshes the student list, updates the selected student status and clears the local preview/consent state.
3. Bounded the Admin endpoint's `UploadFile.read` to `MAX_FACE_IMAGE_BYTES + 1` before validation, so the application does not copy an arbitrarily large upload into memory.
4. Added isolated API and frontend tests for the registration flow and rejection cases listed below.

Images and embeddings continue to be stored in the existing database `face_embeddings` row (`image_data`, `embedding_json`, MIME type, SHA-256, status and `student_id`). That table/model already has a unique student foreign key and unique image hash. The existing admin-only endpoint does not expose the raw image in its response schema. No new storage location or migration was introduced.

## Frontend-to-backend contract traced

| Stage | Verified behavior |
|---|---|
| Select/create student | New student record is saved first. The returned backend `id` is retained; camera remains disabled before the student is saved. |
| Consent/camera | Explicit student/guardian consent is required before starting camera or selecting an image. Camera uses `getUserMedia`; stream tracks are stopped after capture/close. |
| Canvas capture | Waits for a real video frame, draws it to a canvas and awaits asynchronous `canvas.toBlob("image/jpeg", 0.94)`. A JPEG `File` is created. |
| Save action | New **Register Face Photo** action submits the captured `File` directly and immediately. Success depends on the backend response. |
| Multipart | `file` and `consent=true` fields; endpoint is `/students/{studentId}/face`. |
| Authentication | Axios request interceptor reads `attendx_token` from local storage and adds `Authorization: Bearer ...`. Backend requires Admin. |
| Server validation | MIME allowlist JPG/PNG/WEBP, bounded 5 MiB+1 read, file signature check, explicit consent, active student, duplicate image check and model decoding/face count. |
| Recognition/storage | YuNet must detect exactly one face; SFace produces a finite normalized 128-value embedding. Image, embedding and registration metadata are committed together to the student's unique `FaceEmbedding` record. |
| Response/UI | Response schema excludes raw image/embedding values but provides computed `face_registered`. UI only marks registration complete after this response is true. |

## Tests and evidence

All automated API tests use isolated in-memory SQLite databases. The configured PostgreSQL URL was not connected to; the local `backend/attendx.db` was not opened. No test applies a production/development migration.

### Face registration API cases

- Unsupported MIME type: **415**, no biometric row.
- Oversized upload (>5 MiB): **413**, no biometric row; endpoint now reads at most 5 MiB + 1 byte.
- Corrupt image signature: **400**, no biometric row.
- Blank PNG through actual YuNet/SFace pipeline: **422 No face detected**, no biometric row.
- Multiple-face decision branch: **422 Multiple faces detected**, no biometric row. This branch test injects a detector returning two detections; it verifies rejection logic, **not** YuNet performance on a real two-person photograph.
- Same exact image hash already linked to another student: **409**, recognition not invoked, no extra row.
- Student role attempting Admin registration: **403**.
- Request with no authenticated principal/token: **401**.
- Consent missing/declined: rejected; no registration row.
- Existing positive storage test: confirms image, embedding/status association and response only with a patched embedding. This is a route/storage test and **not** counted as genuine biometric success.

### Model/matching status

- YuNet/SFace files loaded successfully in the existing Python environment during prior isolated model validation; blank-image processing ran through the real model pipeline in the new tests.
- `embedding_from_image` implements real YuNet detection, SFace alignment/embedding and rejects zero or multiple faces. Matching uses cosine similarity against the registered vector and configured threshold in the student attendance endpoint.
- No genuine, consented face image or camera capture is available in the repository. Therefore a positive registration, matching, mismatched-person test, or face-attendance database insert using real image embeddings remains **UNVERIFIED**. No synthetic “matched” result is claimed.
- Liveness/anti-spoofing remains absent. Face matching is not proof of liveness.

### Final test runs

Backend (from `backend`, root `.venv`, temporary pytest overlay on D:):

```powershell
$env:PYTHONPATH = 'D:\Temp\AttendX-pytest-packages'
$env:PYTHONDONTWRITEBYTECODE = '1'
..\.venv\Scripts\python.exe -m pytest -q
```

**Result:** `34 passed, 16 warnings, 4 subtests passed` in 4.93 seconds. Warnings are existing AnyIO/pytest and Starlette/httpx deprecations plus SQLite date/datetime adapter deprecations.

Frontend tests (from `frontend`, outside the restricted process sandbox):

```powershell
node --test tests/*.test.mjs
```

**Result:** `15 passed, 0 failed`.

Production build (output/cache/temp on D: because C: has no free space):

```powershell
$env:TEMP = 'D:\Temp'
$env:TMP = 'D:\Temp'
$env:npm_config_cache = 'D:\Temp\npm-cache'
npm --cache 'D:\Temp\npm-cache' run build -- --outDir 'D:\Temp\AttendX-build'
```

**Result:** Vite build passed; 1,925 modules transformed. Existing warnings remain for ignored `use client` directives and a ~646 kB minified JS chunk.

`git diff --check` passed. No live camera/browser test was run.

## Files changed

- `frontend/src/pages/auth/admin/Students.jsx` — immediate upload action and server-confirmed success state.
- `backend/app/api/students.py` — bounded upload read.
- `frontend/tests/camera-registration.test.mjs` — capture/upload contract regression assertion.
- `backend/tests/test_face_api_isolated.py` — validation, real no-face and access/duplicate tests.
- `docs/FACE_REGISTRATION_TEST_REPORT.md` — this report.

Pre-change source copies were saved under `face-integration-backup/20261104_204618/` for the four modified source/test files. Existing untracked files `tatus` and `tash list` were preserved. Git status was checked before and after changes.

## Database, privacy and remaining limitations

- No database connection, write, reset, drop, migration, schema modification or migration apply was performed.
- Existing database-backed storage is retained. Consent remains required at UI and API boundaries; image type/signature and size are checked; face routes are protected by Admin/student role dependencies; API responses do not return biometric bytes.
- The actual configured PostgreSQL migration state remains unknown. No migration was needed for these code changes.
- Positive face matching and end-to-end camera capture need a real consenting person and an available camera in a controlled test environment. Mismatch, genuine multiple-person image detection and liveness remain unverified.
- The full QR and role regression suite passed as part of the 34 backend tests; there were no workflow source changes outside the face-registration form and bounded upload handling.
