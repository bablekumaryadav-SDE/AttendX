# Phase 14A.22 — FaceCamera Component-Level Lifecycle Verification

**Date:** 2026-11-10
**Status:** PASS WITH LIMITATION — actual ReactDOM-mounted component tests pass; direct internal React state-setter invocation is not independently observable.
**Production readiness:** NOT CLAIMED.

## Approved dependency and installation

The user explicitly approved exactly `jsdom@26.1.0` as a frontend development dependency. `frontend/package.json` pins this exact version (no range). React/ReactDOM remain 19.2.8; Vite remains 7.3.7; Node's built-in `node:test` remains the test runner. No Testing Library, other test framework, or other dependency was added or upgraded.

Before installation, the existing package files had a user change adding `leaflet@1.9.4`; this was preserved. The reviewed package/lock change added `jsdom@26.1.0` and its required lockfile graph. No existing dependency version was removed or upgraded. The existing Leaflet manifest/lock entries were not caused by this phase. Post-install `npm ls --depth=0` confirms jsdom 26.1.0 and the existing direct dependencies.

Commands:

```powershell
npm install --package-lock-only --ignore-scripts --save-dev --save-exact jsdom@26.1.0
npm install --ignore-scripts --no-audit --no-fund --save-dev --save-exact jsdom@26.1.0
npm ls --depth=0
```

The first lock-only command returned `ENOTCACHED` in the restricted environment; retry outside the restricted sandbox succeeded. The installation added jsdom and its locked dependency graph. npm emitted a deprecation warning for transitive `whatwg-encoding@3.1.1`; no other direct dependency was intentionally changed.

## Test harness and component behavior

Added `frontend/tests/face-camera-component.test.mjs`. It uses Node `node:test`, a Vite SSR module loader with `envFile:false` to load the actual JSX module, JSDOM per mount, installed React 19 `act`, and ReactDOM `createRoot`. Each harness restores process globals, console interception, process rejection listeners, closes its JSDOM instance, and unmounts the React root. `navigator.mediaDevices.getUserMedia` is stubbed with deterministic immediate or deferred promises; mock streams expose track stop calls. The simulated video element records non-null `srcObject` assignments and playback; requestAnimationFrame callbacks are manually flushed.

Actual mounted component tests:

1. Pending acquisition, unmount, then deferred resolution: both returned tracks stop; no stream is attached, no video/RAF processing starts, and no console/unhandled error is observed.
2. Mounted acquisition: stream attaches after the queued animation frame, camera status changes to live, and video playback is invoked; unmount stops both tracks and clears `srcObject`.
3. Normal unmount after successful acquisition stops every track (three-track mock).
4. Rejection after unmount produces no camera error output or unhandled rejection.
5. Three repeated mount/acquire/unmount cycles stop every stream.

The first successful component run exposed a real source integration defect: `FaceCamera` imported `stopCameraStream` from `cameraLifecycle.js`, which does not export it. The component now imports it from `cameraAccess.js`. After that fix, a test exposed cleanup retaining `srcObject` on a detached video because React had already nulled the component ref before passive effect cleanup. Added an attached-video ref so cleanup can clear the property after ref detachment. Both corrections are limited to `FaceCamera.jsx` and have regression coverage. Existing user-facing props, permission handling, stream constraints, messages, and attendance flow remain unchanged.

**Direct React state-setter invocation after unmount: NOT TESTED.** The component-level harness observes actual ReactDOM unmount, no video attachment/processing, no DOM error state, no console errors, and no unhandled rejection; React 19 does not expose internal setter invocations as a reliable public assertion. No claim is made that a test directly spies on internal state setters. Source guards remain in place for stale catch/finally paths.

The pre-existing `face-camera-lifecycle.test.mjs` remains helper/source-level coverage and is reported separately; it is not counted as component-level proof.

## Validation results

| Check | Result |
|---|---|
| Actual FaceCamera component tests | **PASS: 5 passed, 0 failed, 0 skipped.** `node tests/face-camera-component.test.mjs` from `frontend`; final retry outside restricted sandbox. |
| Existing lifecycle helper tests | **PASS: 5 passed, 0 failed, 0 skipped.** `node tests/face-camera-lifecycle.test.mjs`. |
| Existing camera regression suite | **PASS: 12 passed, 0 failed, 0 skipped.** `node tests/camera-registration.test.mjs`. |
| Complete frontend serial suite | **PASS: 18 files, 89 passed, 0 failed, 0 skipped.** Each `tests/*.test.mjs` ran individually in sorted order with Node. |
| Safe Vite validation build | **PASS; validation-only, not deployable.** Vite 7.3.7 transformed 1,933 modules. See exact command below. Non-fatal ignored `use client` directives and >500 kB bundle warning remain. |
| `git diff --check` | PASS; existing line-ending advisories only. |
| Scoped whitespace scan | PASS on the seven Phase 14A.22 changed files. |
| Browser / physical camera | NOT TESTED. JSDOM is a simulated DOM, not browser verification or a real camera device. |
| Direct internal React state-setter invocation | NOT TESTED as explained above. |

Vite build command from `frontend` (dotenv disabled; inherited process `VITE_*` values cleared by name; reserved `.invalid` URL used):

```powershell
$envNames = Get-ChildItem Env: | Where-Object { $_.Name.StartsWith('VITE_') } | ForEach-Object { $_.Name }; foreach ($envName in $envNames) { [Environment]::SetEnvironmentVariable($envName, $null, 'Process') }; $env:VITE_API_BASE_URL = 'https://phase14a22-validation.example.invalid'; node --input-type=module -e "import { build } from 'vite'; await build({ envFile: false });"
```

Restricted runs of the Vite SSR component test and validation build failed before module transformation because Windows returned `spawn EPERM`. Retrying those commands outside the restricted sandbox succeeded. The full frontend serial suite likewise first failed only in the component test with `spawn EPERM` (**18 files, 84 other tests passed, one file failed environmentally**); its outside-sandbox serial retry passed **18/18 files, 89/89 tests**. An early elevated component run initially failed all five cases on the wrong named import; after fixing it, a later elevated run passed four cases and exposed the detached-video cleanup assertion. Both implementation issues were corrected; the final focused run passed all five cases.

## Changed files and remaining status

Phase 14A.22 changes:

- `frontend/package.json` — exact dev-only jsdom entry; pre-existing Leaflet change preserved.
- `frontend/package-lock.json` — jsdom and required lock graph; no existing dependency version upgrade/removal.
- `frontend/src/components/FaceCamera.jsx` — corrected helper import and retained attached video reference to clear `srcObject` during unmount cleanup.
- `frontend/tests/face-camera-component.test.mjs` — actual ReactDOM-mounted tests.
- `docs/PHASE_14A22_FACECAMERA_COMPONENT_TEST.md`, `docs/TEST_RESULTS.md`, `docs/FINAL_ACCEPTANCE_REPORT.md`.

No unrelated files were changed by Phase 14A.22; existing modifications, untracked files, backups, and the pre-existing Leaflet package changes were preserved. Tenant routes/gates/migration and all backend code remain unchanged. Tenant migration remains DRAFT / NOT APPLIED; credential rotation A–E remains BLOCKED / NOT APPROVED.

No `.env`, secret, token, credential, DPAPI, database, PostgreSQL, migration, service, cluster, port, ACL or firewall operation occurred. No destructive Git operation, commit, push, or Phase 14A.23 work occurred. Production readiness is not claimed.
