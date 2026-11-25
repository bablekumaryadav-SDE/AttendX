# Phase 14A.26 — Public Website Upgrade

**Date:** 2026-11-10
**Status:** IMPLEMENTED WITH PRODUCT WORKFLOW LIMITATIONS
**Scope:** Public landing page, its styles, document metadata, and focused frontend tests only.

## Existing-site and route audit

The existing entry point was `frontend/src/pages/LandingPage.jsx`, rendered at `/` by `frontend/src/routes/AppRoutes.jsx`. The page already used the AttendX `A` mark, violet/purple brand accent, login route, feature cards, and a CSS dashboard-style preview. The work preserves the existing React/Vite app, root route and `/login` mapping, and retains violet with navy, white and mint accents. It replaces generic claims and three-role content with the requested role coverage and explicit availability labels.

Source review found a real `/login` route, protected `/platform`, `/admin`, `/teacher`, and `/student` workspaces, and no College registration route. No public Privacy Policy, Terms, or Contact route/page and no approved public contact method or configured subscription plans/prices were found in the inspected frontend and docs. Therefore College registration is visibly marked **Planned** without a link or fake form; pricing says no plans are configured and shows “Contact Us for Pricing” as a status, not a fake checkout/contact action; contact status is unavailable; and privacy/terms links are not fabricated.

## Sections and functional behavior

Implemented/reworked:

- Responsive header with Home, Features, How it works, Benefits, About, Pricing, Contact, Login and a noninteractive planned-registration status.
- Requested hero copy, Login route and Features anchor. Registration is not submitted or routed.
- Ten feature cards with explicit public status labels, including liveness as unavailable and selected multi-College/attendance functions as partial or in development.
- An implementation-qualified workflow, four role cards, four synthetic dashboard previews, benefits, security/privacy limitations, pricing state, college onboarding state, eight native FAQ disclosures and footer.
- Preview data is synthetic and the mock UI is labeled as illustrative, not live. No real student, identity, location or attendance data is used.
- Skip link, keyboard-operable menu button with `aria-expanded`/`aria-controls`, visible focus styles, native FAQ `details`, reduced-motion support, and responsive CSS breakpoints.

| UI action or route | Behavior / status |
|---|---|
| Home | `/#home` in-page anchor and existing `/` landing route |
| Features, How it works, Benefits, About, Pricing, Contact | Anchors resolve to real section IDs |
| Login | Existing `/login` route |
| Register Your College | **Planned / unavailable**, no navigation, form or submission |
| Pricing | No configured plan or price; no checkout |
| Contact | No verified public method; no fake contact form |
| Privacy / Terms | No pages found; footer marks unavailable without dead links |
| FAQ | Native disclosure interaction |

## Feature verification classifications

Classifications are based on source and existing phase reports, not claims of full operational acceptance.

| Feature area | Classification | Public treatment |
|---|---|---|
| Dynamic QR attendance | PARTIALLY IMPLEMENTED | Legacy QR/session source exists; tenant-safe attendance writes are not enabled. |
| GPS/geofencing | PARTIALLY IMPLEMENTED | Location checks exist; spoof resistance and complete tenant operation are not verified. |
| Optional face verification | PARTIALLY IMPLEMENTED | Face workflow source and camera tests exist; optional only, with privacy/production limits. |
| Liveness / anti-spoofing | UNAVAILABLE | Explicitly states not implemented or verified. |
| Duplicate attendance prevention | PARTIALLY IMPLEMENTED | Selected protections exist; PostgreSQL validation is outstanding. |
| Attendance tracking | PARTIALLY IMPLEMENTED | Selected read views/history exist; complete tenant-safe lifecycle is not enabled. |
| Reports and analytics | PARTIALLY IMPLEMENTED | Selected summaries only; legacy report and broader analytics routes remain unavailable. |
| Guardian absence notifications | NOT VERIFIED | Source exists; tenant attribution and provider delivery are not verified. |
| Secure role-based access | PARTIALLY IMPLEMENTED | Protected role workspaces exist; not every action is available. |
| Multi-College management | IN DEVELOPMENT | Membership selection and selected reads exist; migration is DRAFT / NOT APPLIED and business writes are blocked. |

The workflow section does not present registration, Super Admin approval, College setup, attendance finalization, or report generation as a complete operational sequence. It labels the journey illustrative and identifies unavailable stages. No liveness, perfect GPS spoof prevention, notification delivery, complete tenant isolation or production security is claimed.

## Validation

**Focused mounted UI tests:** `node tests/landing-page.test.mjs` — **4 passed, 0 failed, 0 skipped**. The jsdom/ReactDOM test mounts the actual landing component with a small router adapter; it verifies rendered sections and working anchor targets, `/login` route presence in `AppRoutes.jsx`, no registration route/form, menu open/close state, native FAQ markup, all ten feature cards/statuses and four labeled illustrative previews. The adapter is not a full browser/router navigation test.

**Complete frontend serial suite:** each sorted `tests/*.test.mjs` file was invoked individually with Node `spawnSync` (no worker pool) — **19 files, 93 passed, 0 failed, 0 skipped**. The first sandbox attempts failed with Windows `spawn EPERM` when Vite/esbuild required helper processes. An out-of-sandbox focused attempt then exposed a test adapter import issue (`ReferenceError: module is not defined`); the test was corrected to use a tiny local router adapter. The final focused and complete serial runs passed. These intermediate failures are reported separately and are not final assertion failures.

**Vite production-mode validation:** from `frontend`, inherited process variables with names beginning `VITE_` were cleared without reading their values, then only `VITE_API_BASE_URL=https://phase14a26-validation.example.invalid` was set. Command:

```powershell
node --input-type=module -e "import { build } from 'vite'; await build({ envFile: false, build: { write: false } });"
```

**PASS:** Vite 7.3.7 transformed 1,933 modules and rendered chunks. `write:false` kept existing `dist` artifacts unchanged. This is validation-only and not a deployable build. Vite reported nonfatal ignored `use client` directives in dependencies.

**NOT TESTED:** Browser rendering, visual/mobile viewport inspection, assistive-technology audit, external font/network loading, real registration/contact/pricing workflows, and PostgreSQL. Responsive behavior and focus states were checked in source/CSS and component semantics, not visually exercised in a browser. No dependencies were installed.

## Regression and safety review

No changes were made to `AppRoutes.jsx`, login, AuthContext, protected routes, tenant services, backend, API gates, attendance/camera code, database/migration files or configuration. Root `/` and `/login` source mappings remain present. This phase did not change tenant authorization, default-deny behavior, database state, credentials, DPAPI, `.env`, services, clusters or ports. The validation build did not overwrite `frontend/dist`.

The worktree already contained extensive modified and untracked files before this phase. Phase 14A.26 changed only:

- `frontend/src/pages/LandingPage.jsx`
- `frontend/src/pages/LandingPage.css`
- `frontend/index.html`
- `frontend/tests/landing-page.test.mjs`
- `frontend/tests/fixtures/router-mock.jsx`
- `docs/PHASE_14A26_PUBLIC_WEBSITE_UPGRADE.md`
- `docs/TEST_RESULTS.md`
- `docs/FINAL_ACCEPTANCE_REPORT.md`

No other Phase 14A.26 file changes were found. Existing unrelated modifications and untracked files were preserved.

## Remaining website work and status

College registration/approval, subscription and pricing configuration, verified public contact, privacy/terms pages, complete tenant-safe attendance writes, full reports, and complete operational dashboards remain unavailable or incomplete. Migration remains **DRAFT / NOT APPLIED**; credential rotation A–E remains **BLOCKED / NOT APPROVED**. Production readiness is **NOT CLAIMED**.
