# Student Registration Duplicate Error - 2026-11-11

## Root-cause finding

The exact displayed sentence, `An account or Student record already uses these details.`, came from the old tenant Student registration pre-check. The current pre-check independently checks normalized global `users.email`, global `students.email`, and College-scoped `students.roll_number`. The code path itself establishes that the response was emitted before Student registration inserts. Without the attempted field values and a safe, authorized record-level diagnostic, the particular matched field and record cannot be identified from source alone.

The relevant route is `POST /students/` with the selected College supplied as the `college_id` query parameter; the tenant router is registered before the legacy router. The frontend calls this route through `createTenantStudent` in `frontend/src/services/tenantStudents.js`.

The current code now returns a stable 409 detail with `code`, `field`, and a safe message for recognized conflicts. Email comparisons use case-insensitive matching consistent with login normalization. Roll number and enrollment number are College-scoped. The database uniqueness constraints remain the final race protection; recognized uniqueness failures are mapped after rollback without returning driver details.

## Identity and schema facts

- `User.id` and `Student.id` are integer primary keys.
- `Student` has no `user_id` column or User relationship in the current ORM model. Registration creates a User and Student using the same normalized email and creates a CollegeMembership for the User, but there is no direct database edge proving that a later-existing User is linked to a particular Student.
- As a result, the request's "already-linked User and Student" case cannot be safely inferred or exempted by current source. Existing global email uniqueness is preserved; no account is reused, reactivated, or overwritten.
- `students.email` and `users.email` remain globally unique. `students.student_code` remains globally unique. Non-NULL College roll and enrollment numbers are College-scoped. NULL-College roll numbers retain a separate global uniqueness rule. Student mobile/phone has no unique constraint, so a repeated phone is allowed under the current model policy.
- Inactive Students still occupy their unique email, roll, enrollment, and code values; registration does not reactivate them.

## Implementation

- Backend duplicate checks now distinguish email, roll number, and enrollment number. Email checks are case-insensitive. Integrity errors are rolled back and translated to safe field-specific 409s when the unique constraint can be identified; other integrity conflicts receive a generic safe registration conflict.
- Student code allocation uses the active Session's dialect, a PostgreSQL transaction advisory lock plus counter row lock, and reconciles a stale counter against existing codes for the current year before allocating. This makes concurrent PostgreSQL allocation serialize by year, subject to the expected counter table and database constraints. PostgreSQL execution was not performed here.
- Account, Student, CollegeMembership, optional Guardian, optional initial Class assignment, and initial academic-history inserts remain in one SQLAlchemy transaction. Failures roll back; no success response is returned before commit.
- The existing permanent password is hashed through the current password helper. Passwords are not included in duplicate errors, response data, or tests' output.
- The React registration form maps structured details to individual fields, ignores Pydantic `input` values, clears relevant stale errors, preserves entered values after failure, and prevents a second submit while the request is pending. Success remains gated on a successful API response.
- Repeated successful-identical requests are not idempotent replays: they return a duplicate conflict and do not create another User/Student/Membership. There is no idempotency-key contract or request fingerprint in the current schema/API. Safe replay of a lost successful response would require a separately designed idempotency contract.

## Validation

Backend command (from `backend`):

```powershell
$env:ATTENDX_SKIP_DOTENV='1'; $env:ATTENDX_TEST_SQLALCHEMY_URL='sqlite://'; $env:SECRET_KEY='Synthetic-only-test-key-2026-not-for-any-account'; .\.venv\Scripts\python.exe -m unittest tests.test_tenant_student_registration_conflicts tests.test_tenant_student_management tests.test_tenant_admin_set_password tests.test_college_identifier_scope -v
```

Result: **26 passed, 0 failed**. These synthetic SQLite tests cover field conflicts, case-insensitive email, same/different College identifier behavior, inactive duplicate data, safe conflict mapping, transaction rollback at linked insert stages, repeated submission, and constraint failures induced after pre-checks. The induced failures are not simultaneous multi-connection race tests.

Frontend commands (from `frontend`):

```powershell
node tests\student-registration-errors.test.mjs
node tests\tenant-students.test.mjs
```

Result: **10 passed, 0 failed**. These are Node source/contract tests; no browser was launched.

Python AST parsing passed for `tenant_students.py`, `student_module.py`, and `test_tenant_student_registration_conflicts.py`. `git diff --check` passed; Git emitted existing LF/CRLF conversion warnings.

## Status and limitations

- **PASS (source behavior and synthetic regression tests):** specific duplicate errors, rollback behavior, frontend mapping, and duplicate-safe repeat submission.
- **UNKNOWN:** which exact live record/field caused a user's previous 409. Source inspection can identify the emitting pre-check but not the data-dependent branch.
- **NOT TESTED:** PostgreSQL constraints, PostgreSQL concurrency, live API persistence, actual browser interaction, generated ID behavior against a live catalog, and login after this registration path.
- **NOT APPLICABLE to current schema:** direct User-to-Student linkage validation; there is no `students.user_id` relationship.
- **BLOCKED for safe implementation without a separate design/approval:** treating an existing user/student pair as linked, replaying an earlier successful response idempotently, and any schema/index changes.

No database connection, SQL, migration, DDL, DML, credential access, or `.env` access was performed for this work.
