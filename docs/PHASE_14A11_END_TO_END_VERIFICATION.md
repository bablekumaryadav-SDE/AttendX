# Phase 14A.11 — Tenant Selection End-to-End Verification & Hardening

**Date:** 2026-11-10
**Status:** Frontend build and isolated contract tests PASS. Browser rendering NOT TESTED. PostgreSQL and migration compatibility NOT TESTED. Credential rotation A–E remains BLOCKED / NOT APPROVED.

## Review and hardening findings

- **PASS — Backend-selected authority:** `GET /tenant/memberships` derives the user from `get_current_user`, queries only that user’s active membership rows joined to active Colleges, and returns only College ID, display/official name, and membership role. Super Admin is denied; global Admin without an explicit membership sees no memberships. SQLAlchemy schema failures return a sanitized 503.
- **PASS — Per-request selector validation:** Both Subjects GET endpoints accept `college_id` as an optional query selector and pass it to `resolve_tenant_context`; that resolver checks current user, active membership, active College, and allowed membership role for every request. Without a selector, multiple memberships still return 409. Foreign/invalid IDs are denied. NULL Subject ownership is excluded from list queries; detail returns a sanitized 404 for foreign, NULL and absent records.
- **PASS — UI state and async response hardening:** Membership retrieval is deduplicated for repeated effect setup for the same authenticated identity, including React StrictMode effect replay. Logout and new login clear the request reference and selection state. Existing cancellation guards prevent obsolete membership-load callbacks from applying after an identity change. The selected College is checked against the API membership response before it becomes active.
- **PASS — Request selection consistency:** Subject list/detail services now receive the selected College ID explicitly from AuthContext and validate it as a positive safe integer before dispatch. They no longer read a mutable localStorage College ID when sending requests. The backend remains the authorization authority. Both list and detail requests send the `college_id` query parameter.
- **PASS — Switch/stale data:** The workspace route subtree is keyed by the confirmed College ID, so switching unmounts and resets page-local state. The Subjects catalog clears results when starting a load and uses a latest-request guard; old responses/errors cannot replace state after a newer request or unmount.
- **PASS — Writes and route gate:** The Subjects page and client expose only GET behavior. Subject create/update/delete client methods are absent. The specialized router contains only `GET /` and `GET /{subject_id}`. The Phase 14A.7 fail-closed router dependency remains on Subject writes and all other legacy business routers.
- **PASS — Error handling:** Membership and Subject screens distinguish 401, 403, 409 and 503. The membership listing normally returns 200/401/403/503; 409 mapping remains defensive. A missing selection is rejected in the frontend before a Subject API call. No frontend selection state grants permission.

The Node unit-test environment exposed an integration issue: direct import of the Subject service could not resolve Vite-style extensionless imports and `import.meta.env` was undefined. The service imports now include `.js`, and the API client safely defaults its environment object when running outside Vite. The Vite production build succeeds after these fixes.

## Enabled tenant endpoints

This phase did not add any business API beyond the existing read-only Subjects pilot. The current tenant-specific route set is:

| Method | Path | State |
|---|---|---|
| GET | `/tenant/memberships` | Enabled; authenticated membership discovery for selection only |
| GET | `/subjects/` | Enabled; tenant-scoped read-only list |
| GET | `/subjects/{subject_id}` | Enabled; tenant-scoped read-only detail |
| GET | `/tenant/pilot/college-profile` | Existing tenant-scoped profile route; unchanged |
| PATCH | `/tenant/pilot/college-profile` | Existing college-admin membership-scoped update route; unchanged |

`POST /subjects/`, `PUT /subjects/{subject_id}`, and `DELETE /subjects/{subject_id}` remain blocked by the default-deny legacy API gate. Every other legacy business API also remains blocked. `/tenant/memberships` is authorization-context discovery and does not list College-wide business data.

## Test and build evidence

- Backend, from `backend`: `..\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_tenant_*" -v` — **68 passed, 0 failed, 0 skipped**. In-memory SQLite, FastAPI TestClient and static tests. This includes missing College/membership/Subject schema, user and role separation, explicit and foreign selectors, ambiguous membership, NULL ownership concealment, and blocked writes.
- Frontend, from `frontend`: serial PowerShell loop invoking `node $_.FullName` for sorted `tests/*.test.mjs` files — **43 passed, 0 failed, 0 skipped** across eight test files. New service-level tests use a mocked Axios adapter to assert actual Subject list/detail GET request method, path, selected College parameter and rejection before dispatch when selection is absent. Helpers test saved-stale ID rejection, switching, duplicate membership loads, stale response guards, and 401/403/409/503 error mapping.
- Vite, from `frontend`: `npm run build` — **PASS**, Vite 7.3.7; 1,935 modules transformed. It reports ignored package-level `use client` directives and a minified JS chunk above 500 kB; these are warnings, not build failures. The first sandbox attempt failed with Windows `spawn EPERM` before transformation; retry after permission review succeeded. A subsequent real compilation error was fixed, and the final build completed successfully.
- Python syntax, from `backend`: `..\.venv\Scripts\python.exe -B -c "import ast, pathlib; files=['app/main.py','app/api/tenant_subjects.py','app/api/tenant_memberships.py','app/schemas/tenant_membership.py','tests/test_tenant_subjects_api_isolated.py','tests/test_tenant_membership_selection_isolated.py']; [ast.parse(pathlib.Path(p).read_text(encoding='utf-8'), filename=p) for p in files]; print('AST syntax PASS:', len(files), 'files')"` — PASS, six files.
- `git diff --check` — PASS, exit 0. Trailing-whitespace scan — PASS for Phase 14A.11 changed files. Existing LF-to-CRLF warnings are recorded in `docs/TEST_RESULTS.md`.

### Browser verification

**NOT TESTED.** The frontend project has no Playwright, Puppeteer, jsdom, Testing Library, or other browser/UI harness in its package lock. No dependencies were installed. The frontend tests exercised pure selection helpers and the actual Axios service functions with a mocked adapter, but did not render or interact with the React workspace. Thus empty/single/multiple membership screen rendering, actual dropdown interaction, visual stale-state transition, and rendered 409/503 banners are not claimed as browser-verified.

## Remaining blockers and limits

- PostgreSQL syntax/execution, schema state, migration, query plans, lock behavior and real-schema compatibility are NOT TESTED. Synthetic SQLite does not prove PostgreSQL behavior.
- Phase 14A.8 ownership migration remains DRAFT / NOT APPLIED. Existing NULL ownership remains UNKNOWN and hidden; no College, membership, user or ownership data was created or backfilled.
- Subject writes and all legacy business routes other than the existing Subject GET pilot remain blocked pending separate tenant-safe implementation and approval.
- Browser-rendered verification remains NOT TESTED because no project browser automation harness is installed.
- Credential rotation A–E remains BLOCKED / NOT APPROVED.

No PostgreSQL, database, credential, DPAPI file, service, cluster, ACL, application connection setting, or port operation occurred.

### Remediated validation iterations

Intermediate runs exposed and corrected a backend sanitized-503 wording mismatch in the Subject detail path, a duplicate frontend helper declaration, Node import compatibility for the Vite API module, and stale source-contract assertions after the API client refactor. The final frontend serial suite, backend suite, and production build completed successfully. The earlier Node worker `spawn EPERM` was an environmental worker-launch failure, distinct from these code/test iteration failures.
