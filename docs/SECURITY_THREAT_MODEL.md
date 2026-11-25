# AttendX Security Threat Model

**Status:** Initial source-based model. Mitigations below describe existing controls only where stated; this is not a penetration-test certification.

## Assets and trust boundaries

Assets include credentials and sessions, student/teacher/guardian records, attendance history, face images and embeddings, GPS coordinates, QR secrets/tokens, institution data, notification destinations, backups and deployment secrets. Trust boundaries are browser/mobile clients to API, API to PostgreSQL, tenant-to-tenant access, API to external notification/payment/storage providers, and operators to production systems.

## Threats and mitigations

| Threat | Existing controls/evidence | Required work and residual risk |
|---|---|---|
| Cross-tenant data leakage | No tenant model currently exists. | **Unmitigated.** Add tenant identity and enforce on every route, query, job, export, notification and file operation after mapping; test hostile cross-tenant IDs. |
| Privilege escalation / public self-promotion | Role is reloaded from DB; current dependencies support admin/teacher roles. | No Super Admin bootstrap, MFA or four-role matrix. Add controlled provisioning, deny public role changes, audit privileged operations and test every route. |
| QR replay / token theft | Signed time-limited session QR and duplicate attendance checks are present; DB uniqueness is migration-dependent. | Bind all session/tenant context, protect token display/transit, validate migration state, test replay/concurrency and revoke on close. |
| Attendance duplication / races | Isolated tests record duplicate rejection; SQL migration defines uniqueness. | PostgreSQL migration application is unknown. Add concurrency tests against isolated PostgreSQL and transactional idempotency. |
| GPS spoofing / false location | Server validates coordinate ranges, accuracy and Haversine distance. | Client coordinates can be spoofed; no perfect anti-spoof guarantee. Keep GPS foreground-only and avoid claiming spoof-proofing; use risk signals/manual review as policy requires. |
| Biometric data exposure | Face fields are omitted from ordinary schemas; authenticated endpoints and real server-side matching exist. | Image bytes and embeddings are stored in DB. Encryption, consent, least-privilege access, retention/deletion, audit and breach handling are not established. Liveness is absent. |
| Account takeover | bcrypt password hashing, JWT expiry/signature and account-state checks exist. | Rate limiting, secure reset flow, MFA, refresh rotation and revocation are missing/unverified. Local secret is documented as too short and backend fails closed until fixed. |
| Malicious uploads | Image decode/detection validation is present in face flow. | Review size/type limits, decompression/resource limits, metadata stripping, malware policy and storage isolation; uploads must never be publicly served. |
| Notification abuse or privacy leakage | Idempotent in-app notification records and absence enqueueing exist. | Verified multi-guardian relationships, provider queues/retries, recipient confirmation and external delivery status remain incomplete. Avoid sensitive details in messages/logs. |
| Unauthorized exports / analytics | Role-scoped analytics exists for current roles. | Tenant model absent; systematically remove unnecessary location, biometric and secret fields; enforce scoped export authorization and audit downloads. |
| XSS/token theft | React escaping and API bearer client are present. | Token is in `localStorage`; CSP is not configured per deployment report. Apply CSP after compatibility checks, sanitize untrusted HTML and review all upload/display paths. |
| Database or backup compromise | PostgreSQL driver and deployment guidance exist. | Encryption/backup access, restore drills, retention and monitoring are not verified. Use separate least-privilege credentials and encrypted, access-controlled backups. |

## Prioritized security work

1. Establish strong environment-specific secrets and exact production CORS; never commit or report secret values.
2. Complete rate limiting, recovery tokens, session lifecycle and privileged MFA.
3. Implement tenant isolation only alongside the approved data mapping and migration rehearsal.
4. Add a durable audit model for account, role, tenant approval, attendance correction and sensitive data access.
5. Minimize and protect biometric data; define informed consent, retention, deletion, access and incident procedures. Keep face optional and do not claim liveness.
6. Validate uploads, exports, notification channels, TLS, logging redaction and backup restores in staging.
7. Run independent security review and authorization tests before production.

No production system, database, provider, account or secret was accessed by this threat-model document.
