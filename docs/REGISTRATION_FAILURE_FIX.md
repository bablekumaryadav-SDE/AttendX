# College Registration Failure Fix (2026-11-10)

## Finding and confidence

**Observed symptom:** the UI showed `An application could not be accepted with these details.`

**Flow traced:** `CollegeRegistrationPage.jsx` submits the controlled `form` object (with blank `website` converted to `null`) through `submitCollegeRegistration()` to `POST /college-registration/applications`. The backend expects the same snake_case fields in `CollegeRegistrationCreate`; names align. The route is registered in `backend/app/main.py`. A successful response is HTTP 201 with `application_reference`, `status`, and a one-time `tracking_token`; the frontend only renders success after that response. The request schema checks required details, email/phone formats, password strength and confirmation. SQLAlchemy stores the pending application and hashed proposed-admin password; the migration draft defines the corresponding table and partial unique indexes.

**Exact source of the displayed wording:** it was the backend's HTTP 409 detail. That response was used for three distinct conditions: an already registered administrator account, an active application matching the college/admin email, and *every* SQLAlchemy `IntegrityError`. The frontend error helper did not hide the response: it displayed `response.data.detail`. Therefore the symptom identifies the conflict response class (HTTP 409), but without the failed request's status/body or a safe server diagnostic from the affected runtime, it is not possible to determine which of those three conditions occurred. No real application endpoint or configured database was contacted in this phase.

A missing application table follows the SQLAlchemy operational-error path and produces sanitized HTTP 503 (`College application service is unavailable.`), not the reported 409 detail. Because the registration migration is still DRAFT / NOT APPLIED and no database was accessed, the actual runtime schema is **UNKNOWN**. If the target runtime lacks the table, applying a reviewed migration is a prerequisite; that operation needs separate approval and was not attempted.

## Fixes

- Kept the existing endpoint and request schema; no duplicate API was added.
- Replaced the ambiguous public 409 text with an actionable, non-enumerating explanation to check existing application status/contact details.
- Classified database uniqueness conflicts as 409; other integrity failures now return sanitized 503 instead of being mislabeled as duplicates.
- Added safe structured server diagnostics containing exception class and, when available, SQLSTATE and constraint name. No exception message, SQL, parameters, submitted fields, passwords, or tokens are logged.
- Added a registration-router validation response wrapper that includes field location/type/message but omits Pydantic's `input` and `ctx`. A synthetic missing-field test found that FastAPI's default 422 response echoed the entire body, including password; this is now covered and fixed.
- The UI now gives clear temporary-unavailable messaging for 503/network failures, displays actionable 409/field-specific 422 details, and never presents success on failure.

## Synthetic reproductions and tests

All backend calls used the existing FastAPI app with dependency overrides to disposable in-memory SQLite. No configured database was used.

- Valid application: **201**, pending row persisted, reference returned, password stored only as a one-way hash, token stored only as a digest, and no College/User/Membership provisioned.
- Missing College name and administrator email: **422**, field identified, submitted password absent from response.
- Invalid email, phone, weak password and mismatch: **422**, password absent from response.
- Duplicate active application and existing admin account: **409**, actionable but non-enumerating detail.
- Missing application tables: **503**, sanitized body; safe log metadata contained error class only (plus static database metadata if available), with no SQL or submitted values.
- Reference returned and actual in-memory persistence: covered by `test_submit_persists_pending_application_without_provisioning_accounts_or_colleges`.
- Frontend mounted page tests verify the payload key set matches the form state, response-only success, status-503/conflict messages, and no local tracking-token persistence.

**Backend command** (from `backend`; all values below are synthetic test configuration):

```powershell
$env:ATTENDX_SKIP_DOTENV='1'
$env:ATTENDX_TEST_SQLALCHEMY_URL='sqlite://'
$env:SECRET_KEY='<synthetic-only value of at least 32 bytes>'
$env:ALGORITHM='HS256'
..\.venv\Scripts\python.exe -m unittest tests.test_college_registration_isolated tests.test_tenant_foundation_isolated tests.test_tenant_membership_selection_isolated tests.test_tenant_api_pilot_isolated tests.test_tenant_authorization_negative_paths -q
```

**Result:** 50 tests passed, 0 failed. Starlette emitted a non-failing deprecation warning about its `httpx` TestClient integration. The focused registration suite alone passed 12/12.

**Frontend command:** from `frontend`, sort `tests/*.test.mjs` by filename and run `node <file>` one at a time. **Result:** 21 files, 105 passed, 0 failed, 0 skipped. The focused public-page file passed 9/9. No parallel worker mode was used for the final run.

Python AST checks for the changed backend files, `git diff --check`, and scoped trailing-whitespace checks passed.

## Status and limits

- **PASS:** Synthetic persistence and reference test; validation/conflict/unavailable response cases; frontend response handling.
- **UNKNOWN / NOT TESTED:** Which live condition caused the user's particular 409; runtime database identity/schema; successful persistence to any configured application database; PostgreSQL behavior; real browser submission.
- **BLOCKED:** Real database registration until the draft migration is reviewed and applied through a separately approved process. The current workflow migration remains **DRAFT / NOT APPLIED**. No migration or database operation was performed.
- **No approval requested/performed:** No PostgreSQL access, credential/DPAPI access, `.env` read, or `backend/create_admin.py` access occurred. No dependency install, destructive Git operation, commit or push occurred.
