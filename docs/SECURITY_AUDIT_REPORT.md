# AttendX Security Audit Report

**Date:** 2026-11-04  
**Scope:** Source/configuration review and isolated regression only. No live database access, migration, hosting, or deployment.

## Results

| Area | Status | Evidence / limitation |
|---|---|---|
| Password storage | PASS | `backend/app/security.py` uses bcrypt `hashpw` with generated salt and `checkpw`; input over bcrypt's 72-byte limit is rejected/does not verify. Historical hashes were not inspected. |
| JWT signature/expiry | PASS with fix | `python-jose` encodes an `exp`; decode checks expiry and `sub`. Algorithm was previously environment-selected. This audit now pins `HS256` and rejects other values. |
| JWT secret configuration | FAIL until operator configures | The local configured secret was present but shorter than 32 UTF-8 bytes (value not printed). Code now fails closed unless it is at least 32 bytes. The `.env` was not edited. Configure a fresh random secret before startup/deployment and revoke tokens by rotating it. Existing 1440-minute (24-hour) local token expiry is long for production; set a shorter value (e.g. 30–60 minutes) after checking UX/session needs. |
| Database-backed role checks | PASS in source review | `get_current_user` reloads active account and role from DB; Admin and Teacher dependencies compare the current DB role. Student/face/guardian routes additionally check role and self profile. |
| Object/role authorization | PARTIAL | Admin CRUD and guardian endpoints require Admin; teacher session routes call `_require_teacher_session_access`; analytics/report queries scope to teacher/student. Automated suites cover common denials. No independent penetration test was run. Review every legacy attendance endpoint before external exposure; legacy teacher write routes deserve focused class/subject ownership tests. |
| Guardian information | PASS for current API | Guardian GET/PUT is Admin-only and validates/normalizes fields. Responses contain personal contact data, so access logs, database backups, and operator access must be restricted. Student self-service guardian access is not exposed by this API. |
| Face image/embedding | PASS with privacy limitations | Registration requires authenticated Admin or self-student flow, explicit consent in Admin upload, 5 MiB bound, MIME/type validation and YuNet/SFace embedding; raw image/embedding are stored together in `face_embeddings`. No raw-image GET route was found; Admin student response omits bytes. At-rest encryption, retention/deletion policy, consent evidence retention, and DB backup encryption are not implemented/verified here. Liveness is absent. |
| QR tokens | PASS for protocol checks | Per-session random secret, HMAC-SHA256, constant-time signature compare, current expiry/token check, session/enrollment checks and unique `(session_id, student_id)` constraint are present. Replay is bounded by QR expiry and one attendance per session; copied token sharing cannot be prevented absolutely. |
| GPS/geofence | PASS for server-side calculation; spoofing NOT guaranteed | Server validates finite coordinate ranges, reported accuracy, radius, Haversine metres and distance. Browser-provided coordinates/accuracy remain spoofable; no device attestation. |
| Upload handling | PASS with remaining edge | Face image read is capped at 5 MiB+1 and decoded by OpenCV. Reverse proxy/server request body limits must also be configured. Content-Type is client-controlled, but model decoding/signature validation rejects invalid content in registration route. |
| CORS | PASS for policy; FAIL for production config | Explicit origins are parsed and wildcard origin rejected; credentials are enabled. Phase 9 pins methods to GET/POST/PUT/DELETE/OPTIONS and headers to Authorization/Content-Type/Accept. Current backend `.env` has no `CORS_ALLOWED_ORIGINS`, so local defaults apply. Set the exact approved HTTPS production origin before deployment. |
| Input validation | PARTIAL | Pydantic/schema and SQL parameterization are common. GIS coordinates and guardian values have checks. No repository-wide fuzzing, SQL injection assessment, or dependency/SBOM scan was performed. |
| Sensitive logs | PASS in source scan, not operationally verified | No obvious password/token/image-body prints were found in reviewed API code. Production proxy/access logs and hosting log retention are not available to inspect. Never log Authorization headers, QR tokens, request bodies, face data, or guardian phone values. |
| Frontend token storage | RISK | Axios stores/reads bearer token from `localStorage`; any successful same-origin XSS can access it. No CSP/XSS penetration test was performed. Consider HttpOnly Secure SameSite cookie architecture only as a separately reviewed change. |
| Login throttling | GAP | No rate limiting/account lockout was found in current login route. Add edge/API rate limiting before public exposure; avoid account enumeration. |
| HTTPS / security headers | NOT TESTED | No deployed Nginx/HTTPS endpoint exists in the repository. Deployment scaffold below requires operator-provided certificates and HTTPS-only access. |
| Liveness | NOT IMPLEMENTED | Face similarity/matching does not establish liveness or prevent presentation attacks. |

## Minimal source fix

- `backend/app/security.py`: require a configured secret of at least 32 UTF-8 bytes and pin the accepted JWT algorithm to HS256. Pre-edit copy is preserved at `backup_phase8_security_20261104/security.py`.
- Local `backend/.env` is unchanged. Since its current secret fails the new minimum, local API startup will require an operator-provided strong secret. No secret values are present in this report.

## Required production controls

1. Provision a cryptographically random 32-byte-or-longer secret in a secrets manager; do not commit it or place it in frontend variables.
2. Set `ALGORITHM=HS256`, short-lived access token expiry, exact `CORS_ALLOWED_ORIGINS`, HTTPS-only ingress, upload body limit, and database TLS policy.
3. Apply login throttling at ingress before public launch; alert on repeated 401/403 and 5xx without storing credentials/biometrics.
4. Encrypt database and backups at rest; define authorized staff, face-data consent/retention/deletion and breach-response procedures.
5. Restrict API docs and health detail exposure at the ingress if policy requires; health currently discloses service name/version only.
6. Verify TLS, headers, role/object authorization and backup restoration in a controlled staging environment.

## Automated evidence

Phase 7 regression recorded 44 backend tests and 21 frontend tests passing, plus a Vite production build. Phase 8 rerun results are in `docs/FINAL_ACCEPTANCE_REPORT.md`. Automated isolated tests do not replace browser/hardware/penetration/PostgreSQL verification.

## Phase 9 — configuration hardening status

| Item | Status | Evidence |
|---|---|---|
| Secret policy: minimum 32 UTF-8 bytes, HS256 only, positive configurable expiry | PASS | `validate_jwt_settings` and four JWT settings tests pass; token expiry/rejection is covered by auth tests. |
| Rotate local secret value | NOT TESTED | No `.env` write was made. Safe generation/configuration steps are in `docs/DEPLOYMENT_GUIDE.md`; the existing local key remains unchanged and below policy. |
| Separate dev and production secrets | PASS — documented | Use a per-user local secret for development and a secrets manager for production. Never reuse or put `SECRET_KEY` in `VITE_*`. |
| Explicit CORS methods and headers; credentials enabled | PASS | Middleware allows GET/POST/PUT/DELETE/OPTIONS and Authorization/Content-Type/Accept with credentials. Preflight and rejected-origin tests pass. |
| Production CORS origin | FAIL — operator config required | Production domain is unknown and `CORS_ALLOWED_ORIGINS` is unset locally. Deployment Compose requires an explicit value; retain the documented placeholder until the approved domain is known. |
| PostgreSQL isolated test server and migration execution | NOT TESTED | PostgreSQL client/server tools and Docker were unavailable in PATH. No test DB was provisioned and no migration was applied. |
| Docker/Compose/TLS | NOT TESTED | Docker is unavailable; scaffold was inspected but not executed. |
| Backend/JWT/CORS tests | PASS | Focused 10 passed; complete suite 50 passed, 26 warnings, 17 subtests. |
| Frontend tests and build | PASS | 21 tests passed; Vite build passed to D:. |

No secret was printed, logged, copied into a report, or changed. Secret replacement remains a user-run configuration step requiring a protected target and verified backup before any `.env` edit.
