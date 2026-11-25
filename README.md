# AttendX

AttendX is a college attendance web application with a React/Vite frontend and a FastAPI/SQLAlchemy backend. The current app includes Admin, Teacher and Student roles, session QR attendance, classroom geofence checks, face registration/matching, reports and in-app notifications.

The repository contains a **partial multi-college tenant implementation** for explicitly reviewed API routes, College membership selection and tenant-scoped dashboards. The tenant schema migration remains DRAFT / NOT APPLIED, and the actual configured PostgreSQL schema has not been validated in this continuation; therefore application-level tenant behavior and production readiness are not established. This project is **not production-ready** for the complete multi-college SaaS requirements. Subscription management and a native Android project are not established. See the [master audit](docs/MASTER_REQUIREMENT_AUDIT.md) and current [continuation report](docs/MASTER_IMPLEMENTATION_CONTINUATION_2026-11-12.md) for the verified feature matrix and blockers.

## Repository layout

- `backend/` — FastAPI API, SQLAlchemy models, services and isolated backend tests.
- `frontend/` — React/Vite website and dashboards.
- `database/migrations/` — versioned SQL scripts; no automated migration ledger/runner was identified.
- `deployment/` — Docker Compose, container and Nginx configuration scaffold; not runtime validated.
- `docs/` — audit, test evidence, security, migration and deployment reports.

## Prerequisites

- Windows PowerShell.
- Python environment with packages from `backend/requirements.txt` (the current checkout has a root `.venv`).
- Node.js/npm and the existing frontend dependencies (`frontend/node_modules` may already be present).
- PostgreSQL configured by `backend/.env` for normal backend operation. Never commit or print `.env` values.

## Local development

Open two PowerShell terminals from this repository directory. The backend requires valid database configuration and a strong `SECRET_KEY` (at least 32 bytes); it fails closed if JWT settings are weak.

Backend:

```powershell
Push-Location .\backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
Pop-Location
```

Frontend:

```powershell
Push-Location .\frontend
npm run dev
Pop-Location
```

The frontend uses Vite's default local URL (`http://localhost:5173`); the API defaults are configured in `frontend/src/services/api.js`. Production requires an approved HTTPS API origin and explicit backend CORS origins. Do not use a laptop's `localhost` as a physical phone API address.

## Automated checks

Backend isolated tests (from the repo root):

```powershell
$env:DATABASE_URL = 'sqlite://'
$env:SECRET_KEY = 'test-only-secret-use-at-least-32-bytes-long'
$env:ALGORITHM = 'HS256'
$env:CORS_ALLOWED_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173'
Push-Location .\backend
..\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_*.py' -v
Pop-Location
Remove-Item Env:\DATABASE_URL,Env:\SECRET_KEY,Env:\ALGORITHM,Env:\CORS_ALLOWED_ORIGINS
```

The backend test fixtures use isolated SQLite databases. These checks do not validate PostgreSQL migrations or production data.

Frontend tests (from `frontend`):

```powershell
node --test --test-concurrency=1 tests/*.test.mjs
```

Build only when C: has at least 1.5 GB free, as required by the project brief:

```powershell
Push-Location .\frontend
$env:TEMP = 'D:\Temp'
$env:TMP = 'D:\Temp'
$env:npm_config_cache = 'D:\Temp\npm-cache'
npm --cache 'D:\Temp\npm-cache' run build -- --outDir 'D:\Temp\AttendX-build'
Pop-Location
```

## Database and migrations

Do not run SQL migrations against production from this README. The migration state of any configured database must first be inspected and verified, and tenant ownership must be mapped explicitly. Follow [PostgreSQL Migration Plan](docs/POSTGRESQL_MIGRATION_PLAN.md) and [Tenant Migration Plan](docs/TENANT_MIGRATION_PLAN.md). The tenant migration is currently blocked because existing records have no institution ownership.

## Super Admin bootstrap

The guarded bootstrap command is implemented but has **not been executed**. It is limited to a local development PostgreSQL database, requires an existing audit table, prompts for the password without echoing it, and refuses existing accounts. Follow [Super Admin Bootstrap Guide](docs/SUPER_ADMIN_BOOTSTRAP_GUIDE.md). It does not provide production provisioning or platform operations.

## Project status and privacy

- Do not interpret source presence or isolated SQLite test passes as production readiness.
- Face matching is not liveness detection; genuine positive face matching and biometric retention controls are not verified.
- GPS checks are server-side but cannot guarantee spoof prevention.
- Notifications are not proof of external delivery unless a configured provider confirms delivery.
- No production migration, database write, deployment, provider activation, backup restore drill or physical Android test has been performed.
- Keep passwords, JWT secrets, database URLs, face images, embeddings, QR tokens and private student locations out of Git, logs and reports.

Read [Master Requirement Audit](docs/MASTER_REQUIREMENT_AUDIT.md), [Target Architecture](docs/TARGET_ARCHITECTURE.md), [Security Threat Model](docs/SECURITY_THREAT_MODEL.md), and [Deployment Guide](docs/DEPLOYMENT_GUIDE.md) before planning further work.

## 2026-11-12 verification note

The source registers the tenant `GET /teachers/` API and the frontend calls that route with the selected College. Synthetic ASGI tests pass, but the reported 404 from an already-running local server has not been reproduced or diagnosed against that process. Synthetic SQLite tests also exercise active-session visibility, QR submission, Student history and Teacher live monitoring; they are not PostgreSQL or browser acceptance. Current full-suite results and outstanding limits are recorded in [the continuation report](docs/MASTER_IMPLEMENTATION_CONTINUATION_2026-11-12.md) and [test results](docs/TEST_RESULTS.md). Do not treat these checks as production readiness.


### Teacher registration limitation (2026-11-12)

Teacher creation is tenant-scoped at `POST /teachers/`; the backend generates the employee ID, hashes the permanent password, validates same-College active Class/Subject records, and commits Teacher/User/membership/assignment records transactionally when the required schema is present. Assignment-bearing registration requires the effective-date columns from the DRAFT / NOT APPLIED relationship-date migration. Without them, the server returns 503 before creating partial account records. Do not apply that migration without separate review and approval. Actual PostgreSQL/browser behavior remains unverified. See the current continuation report.
