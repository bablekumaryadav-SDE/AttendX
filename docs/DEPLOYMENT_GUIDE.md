# AttendX Deployment Guide

**Status:** Deployment scaffold prepared; no image/container was built and nothing was hosted or deployed.

## Architecture

- React/Vite is built into a static Nginx image; API requests use same-origin `/api/` and Nginx removes that prefix before proxying to FastAPI.
- FastAPI runs Uvicorn in a separate container. Face YuNet/SFace models are copied from `backend/app/models/face` into the image; confirm the configured model files are the reviewed YuNet 2023 and SFace model files. No face image volume is created: current face images/embeddings persist in the database.
- PostgreSQL is external. Compose intentionally has no database service and does not run migrations.
- Nginx redirects HTTP to HTTPS, requires operator-provided certificate files, applies basic security headers, limits upload request size to 6 MiB and hides API docs paths.

## Prepared files

- `deployment/compose.yaml`
- `deployment/backend.Dockerfile`
- `deployment/frontend.Dockerfile`
- `deployment/nginx.conf`
- `.dockerignore` excludes local `.env`, DB files, caches, node modules, backups and repository metadata from build context.

## Prerequisites

1. Docker Engine + Compose plugin on the host (not available in this audit environment).
2. A separately approved PostgreSQL service, verified backup/restore process, TLS policy and schema rollout approval. Do not start production services before the PostgreSQL plan is executed under approval.
3. DNS and valid TLS certificate/key at `deployment/certs/fullchain.pem` and `deployment/certs/privkey.pem`. Keep `deployment/certs` out of source control and restrict file permissions.
4. Secrets supplied through the deployment environment/secrets manager, never committed to the repo. Required: `SECRET_KEY` (random >=32 bytes), `DATABASE_URL`, `CORS_ALLOWED_ORIGINS` (exact HTTPS web origin). Optional: `ACCESS_TOKEN_EXPIRE_MINUTES` (recommend 30–60 minutes after product review). `ALGORITHM` is fixed to HS256.
5. Local `backend/.env` currently has a configured key that does not meet the new 32-byte minimum. The source now intentionally refuses startup until the operator provisions a strong key; the local `.env` was not altered. Its `CORS_ALLOWED_ORIGINS` is unset (development localhost fallback), and its token expiry is 1440 minutes. Replace these production settings with explicit HTTPS origins and a shorter reviewed TTL before launch.

Generate a random key on a controlled host and put it directly into a secrets manager (avoid printing it into logs/terminal history):

```powershell
$bytes = [byte[]]::new(48)
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$env:SECRET_KEY = [Convert]::ToBase64String($bytes)
# Store $env:SECRET_KEY in the host/secret manager, do not commit a .env file.
```

Use an approved environment file mechanism or secret manager to supply `DATABASE_URL` and `CORS_ALLOWED_ORIGINS`; never paste credentials in a ticket or shell transcript.

## Build and launch (operator-run only after approval)

From the repository root, after all prerequisites and database schema are approved:

```powershell
Set-Location .\deployment
$env:SECRET_KEY = '<from-secret-manager>'
$env:DATABASE_URL = '<approved PostgreSQL URL from secret manager>'
$env:CORS_ALLOWED_ORIGINS = 'https://<approved-frontend-domain>'
docker compose -f compose.yaml config --quiet
docker compose -f compose.yaml build
docker compose -f compose.yaml up -d
```

Do not execute the launch commands in this audit. The placeholders are documentation only. `up` starts services and is a deployment operation; it requires separate approval. Confirm `docker compose config` does not print secrets to shared logs before using it in CI.

## Operations and recovery

- Health: Nginx `/healthz` and internal API `/health`; Compose restarts unhealthy process exits through `unless-stopped` and health checks report status.
- Logs: `docker compose logs --tail 200 api web`; set host-side rotation/retention. Do not collect Authorization headers, request bodies, face images/embeddings, guardian contacts, or QR token values.
- Backups: use PostgreSQL managed/scheduled encrypted backups, retention policy, checksums and recurring restore drills into a separate database. Protect and test certificate and secret recovery independently. Compose does not back up the database.
- Rollback: preserve prior image tags and DB backup; roll back app image first only when schema remains backward-compatible. For schema changes follow `docs/POSTGRESQL_MIGRATION_PLAN.md`; never auto-drop/restore production data.
- Monitoring: alert on failed health checks, repeated auth failures, 5xx rates, DB connectivity, disk pressure and backup age. Confirm log redaction and on-call recovery before public exposure.
- Scale: run a single API container initially; database uniqueness protects duplicate attendance. Verify connection-pool/resource sizing before adding API replicas.

## Limitations / validation

Docker/Nginx were not installed/available here; compose syntax, image build, TLS handshake, headers, proxy path, health checks and restart behavior are **NOT TESTED**. No hosting, production credentials, live PostgreSQL, migration or real camera/GPS hardware was used. Nginx CSP is not configured; add a tested Content-Security-Policy after confirming Leaflet tiles and existing frontend behavior. Login rate limiting is also a pre-public-launch requirement.

## Phase 9 — safe JWT and CORS configuration

**No `.env` was edited.** Current local JWT key remains below the source-enforced 32-byte minimum; the API startup fails closed until a compliant value is provided. Current local CORS setting is absent (development defaults are used), and the local token lifetime is 1440 minutes. Never paste secrets into the shell command itself, terminal output, logs, reports, frontend `VITE_*`, or Git.

### Generate a new secret without printing it

Use a separate random secret for development and production. The following creates 48 random bytes and base64 encodes them (64 printable characters). It does not print the secret; it remains only in the PowerShell process environment for this session. Store it directly in a protected per-user secret manager for repeatable local use, then close the shell when finished.

```powershell
$jwtBytes = [byte[]]::new(48)
[System.Security.Cryptography.RandomNumberGenerator]::Fill($jwtBytes)
$env:SECRET_KEY = [Convert]::ToBase64String($jwtBytes)
$env:ALGORITHM = 'HS256'
$env:ACCESS_TOKEN_EXPIRE_MINUTES = '60'
```

Python-dotenv does not override an already-set process environment value, so this session value takes precedence over `backend/.env`. Use a different generated secret in production's secrets manager. Do not reuse development credentials. Rotating a key invalidates all tokens signed with its old value; users must sign in again. Keep each environment's old secret only as long as the approved rollback window requires, then revoke/delete it securely.

If the user explicitly chooses to replace `backend/.env` later, first stop the backend, make a timestamped copy in a restricted, non-repository location, verify the backup exists and its ACL is private, and only then edit the file. Do not overwrite the current `.env` or its backup automatically. `.env` is gitignored; verify `git check-ignore backend/.env` and `git status --short` without printing its contents. This Phase 9 work did not perform that replacement.

### Development and production CORS

Local Vite development uses explicit origins (set in the backend process before starting it):

```powershell
$env:CORS_ALLOWED_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173'
```

For production, replace the placeholder only after the actual approved frontend URL is known; no domain is assumed here:

```powershell
$env:CORS_ALLOWED_ORIGINS = 'https://<approved-frontend-domain>'
```

Use only origins (scheme, host, optional port); no path, query, credentials, or wildcard. Keep production CORS limited to the production frontend. The deployment Compose file requires this variable rather than silently accepting the development default.

The backend middleware now uses `allow_credentials=True`, methods `GET, POST, PUT, DELETE, OPTIONS`, and headers `Authorization, Content-Type, Accept`. These cover the frontend's current JSON/FormData requests and were checked with allow/deny preflight tests. Do not use `*` origins, methods, or headers. Re-run CORS tests whenever client methods or headers change.

### Expiry implications

`ACCESS_TOKEN_EXPIRE_MINUTES` is a positive integer and remains configurable. Local examples use 60 minutes; consider 30–60 minutes for production after UX review. Shorter expiry limits the useful window of a stolen bearer token but requires more frequent login. Longer expiry reduces interruptions but increases token exposure time. The app has no refresh-token flow, so expiration requires a fresh login. Zero, negative, or nonnumeric expiry values fail startup validation; an unset expiry defaults to 60. Missing or short secrets also fail startup validation.

### Configuration acceptance status

| Check | Status | Result |
|---|---|---|
| Secure random secret generation/configuration instructions | PASS | Non-printing 48-byte generation and per-environment storage documented. |
| Existing local `.env` rotated with verified backup | NOT TESTED | Intentionally not changed; user approval/configuration is needed. |
| Runtime secret meets minimum | FAIL locally | Current local configured secret is below 32 bytes; source refuses it. |
| Production CORS domain configured | NOT TESTED | Actual domain unknown; placeholder only. |
| CORS middleware methods/headers/credentials | PASS | Explicit allowlists; focused preflight/deny tests pass. |
| Production TTL selected | NOT TESTED | Local value is 1440; production choice remains operator decision. |

## Phase 9 configuration and deployment validation

| Item | Status | Evidence |
|---|---|---|
| C: free space before build is at least 1.5 GiB | PASS | Checked before build; result recorded in final acceptance update. |
| Docker availability | NOT TESTED / unavailable | `docker` command was not found. No container build or launch. |
| Compose restart and health configuration | PASS — source inspection | API/web use `restart: unless-stopped` and health checks in `deployment/compose.yaml`; not executed. |
| Nginx TLS and proxy config | NOT TESTED | Source inspected; no Nginx binary/certificates, so syntax/TLS/proxy were not exercised. |
| Required deployment environment names | PASS — source inspection | Compose requires `SECRET_KEY`, `DATABASE_URL`, `CORS_ALLOWED_ORIGINS`; fixes HS256 and supports TTL. Frontend API base is `/api`. No secret values reported. |
| Hosting/production deployment | NOT PERFORMED | No service launch, domain or live DB connection. |
