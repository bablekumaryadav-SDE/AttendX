# Student and Teacher Account Activation

**Date:** 2026-11-10
**Implementation status:** Implemented and covered by synthetic SQLite/API tests. Real SMTP and PostgreSQL are NOT TESTED.

## Flow

Tenant College Admin creates a Student or Teacher through the existing tenant registration endpoint. The User, profile, pending CollegeMembership, academic/assignment records commit with the user and profile inactive. If SMTP configuration is complete, the service generates a cryptographically random one-time token, persists only its SHA-256 digest, and sends an activation URL by STARTTLS email. If mail is unconfigured, registration remains pending and returns `invitation_status: not_configured`; it does not claim delivery. Delivery failures return a failure status and safe invitation-ID-only log entry.

The public `POST /account-activation/complete` endpoint validates token shape and a 12–72-byte password with upper/lowercase, digit and symbol, locks the pending membership and invitation, checks expiry/revocation/consumption/College status and the same-College Student or Teacher record, then atomically stores the existing bcrypt hash and activates User, profile and membership. The token is marked consumed in the same transaction. Pending account credentials fail the existing login route. Activation does not create or activate unrelated roles.

The emailed link carries the token in a URL fragment. The activation page removes the fragment from browser history before sending the token, never stores it in localStorage, confirms the two password fields, uses the shared Axios client without attaching an existing bearer token, and displays a sanitized status.

## Invitation operations

- `GET /students/{student_id}/invitation` and `GET /teachers/{teacher_id}/invitation` return state/expiry only.
- `POST /students/{student_id}/invitation/resend` and `POST /teachers/{teacher_id}/invitation/resend` revoke previous unused invitations and issue a fresh one.
- All four operations require the authenticated caller's active College Admin membership and selected College; profile and membership must match that College.
- Raw tokens, password values and password hashes are not returned to College Admin. The Admin has no password-setting operation.
- `ATTENDX_ACTIVATION_TTL_HOURS` is bounded to 1–168 hours; invalid/missing configuration falls back to 24 hours. SMTP values are read at delivery time only; configured names are `ATTENDX_ACTIVATION_SMTP_HOST`, `_PORT`, `_USERNAME`, `_PASSWORD`, `ATTENDX_ACTIVATION_FROM_EMAIL`, and `ATTENDX_PUBLIC_URL`. Values are not recorded here.
- SMTP uses TLS certificate validation with STARTTLS. Real email provider compatibility and message delivery are NOT TESTED.

## Verification

Synthetic SQLite tests cover Student and Teacher registration/activation, subsequent Student login, pending login denial, one-time use, expiry, password requirements, resend revocation, missing mail configuration, simulated delivery failure, Admin status without token exposure, and College B denial for College A invitation state. The draft invitation schema has a same-membership composite FK and token digest; PostgreSQL execution is NOT TESTED.

## Limits and status

- PostgreSQL migration `DRAFT_20261112_account_activation_invitations.sql`: **DRAFT / NOT APPLIED**.
- Real local-database persistence/login: **NOT TESTED**.
- Real SMTP delivery: **NOT TESTED** (only mocked delivery).
- Existing tenant legacy API gate remains in place; successful sign-in does not imply every student/teacher business API is enabled.
- Production readiness: **NOT CLAIMED**.
