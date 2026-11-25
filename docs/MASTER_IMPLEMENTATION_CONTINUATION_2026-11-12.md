# Master implementation continuation — 2026-11-12

## Scope and status

This continuation checked the reported Teacher list 404 contract and exercised the existing tenant attendance workflow through the mounted FastAPI ASGI application using synthetic SQLite fixtures. It did not access a live server or PostgreSQL.

### Teacher list 404

- `frontend/src/services/teachers.js:getTeachers(collegeId)` calls `GET /teachers/` with the selected College as a query parameter using the shared Axios instance.
- `frontend/src/pages/auth/admin/Teachers.jsx` loads the list for the `AuthContext` College; `AdminDashboard.jsx` also requests the directory once when its College-bound dashboard loader runs. Neither observed `useEffect` creates a retry/poll loop for this GET. A separate page mount can naturally issue its own request.
- `backend/app/main.py` registers `tenant_teachers_router` at `/teachers` before the legacy router; the legacy router remains default-denied and hidden from OpenAPI. `backend/app/api/tenant_teachers.py:list_tenant_teachers` handles `GET /` for that router.
- Synthetic authenticated ASGI tests cover the expected success response, foreign and NULL ownership, missing membership, suspended College, invalid/foreign College selection and unauthenticated access.
- **Root cause of the reported live `127.0.0.1:8000` 404: UNKNOWN.** The source route and client path agree, and the synthetic route returns the expected contract. The active live process and its route table were not inspected. A stale/different running server is a possibility, not a verified cause. No live request was made.
- A separate confirmed source/UI issue from the preceding Teacher registration work was that inactive Class/Subject options could be selected although creation only accepts active same-College references. Those dropdowns now expose explicitly active records only; backend validation remains authoritative.

## Attendance workflow coverage added

Added `test_active_session_qr_attendance_flows_through_student_and_teacher_routes` in `backend/tests/test_tenant_face_isolated.py`. It uses the actual mounted ASGI routes and synthetic records to verify: Teacher QR issuance; an eligible Student's active-session response (subject, class, teacher, and not-yet-attended state, without QR secret); QR submission; Student attendance history; refreshed `already_attended`; duplicate rejection; Teacher live roster status/method; and a foreign-College sanitized 404 with no Student disclosure.

This is route-level synthetic SQLite evidence. It does not prove PostgreSQL behavior, durable real-database persistence, a real Student/Teacher account workflow, camera capture, face recognition accuracy/liveness, physical QR scanning, or browser UI behavior.

## Validation

- **PASS:** Full backend suite with dotenv disabled and synthetic SQLite: **341 passed, 0 failed**. From `backend`:

  ```powershell
  $env:ATTENDX_SKIP_DOTENV='1'
  $env:ATTENDX_TEST_SQLALCHEMY_URL='sqlite://'
  $env:SECRET_KEY='synthetic-test-key-only-not-for-real-authentication'
  ..\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_*.py' -q
  ```

- **PASS:** Focused frontend tests: Teacher service/page **5/5**, Teacher Dashboard **2/2**, Student face service **1/1**, attendance services/pages **6/6**, Student dashboard **4/4**; **18 passed, 0 failed**. Each ran directly via `node tests/<file>.mjs` from `frontend`.
- **PARTIAL / FAILURES:** Full frontend serial per-file sweep: **28 files, 138 tests; 113 passed, 25 failed, 0 skipped**. Five component-heavy files (24 cases) stopped before assertions with Windows `spawn EPERM` from Vite/esbuild child-process creation. One actual assertion failed in `api-base-url.test.mjs`: the existing generated artifact under `frontend/dist` contains the development loopback URL `http://127.0.0.1:8000`. The artifact was not modified or overwritten; it may be stale, and a fresh validation-only build was not run in this continuation.
- **PASS:** Python AST parsing of the changed backend test, `git diff --check`, and scoped trailing-whitespace scan.
- **NOT RUN:** Frontend production/validation build. The existing `frontend/dist` was preserved; its artifact audit did run as part of the frontend suite and found a loopback URL.
- **NOT TESTED:** Browser UI, live API request, live PostgreSQL, production API URL, and genuine camera/face workflow.

## Remaining blockers

- Establish why the already-running server at `127.0.0.1:8000` returns 404 by separately inspecting its process identity and exercising the authorized browser/API path; do not infer from source-only tests.
- Review/rebuild the existing frontend distribution only with authorization that permits replacing it. The source-level production URL tests pass, but the current artifact audit flags a loopback URL.
- Run actual browser acceptance and PostgreSQL-backed registration → assignment → session → attendance → roster/report reconciliation in an approved isolated environment.
- Face matching/liveness and other incomplete modules remain unaccepted until genuinely verified.

No database or PostgreSQL connection/operation, migration, credential/DPAPI access, `.env` inspection, service operation, dependency installation, `backend/create_admin.py` access, or `frontend/dist` overwrite occurred.

## Teacher registration continuation — 2026-11-12

- **Confirmed source failure condition:** `POST /teachers/?college_id=...` returns HTTP 503 before creating User/Teacher records when assignment rows are supplied but `teacher_assignments.effective_from/effective_to` are absent. This is guarded intentionally because the relationship-effective-date migration is DRAFT / NOT APPLIED. A synthetic SQLite test that models the pre-migration table verified the 503 detail and verifies no User or Teacher is persisted. The actual live schema was not inspected, so whether it is the cause of this particular user's current submission remains **UNKNOWN**.
- **Frontend defect fixed:** Registration previously added a row only if all four fields existed, silently discarding partial Class/Subject/year/semester rows. It now rejects incomplete rows, validates positive IDs/year/semester bounds, rejects duplicate assignment tuples before submission, permits wholly empty optional rows, and uses an immediate request lock to prevent duplicate submissions.
- **Assignment constraint:** The inspected ORM has no independent Subject-Class mapping entity. A TeacherAssignment stores the same-College Teacher/Class/Subject tuple. Do not claim an independent mapping was verified or invent a schema relationship.
- **PASS:** Backend full suite: **342 passed, 0 failed**. Focused Teacher API/management suite: **16 passed, 0 failed**. Frontend full serial-per-file suite: **139 cases, 114 passed, 25 failed, 0 skipped**; 24 component-heavy cases failed before assertions with Windows `spawn EPERM`, and one artifact audit found the existing `frontend/dist` loopback URL. Focused Teacher tests: **6 passed**.
- **PASS:** Changed Python AST parse; Teacher JSX parse with installed frontend `@babel/parser`; `node --check` for the assignment helper; `git diff --check`; scoped whitespace scan.
- **Test correction:** The first focused run after adding the legacy-schema test reported four `NameError` errors because the new test had been inserted inside the preceding test. The test was moved to its own method; the focused 16-test rerun and subsequent full 342-test suite both passed.
- **NOT TESTED:** Real database registration, live API status, browser UI, fresh build, PostgreSQL persistence, and production console cleanliness. No database or migration changes were made.

