# Phase 14A.21 — FaceCamera Async Lifecycle Race Fix

**Date:** 2026-11-10
**Implementation:** PASS by source review and deterministic lifecycle-helper tests.
**Component-level React mount test:** BLOCKED / NOT TESTED.
**Production readiness:** NOT CLAIMED.

## Change

`frontend/src/components/FaceCamera.jsx` now tracks mount status and a monotonically increasing camera-request ID. Starting/stopping a request invalidates earlier request IDs. Effect cleanup marks the component unmounted, invalidates any pending request, stops any currently acquired tracks and clears `video.srcObject` without calling React state setters.

`acquireCameraStreamSafely` awaits `getUserMedia`, then checks whether the originating component request is still current. If the component unmounted or the request was cancelled, it stops every returned track and returns no stream. `FaceCamera` returns before saving the stream, updating active state, attaching video, or waiting for the video animation frame. Rejected requests after cancellation are ignored before logging or state updates; the `finally` block only changes state for the current mounted request. Normal camera permission messages and active-stream behavior are retained. `stopCameraStream` catches a track stop failure and continues stopping other tracks.

No public component props, attendance API behavior, permissions, or tenant/security behavior changed. No dependency or package configuration was added.

## Tests and coverage limit

`frontend/tests/face-camera-lifecycle.test.mjs` contains five deterministic Node tests using deferred promises:

1. A request resolves after cancellation; all returned tracks stop.
2. A late stream is not exposed to the continuation that attaches it or starts camera processing.
3. A current request returns its stream to the existing video flow; a source integration assertion checks the component's attach path.
4. Normal stream cleanup stops all three synthetic tracks.
5. A rejected cancelled request remains rejected for the caller, while source assertions verify catch/finally are guarded against stale state updates.

**These are helper-level behavior tests plus source integration assertions, not a mounted React component test.** The existing frontend test environment has React/ReactDOM but no `jsdom`, `happy-dom`, `linkedom`, `react-test-renderer`, or Testing Library renderer. A real component mount therefore is not available in the current setup. No new dependency was installed or added because doing so would change package/lock configuration and dependency setup beyond this minimal fix. No component-level test or browser behavior is claimed. This remains a specific follow-up limitation.

## Validation results

| Check | Result |
|---|---|
| Focused lifecycle tests | **PASS: 5 passed, 0 failed, 0 skipped.** `node tests/face-camera-lifecycle.test.mjs` from `frontend`. |
| Complete frontend serial suite | **PASS: 17 files, 84 passed, 0 failed, 0 skipped.** Each `.test.mjs` ran individually in sorted order using `node`; no worker pool. |
| Safe Vite validation build | **PASS (validation-only; not deployable):** Vite 7.3.7 transformed 1,933 modules. The restricted first attempt failed before transformation with Windows `spawn EPERM`; retry outside the restricted sandbox passed. Non-fatal ignored `use client` directives and >500 kB chunk warning remain. |
| `git diff --check` | PASS; existing line-ending advisories only. |
| Scoped trailing-whitespace scan | PASS on the six Phase 14A.21 changed files. |
| Browser / actual React component mount | **NOT TESTED / BLOCKED** by the lack of a DOM renderer in the existing dependency set. |
| PostgreSQL / database / credential checks | NOT TESTED and outside scope. |

### Exact commands

Run from `frontend`:

```powershell
node tests/face-camera-lifecycle.test.mjs
```

Full serial suite:

```powershell
$failed = 0; $files = 0; $passed = 0; $skipped = 0; Get-ChildItem tests -Filter '*.test.mjs' | Sort-Object Name | ForEach-Object { $files++; $output = & node $_.FullName 2>&1; $exit = $LASTEXITCODE; $passLine = $output | Select-String 'pass \d+' | Select-Object -Last 1; $skipLine = $output | Select-String 'skipped \d+' | Select-Object -Last 1; if ($passLine) { $passed += [int]($passLine.Line -replace '\D','') }; if ($skipLine) { $skipped += [int]($skipLine.Line -replace '\D','') }; if ($exit -ne 0) { $failed++; Write-Output "FAILED: $($_.Name)"; $output } }; Write-Output "FILES=$files PASSED=$passed FAILED_FILES=$failed SKIPPED=$skipped"; if ($failed -gt 0) { exit 1 }
```

Safe build, from `frontend`; Vite dotenv loading disabled, inherited `VITE_*` process variables cleared by name, and only a reserved `.invalid` API value supplied:

```powershell
$envNames = Get-ChildItem Env: | Where-Object { $_.Name.StartsWith('VITE_') } | ForEach-Object { $_.Name }; foreach ($envName in $envNames) { [Environment]::SetEnvironmentVariable($envName, $null, 'Process') }; $env:VITE_API_BASE_URL = 'https://phase14a21-validation.example.invalid'; node --input-type=module -e "import { build } from 'vite'; await build({ envFile: false });"
```

The first restricted build attempt returned `spawn EPERM` before any module transformed. The same sanitized command was retried outside the restricted sandbox and passed. The generated bundle is a validation artifact only; do not deploy it.

From repository root:

```powershell
git diff --check
```

The scoped whitespace scan inspected only `FaceCamera.jsx`, `cameraLifecycle.js`, `face-camera-lifecycle.test.mjs`, this report, `TEST_RESULTS.md`, and `FINAL_ACCEPTANCE_REPORT.md`; it found no trailing spaces or tabs.

## Final status

- **PASS:** Late stream resolution after request invalidation stops every stream track in the lifecycle helper and returns no stream for attachment. Component guards prevent subsequent attachment and stale catch/finally state updates by source inspection.
- **PASS:** Normal current acquisition returns the stream and normal cleanup stops every track; these assertions are deterministic helper-level tests.
- **BLOCKED / NOT TESTED:** A mounted React component test and browser camera verification. Current automated coverage does not independently observe React state or a real video element after unmount.
- **FAIL:** None in the final focused or complete serial runs.
- **UNKNOWN:** Runtime behavior across actual browser media permission prompts, operating-system device errors and browser unmount scheduling was not tested.
- **No unrelated files changed by this phase.** Existing modified and untracked project files were preserved.

No `.env`, secret, token, credential, DPAPI, database, PostgreSQL, migration, service, cluster, port, ACL or firewall operation occurred. No dependency was installed. No commit or push occurred. Phase 14A.22 was not started.
