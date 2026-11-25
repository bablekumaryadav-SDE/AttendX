# AttendX Local Execution Acceptance Report

**Date:** 2026-11-10
**Target project:** `C:\Users\Asus\OneDrive\Desktop\MainProject\AttendX`
**Overall result:** BLOCKED for full local/real workflow acceptance. Safe source-level and isolated validation completed; actual PostgreSQL-backed workflow was not authorized or tested.

## Git status and preservation

- **Before:** The worktree was already extensively modified and contained untracked source, migration, test, backup, log, and documentation files. All were preserved; no reset, clean, checkout, restore, commit, or push was run.
- **After:** New report files from this phase are added; the same pre-existing worktree remains dirty. Git reports permission-denied on pre-existing/test-created `tmp*` and `.pytest_cache` paths. Those paths were not enumerated, cleaned, or modified.
- **Files created this phase:** `docs/ATTENDX_LOCAL_RUN_BLOCKERS.md`, `docs/ATTENDX_DATABASE_MIGRATION_PRECHECK.md`, `docs/ATTENDX_LOCAL_EXECUTION_ACCEPTANCE_REPORT.md`.

## Acceptance matrix

| # | Area | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Git status before/after | VERIFIED | Read-only status was captured before work and after report creation. The existing extensively dirty tree remains; Git warns it cannot read several `tmp*` and `.pytest_cache` directories. Those paths and all pre-existing modifications/backups were left untouched. |
| 2 | Files changed | VERIFIED | Three new reports listed above; no application source was changed in this documentation/acceptance pass. |
| 3 | Backend code validation | VERIFIED | AST checks and isolated backend suite; normal backend startup was not attempted. |
| 4 | Backend test suite | FAILED | 258 tests: 223 passed, 23 failed, 12 errored. Failures/errors are classified in `TEST_RESULTS.md`; no gate was weakened. |
| 5 | Frontend test suite | VERIFIED | 111 passed across 23 files, run serially. Initial sandbox Node workers returned `spawn EPERM`; serial retry succeeded outside the process sandbox. |
| 6 | Frontend build | VERIFIED | Vite production validation build used dotenv/config files disabled, inherited `VITE_*` cleared, `.invalid` URL and `write:false`; no output was written. Not deployable. |
| 7 | Backend startup | BLOCKED | Normal startup configuration would load the private dotenv file/database URL; no `.env` read or PostgreSQL access is authorized. No backend process was started. |
| 8 | Frontend startup | VERIFIED | Temporary Vite server started on loopback; `http://127.0.0.1:5173/` returned HTTP 200; server then closed. No persistent server remains. |
| 9 | Actual local URLs | VERIFIED | Temporary frontend URL above only. Backend API URL/process was not verified; source development default is not evidence of a running service. |
| 10 | PostgreSQL status | BLOCKED | No PostgreSQL process, service, port or database was inspected or contacted. |
| 11 | Database persistence | BLOCKED | Synthetic in-memory SQLite persistence tests are not configured-database persistence. |
| 12 | Migration status | NOT TESTED | Draft markers were read in source. Live applied/unapplied state was not inspected. No migration executed. |
| 13 | College registration | NOT TESTED | Source paths and synthetic request behavior are tested; actual configured DB submission was not tested. |
| 14 | Application reference generation | NOT TESTED | Synthetic API tests exercise reference generation; no actual target database request occurred. |
| 15 | Tracking-token handling | NOT TESTED | Synthetic tests verify digest persistence and one-time response behavior; no real target operation occurred. |
| 16 | Super Admin review | NOT TESTED | Synthetic authorization/list/filter/detail/decision tests pass; actual account and database were not used. |
| 17 | College Admin activation | BLOCKED | Approval leaves College, account and membership pending/inactive; no verified College Admin invitation/activation workflow is wired into approval. SMTP was not inspected or contacted. |
| 18 | College Admin login | BLOCKED | No active provisioned College Admin exists in the verified synthetic tests; no real credentials or DB access used. |
| 19 | Student registration | NOT TESTED | Synthetic tenant tests pass; real migrated PostgreSQL persistence is unverified. |
| 20 | Teacher registration | NOT TESTED | Synthetic tenant tests pass; real migrated PostgreSQL persistence is unverified. |
| 21 | Attendance workflows | BLOCKED | Read-only tenant attendance views exist; unreviewed legacy/session attendance writes remain under default-deny. Real marking flow is not enabled end to end. |
| 22 | Tenant isolation | NOT TESTED | Synthetic negative-path tests pass; actual PostgreSQL composite constraints/data isolation remain unverified. |
| 23 | Security findings | NOT TESTED | Source and synthetic tests preserve distinct Super Admin authorization, default-deny and UNKNOWN ownership behavior; no live database or browser security test was authorized. |
| 24 | Remaining blockers | BLOCKED | Authorized DB identity/schema/backup/migration rehearsal, College Admin activation, attendance write design/enablement, SMTP and browser E2E remain. |
| 25 | Next action | BLOCKED | User must separately approve exact local DB read-only identity/schema inspection and backup plan; migration execution requires another approval after a concrete plan is reviewed. |

## Test commands and results

From `backend`, with only process-scoped `ATTENDX_SKIP_DOTENV=1`, explicit synthetic `ATTENDX_TEST_SQLALCHEMY_URL=sqlite://`, and a synthetic `SECRET_KEY`:

```powershell
..\.venv\Scripts\python.exe -m unittest tests.test_college_registration_isolated tests.test_tenant_registration_isolated tests.test_tenant_authorization_negative_paths -q
# 32 passed

..\.venv\Scripts\python.exe -m unittest discover -s tests -q
# 258 total: 223 passed, 23 failed, 12 errored
```

From `frontend`, sorted serial tests invoked `node --test --test-concurrency=1 <file>` once per `tests/*.test.mjs`: 23 files, 111 passed, 0 failed, 0 skipped. A first sandboxed run failed with Windows `spawn EPERM`; retry outside the process sandbox passed.

The validation build was invoked with `configFile:false`, `envFile:false`, cleared inherited `VITE_*`, a reserved `https://validation-only.invalid/api`, and `build.write:false`. It completed successfully without creating artifacts. `git diff --check` and scoped whitespace checks pass; line-ending normalization warnings are existing.

## Exact safe boundary and next action

No `.env`, credentials, SMTP, production endpoint, PostgreSQL or database state was inspected. No backup, migration, database, service, port, ACL, firewall, or cluster operation occurred. `backend/create_admin.py` was not accessed. The tenant and registration migrations remain source-marked DRAFT / NOT APPLIED; actual runtime application state is UNKNOWN. Production readiness is not claimed.

Before real database-backed acceptance, separately approve the exact target read-only identity/schema preflight and backup destination. Review `ATTENDX_DATABASE_MIGRATION_PRECHECK.md`; present any exact migration plan and effects for another explicit approval before execution.
