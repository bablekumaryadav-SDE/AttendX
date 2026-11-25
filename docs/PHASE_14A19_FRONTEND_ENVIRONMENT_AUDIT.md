# Phase 14A.19 — Frontend Environment and Release-Safety Audit

**Date:** 2026-11-10
**Status:** Source hardening and safe artifact checks PASS; deployment configuration UNKNOWN
**Production readiness:** NOT CLAIMED

## Scope and secret handling

Inspected frontend source/configuration, API services, build scripts, environment-file metadata, and the generated production bundle. The `.env` file was inspected by filename and metadata only; its content and variable names were not read. Build artifacts were scanned by code that reports only safe issue classifications and filenames, never matched content. No backend `.env`, database URL, credential, DPAPI file, or service was accessed.

## Environment inventory

| Name | References | Public / embedded | Necessary use |
|---|---|---|---|
| `VITE_API_BASE_URL` | `frontend/src/services/apiBaseUrl.js`; consumed by `frontend/src/services/api.js` via `import.meta.env` | Vite-exposed build variable. Its configured value is embedded into client JavaScript and must be treated as public configuration, never a secret. | Preferred production API origin/base path. |
| `VITE_API_URL` | `frontend/src/services/apiBaseUrl.js`; consumed by `frontend/src/services/api.js` | Also public and embedded when selected. | Compatibility alias; unnecessary when `VITE_API_BASE_URL` is configured. It remains accepted to avoid silently breaking existing deployment configuration. |
| `DEV` | `frontend/src/services/api.js`, `frontend/src/routes/AppRoutes.jsx`; read from Vite's `import.meta.env` | Vite compile-time boolean; not a secret. | Enables development-only localhost default and development error diagnostics. Production builds replace the branch. |
| `PROD` | `frontend/src/services/api.js`; read from Vite's `import.meta.env` | Vite compile-time boolean; not a secret. | Distinguishes a Vite production build from Node test imports and prevents development fallback in production. |
| `.env` variable names | `frontend/.env` exists (34 bytes; last-write metadata 2026-09-07 09:51:56 UTC) | UNKNOWN: names/content were intentionally not read. Vite `VITE_*` names would be public if emitted. | Actual configured production endpoint cannot be confirmed under the no-value-inspection restriction. |

No frontend source reference to `DATABASE_URL`, `ATTENDX_TEST_DATABASE_URL`, `POSTGRES*`, `JWT_SECRET`, `SECRET_KEY`, or `PRIVATE_KEY` was found by the safe name-only source scan. No `process.env` access or `vite.config.*` file exists in the frontend project. The package scripts are `vite` (dev), `vite build` (build), and `vite preview` (preview); tests are invoked as individual Node test files.

## API base URL behavior

`frontend/src/services/api.js` creates the shared Axios client from `resolveApiBaseUrl`. Tenant services continue to import this shared client; bearer authentication remains attached by the API interceptor. Tenant page code supplies the selected College from AuthContext and does not read College authorization from localStorage. The membership service's existing localStorage token read is only a single-flight request key; the server still verifies membership.

`apiBaseUrl.js` now applies these rules:

- In development, a missing URL uses `http://127.0.0.1:8000`; a configured URL may use HTTP(S), including local development.
- In production, missing configuration fails closed. There is no localhost fallback.
- Production configuration must be an absolute, non-loopback HTTPS URL.
- Relative URLs, unsupported protocols, user/password URL components, query strings and fragments are rejected.
- Trailing slashes are normalized away. `VITE_API_BASE_URL` takes precedence over the compatibility alias `VITE_API_URL`.
- Error messages are generic and do not echo the configured URL.

No deployment URL was invented or validated. The actual frontend `.env` variables remain UNKNOWN. The safe build below used a temporary reserved `.invalid` API base to exercise bundling without reading `.env`; the resulting `dist` artifact is **validation-only and not deployable**. Do not treat it as release output.

## Build artifact inspection

The generated `frontend/dist` contained `index.html`, one JavaScript asset and one CSS asset; no source-map files were present. A post-build automated scan checked without printing values for:

- Backend-only configuration identifiers and recognizable private-key/AWS-key markers.
- Credential-bearing URL patterns.
- Internal Windows/Linux filesystem paths.
- Source-map files/references.
- Known application development error diagnostics.
- The development loopback API fallback in production output.

All checks passed. The bundle contains the intentionally supplied public validation endpoint setting, which is reserved/non-routable; therefore the build is not a production artifact. These pattern checks reduce accidental inclusion risk but cannot prove absence of every possible secret representation. The build was produced with Vite dotenv loading explicitly disabled, and all pre-existing process `VITE_*` variables were removed from that build process before setting the temporary validation value.

## Changes and tests

- Added `frontend/src/services/apiBaseUrl.js` for normalization and mode-specific validation.
- Updated `frontend/src/services/api.js` to use the resolver; production has no localhost fallback.
- Guarded workspace, camera and QR diagnostic logging behind Vite's development flag so those application-specific diagnostics are absent from production output.
- Added `frontend/tests/api-base-url.test.mjs` for normalization, missing/invalid configuration, development/production behavior, tenant service use of the shared API client, localStorage boundaries, backend-only variable references, credential-like source patterns, and safe generated-artifact checks.
- Updated the existing Attendance Monitor source contract to follow the new API base URL resolver.

## Validation results

| Check | Result | Details |
|---|---|---|
| API URL/source/artifact focused suite | PASS: 9 passed, 0 failed | `node tests/api-base-url.test.mjs` from `frontend`; artifact audit ran against generated `dist`. |
| Full frontend serial suite | PASS: **15 files, 78 passed, 0 failed, 0 skipped** | Each `tests/*.test.mjs` was run individually in sorted order with Node; no worker pool. |
| Production-mode Vite bundle | PASS (validation-only config) | `node --input-type=module -e "import { build } from 'vite'; await build({ envFile: false });"` from `frontend`, with one temporary reserved `.invalid` public API base and process `VITE_*` variables sanitized. Vite 7.3.7 transformed 1,934 modules. Non-fatal ignored `use client` and >500 kB chunk warnings remain. |
| `git diff --check` | PASS | No whitespace errors in tracked diff. Git printed existing LF-to-CRLF advisory messages for unrelated modified files. |
| Scoped whitespace | PASS | Zero trailing whitespace in new source/test files and Phase 14A.19 documentation sections. |
| Browser / backend / Python AST | NOT TESTED / NOT APPLICABLE | No browser or backend test was needed. No Python files changed. |
| PostgreSQL / database / credentials | NOT TESTED | No connection, database command, credential/DPAPI read, service, cluster, ACL or port operation. |

Four restricted Vite build attempts during implementation stopped before transformation with Windows `spawn EPERM`; each was retried outside the restricted sandbox. The final safe build passed with 1,934 modules transformed. Two pre-final frontend serial runs failed during iteration: the first reported **7 failed files / 41 passing tests** due to a stale source assertion and direct `import.meta.env` access in Node; the next reported **6 failed files / 42 passing tests** because Node test imports had no production URL. These were corrected; the final suite passed **78/78**. A production artifact check also caught a retained loopback string before the env-mode branch was refined; the final safe bundle scan passed with no loopback fallback present.

### Exact frontend serial runner

Run from `frontend`:

```powershell
$failed = 0; $files = 0; $passed = 0; $skipped = 0; Get-ChildItem tests -Filter '*.test.mjs' | Sort-Object Name | ForEach-Object { $files++; $output = & node $_.FullName 2>&1; $exit = $LASTEXITCODE; $passLine = $output | Select-String 'pass \d+' | Select-Object -Last 1; $skipLine = $output | Select-String 'skipped \d+' | Select-Object -Last 1; if ($passLine) { $passed += [int]($passLine.Line -replace '\D','') }; if ($skipLine) { $skipped += [int]($skipLine.Line -replace '\D','') }; if ($exit -ne 0) { $failed++; Write-Output "FAILED: $($_.Name)"; $output } }; Write-Output "FILES=$files PASSED=$passed FAILED_FILES=$failed SKIPPED=$skipped"; if ($failed -gt 0) { exit 1 }
```

## Remaining release status

- **PASS:** Production does not fall back to localhost; invalid or missing production API configuration fails closed.
- **PASS:** Generated validation bundle has no detected backend-only names, credential-bearing URL, internal path, source map, known dev diagnostic marker, or loopback fallback.
- **UNKNOWN / BLOCKED:** Actual configured production API URL and the variable names inside `frontend/.env` were not inspected. A release build must be produced in the deployment pipeline with an explicitly reviewed public HTTPS endpoint.
- **NOT TESTED:** Browser/network behavior and actual deployment configuration.
- **DRAFT / NOT APPLIED:** Tenant ownership migration remains unapplied; this frontend audit does not validate backend schema or production readiness.
- **BLOCKED / NOT APPROVED:** Credential rotation A–E remains blocked. Phase 14A.20 was not started.

No environment-file contents were read. No `.env` or backend connection string was modified. No database, PostgreSQL, credential, DPAPI, service, cluster, ACL or port operation occurred. No destructive Git operation, commit or push occurred.
