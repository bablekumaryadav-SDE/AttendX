# Phase 14A.18 — Integration Readiness Remediation

**Date:** 2026-11-10
**Status:** Source remediation and isolated validation PASS; PostgreSQL/browser NOT TESTED
**Production readiness:** NOT CLAIMED

## Changes made

### Reports and Notifications

- Removed Reports entries from the Admin and Teacher sidebars.
- Kept existing `/admin/reports`, `/teacher/reports`, and role-specific `/notifications` URLs so direct navigation is not silently redirected. They now render `FeatureUnavailable` with a visible “not available yet” message and no API service import or dispatch.
- Labeled the header Notifications action as not available yet; it leads to the explicit unavailable state.
- `AppRoutes` no longer imports/mounts `ReportsPage` or `Notifications`. Their legacy source files and services remain preserved. The prior `AdminDashboard.jsx` remains unmounted; its old links and calls cannot run through the active route tree.
- No report, notification, or other legacy API was enabled.

### OpenAPI and runtime gate

FastAPI's schema is keyed by path and method. The tenant overlay and later legacy router registrations used the same keys, allowing the later legacy operation metadata to overwrite the supported tenant operation in generated OpenAPI. In `main.py`, each default-deny legacy router is now included with `include_in_schema=False`. This is documentation filtering only: the routes are still registered with `legacy_business_dependencies`; no router, URL, method, or authorization dependency was removed or reordered. Tenant router operations remain in OpenAPI and expose the tenant handler operation IDs. Blocked legacy-only operations are omitted rather than documented as successful handlers.

Tests verify all 17 enabled tenant method/path/operationId entries, absence of representative blocked legacy operations, retention of auth and approved pilot PATCH documentation, and a live in-process request to a legacy analytics route still returns the exact default-deny 503. No wildcard route exemption was added.

### Explicit isolated dotenv mode

`backend/app/database.py` now provides an explicit opt-in test configuration:

- Without `ATTENDX_SKIP_DOTENV=1`, startup continues to call `load_dotenv` on `backend/.env` and use `DATABASE_URL`, preserving normal application behavior.
- With `ATTENDX_SKIP_DOTENV=1`, dotenv is not called and `DATABASE_URL` is not consulted. A separate `ATTENDX_TEST_SQLALCHEMY_URL` is mandatory; missing it fails closed without falling back to application configuration.
- Validation commands set the opt-out and synthetic `sqlite://` URL in the current PowerShell process only. No `.env` file or production connection string was changed/read by these Phase 14A.18 test runs. The default-startup behavior test uses a mocked loader and synthetic URL; it does not open `.env`.

## Focused tests added

- `backend/tests/test_tenant_phase14a18_readiness.py`: generated OpenAPI operation IDs and method/path set, omission of blocked operations, retained pilot/auth schema, runtime default-deny behavior, dotenv opt-out/no-fallback, and mocked default startup behavior.
- `frontend/tests/phase14a18-readiness.test.mjs`: Reports navigation removal and placeholder route, Notifications placeholder and label, legacy page unmounting, and no API caller in the unavailable component.

## Validation results

| Check | Result | Exact command / notes |
|---|---|---|
| Focused backend readiness tests | PASS: 6 passed, 0 failed | From `backend`: `$env:ATTENDX_SKIP_DOTENV='1'; $env:ATTENDX_TEST_SQLALCHEMY_URL='sqlite://'; ..\.venv\Scripts\python.exe -m unittest tests.test_tenant_phase14a18_readiness -v`. |
| Full backend tenant suite | PASS: 120 passed, 0 failed, 0 skipped | Same environment prefix, then `..\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_tenant_*' -v`; test fixtures use synthetic SQLite/in-process FastAPI only. Non-fatal Starlette/httpx TestClient deprecation and Python sqlite datetime adapter deprecation warnings. |
| Focused frontend test | PASS: 4 passed, 0 failed | From `frontend`: `node tests/phase14a18-readiness.test.mjs`. `node --test tests/phase14a18-readiness.test.mjs` was attempted first and failed with Windows `spawn EPERM`; direct file execution avoids the worker subprocess. An earlier test iteration had one assertion failure because a broad regex matched `TenantAdminDashboard`; it was narrowed to the legacy import path and then passed. |
| Frontend serial suite | PASS: 14 files, 69 passed, 0 failed, 0 skipped | Per-file Node invocations sorted by filename; exact runner recorded below. |
| Production build | PASS on retry; env-file handling UNKNOWN | `npm run build` from `frontend`; first restricted invocation failed before transform with Windows `spawn EPERM`; authorized retry transformed 1,933 modules. Non-fatal ignored `use client` and >500 kB chunk warnings. The stock Vite build was used; whether Vite loaded a frontend env file was not inspected, to avoid reading secrets. No build output showed environment values. |
| Python AST | PASS: 75 Python files | From `backend`: `..\.venv\Scripts\python.exe -B -c "import ast,pathlib; root=pathlib.Path('app'); files=sorted(root.rglob('*.py'))+sorted(pathlib.Path('tests').glob('test_tenant_*.py')); [ast.parse(p.read_text(encoding='utf-8-sig'), filename=str(p)) for p in files]; print('AST syntax PASS:',len(files),'Python files (UTF-8 BOM-aware)')"`; no application import or dotenv read in this check. |
| `git diff --check` | PASS | No diff whitespace errors; Git emitted existing LF-to-CRLF advisory messages for other modified files. |
| Scoped trailing whitespace | PASS | Zero trailing whitespace in this report and the Phase 14A.18 sections appended to shared reports. |
| Browser UI / PostgreSQL | NOT TESTED | No browser rendering, PostgreSQL connection, application DB connection, SQL, or migration. |

### Exact frontend serial runner

Run from `frontend`:

```powershell
$failed = 0; $files = 0; $passed = 0; $skipped = 0; Get-ChildItem tests -Filter '*.test.mjs' | Sort-Object Name | ForEach-Object { $files++; $output = & node $_.FullName 2>&1; $exit = $LASTEXITCODE; $passLine = $output | Select-String 'pass \d+' | Select-Object -Last 1; $skipLine = $output | Select-String 'skipped \d+' | Select-Object -Last 1; if ($passLine) { $passed += [int]($passLine.Line -replace '\D','') }; if ($skipLine) { $skipped += [int]($skipLine.Line -replace '\D','') }; if ($exit -ne 0) { $failed++; Write-Output "FAILED: $($_.Name)"; $output } }; Write-Output "FILES=$files PASSED=$passed FAILED_FILES=$failed SKIPPED=$skipped"; if ($failed -gt 0) { exit 1 }
```

Result: `FILES=14 PASSED=69 FAILED_FILES=0 SKIPPED=0`.

## Remaining status

- **PASS:** The Phase 14A.17 OpenAPI ambiguity is resolved for generated schema; all enabled tenant operation IDs are asserted.
- **PASS:** Blocked Reports/Notifications routes now show unavailable UI and do not mount their legacy API callers.
- **PASS:** Test imports can explicitly skip `.env` loading and require a separate synthetic test URL; default production configuration behavior is unchanged unless the opt-in flag is set.
- **NOT TESTED:** Browser rendering, PostgreSQL behavior, actual deployment schema, and migration execution.
- **DRAFT / NOT APPLIED:** `DRAFT_20261109_add_tenant_ownership_v1.sql`; production schema compatibility remains unverified.
- **BLOCKED / NOT APPROVED:** Credential rotation A–E. No credential or DPAPI file was accessed. No Phase 14A.19 work began.

No PostgreSQL, database, credential file, DPAPI file, service, cluster, ACL, or port operation occurred. No `.env` or database connection string was modified. Backend tests were run with dotenv disabled. **UNKNOWN:** the stock Vite build may read standard frontend env files or process `VITE_*` variables; their presence/content and any bundle exposure were not inspected. No values appeared in build output. No destructive Git operation, commit, or push occurred.
