# Phase 14A.10 — Explicit College Membership Selection & Subjects Frontend Integration

**Date:** 2026-11-09
**Status:** Implemented and behavior-tested with synthetic SQLite and frontend unit tests. PostgreSQL validation is NOT TESTED. Credential rotation A–E remains BLOCKED / NOT APPROVED.

## Selection and authorization contract

`GET /tenant/memberships` requires the normal authenticated bearer token. It returns only the current user's active memberships joined to active Colleges, in deterministic order. Each result contains exactly `college_id`, `college_name` (display name with official-name fallback), and `membership_role`. It does not return membership IDs, other users, activation/audit fields, or global roles. A global Admin role by itself produces an empty list; Super Admin receives 403 and no implicit College context. Missing tenant tables return a sanitized 503.

For the existing tenant Subjects reads, the selected College is sent as the `college_id` query parameter, for example `GET /subjects/?college_id=92` and `GET /subjects/802?college_id=92`. This matches the existing `/tenant/pilot/college-profile?college_id=...` convention and `resolve_tenant_context(requested_college_id=...)`. The ID is only a selector: every request resolves the current active user, active membership and active College from the database. A foreign, inactive, absent, or invalid selection cannot grant access. If the caller omits the selector and has multiple active memberships, the API preserves 409. A user with exactly one membership can still be resolved by the shared resolver when no selector is supplied; this is not a client-controlled default.

The Phase 14A.9 implementation had not declared a Subject query parameter, so any supplied `college_id` was ignored and multiple memberships remained ambiguous. Phase 14A.10 makes that parameter explicit and tested. It does not change the tenant resolver or add a second authorization system.

## Frontend behavior

After authentication, `AuthContext` loads `/tenant/memberships`. It accepts a stored `attendx_college_id` only if that ID appears in the response. One confirmed membership may be selected automatically; multiple memberships require an explicit choice unless a previously stored choice is still confirmed. Empty or failed membership discovery clears the stored selection. Users can switch College in the authenticated workspace header.

The workspace withholds its route content while membership discovery is pending or while a choice is required, so tenant requests are not sent prematurely. The React subtree is keyed by the selected College; switching remounts the route content and drops prior in-memory page state. Subject GET service calls require a positive safe-integer selection and send it as `college_id`. The Admin Subjects page now displays a read-only catalog and only calls `GET /subjects/`; the Subject create/update/delete client methods were removed. Subject writes remain blocked by the Phase 14A.7 server gate. Other business APIs are not enabled by this frontend change.

Membership discovery errors map 401, 403, 409 and 503 to distinct user messages. The Subject catalog handles the same response classes with clear session, membership, selection and unavailable-schema messages. A 401 membership error offers sign-in again.

## Route authorization status

| Method and route | Authorization / scope | Status |
|---|---|---|
| `GET /tenant/memberships` | Authenticated current user; active membership + active College only; minimum selection fields; Super Admin denied | ENABLED; synthetic SQLite behavior tests |
| `GET /subjects/` | Existing tenant context; optional `college_id` selector validated against current memberships; College ownership filter; NULL/UNKNOWN ownership excluded | ENABLED; tenant-scoped read only |
| `GET /subjects/{subject_id}` | Same context and selector validation; foreign, unknown and absent records use the existing sanitized not-found behavior | ENABLED; tenant-scoped read only |
| `POST /subjects/`, `PUT /subjects/{subject_id}`, `DELETE /subjects/{subject_id}` | Legacy handler remains behind Phase 14A.7 default-deny dependency | BLOCKED; expected sanitized 503 |
| All other mounted legacy business API routes | No new tenant router exemption; existing fail-closed gate remains | BLOCKED; unchanged |
| Existing `/tenant/pilot/college-profile` GET/PATCH | Existing tenant-context pilot, outside the legacy business gate; not modified here | Existing behavior; not a new enablement |

The membership discovery route is a safe authorization-context endpoint, not an additional College business-data API. No broad router exception was introduced. College Admin membership role remains distinct from the global `admin` role; Super Admin remains a separate platform role.

## Legacy data and migration safety

No College, membership, user, Subject, or ownership records were created or modified by this phase. No default College, role promotion, or legacy ownership backfill exists. Subject rows whose `college_id` is NULL remain UNKNOWN and are not returned. Business APIs other than the two approved Subject GET routes remain gated. Ownership reconciliation remains a future manual, evidence-based process.

## Validation evidence and limits

- Backend tenant suite: **67 passed, 0 failed, 0 skipped**, using in-memory SQLite, FastAPI TestClient, and static tests. It covers active/current-user membership listing, inactive/suspended exclusion, role separation, missing-schema 503, explicit selected College, invalid/foreign selection denial, ambiguity 409, and blocked Subject writes.
- Frontend serial test files: **37 passed, 0 failed, 0 skipped**. The tests cover membership-choice helper behavior, saved invalid choices, switch authorization, keyed tenant view changes, error mapping, and read-only Subject wiring.
- `node --test tests/*.test.mjs` initially could not spawn the Node test worker processes (`spawn EPERM` on this environment), so no assertions ran in that invocation. Running each file serially as a direct Node process completed successfully; this was an environment/runner failure, not an assertion failure.
- Python syntax command, from `backend`: `..\.venv\Scripts\python.exe -B -c "import ast,pathlib; files=['app/main.py','app/api/tenant_subjects.py','app/api/tenant_memberships.py','app/schemas/tenant_membership.py','tests/test_tenant_subjects_api_isolated.py','tests/test_tenant_membership_selection_isolated.py']; [ast.parse(pathlib.Path(p).read_text(encoding='utf-8'), filename=p) for p in files]; print('AST syntax PASS')"` — PASS. No bytecode was written.
- Frontend serial command, from `frontend`: `$failed=0; Get-ChildItem tests -Filter '*.test.mjs' | Sort-Object Name | ForEach-Object { & node $_.FullName; if ($LASTEXITCODE -ne 0) { $failed++ } }; if ($failed -gt 0) { exit 1 }` — PASS, 37 tests.
- `git diff --check` — PASS, exit 0. Git reported existing LF-to-CRLF working-copy warnings for three text files.
- Trailing-whitespace scan — PASS for all 18 Phase 14A.10 changed code, test, and report files.
- SQLite and static tests do NOT establish PostgreSQL syntax/execution, migration compatibility, locks, query plans, or behavior against any deployed schema.

Frontend tests run Node unit files without a browser/DOM renderer. The selection helpers and read-only API wiring are behavior-tested; the React workspace switch's state reset relies on the selected-College React key remount and was not exercised in a real browser session.

## Remaining blockers

Phase 14A.8 tenant ownership migration remains DRAFT / NOT APPLIED. No migration rehearsal, PostgreSQL connection, production schema review, or PostgreSQL test is authorized or reported as completed here. Subject writes and every other legacy business API remain blocked pending dedicated tenant-scoped implementation, tests, migration review, and separate approval. Legacy ownership remains UNKNOWN until manually reconciled. Credential rotation A–E remains **BLOCKED / NOT APPROVED**.

No database, PostgreSQL service/process/cluster/port, credential, DPAPI file, ACL, application connection setting, migration, backup, or restore was accessed or operated in this phase.
