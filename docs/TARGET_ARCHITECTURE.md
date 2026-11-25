# AttendX Target Architecture

**Status:** Proposed target based on the current React/Vite + FastAPI/SQLAlchemy stack. The multi-tenant architecture is not implemented yet.

## Components

```text
Public website / role dashboards                 Android app (future native client)
                    \                              /
                     \ HTTPS + common JWT API     /
                      AttendX FastAPI backend
                     /          |          \
          PostgreSQL       notification     file/object storage
          shared tenant    providers         (private, tenant scoped)
```

The web client and a future Android client use the same account, API authorization and central database. Attendance, academic records and authorization decisions remain server-side. Do not introduce a second attendance database or trust a client-supplied role, college, status or student identifier as authorization.

## Current state

Current clients are a React/Vite web application and the FastAPI API. A single `DATABASE_URL` configures SQLAlchemy. Authentication issues JWTs, and request authorization reloads a user's current role from the database. Current application roles are `admin`, `teacher` and `student`. There is no native Android app, tenant model, tenant context, application/onboarding workflow, refresh-token store, or verified production topology.

## Target identity and tenant model

- `College` is the tenant root, with lifecycle state and settings.
- Each college-scoped user/profile and academic/attendance record is linked to one college directly or through a validated parent relationship.
- Platform operators use a distinct `super_admin` permission set. They do not inherit current legacy `admin` permissions or raw college/student data access. A future `college_admin` membership is scoped to one active college. Teacher and student access is scoped to their own verified college membership and assignments/enrollment.
- Keep `users` as the platform-wide login identity. Resolve college scope through a future active `college_memberships` relationship; do not overload one global `users.role` value to represent platform role and multiple college roles.
- A guardian is a verified relationship to one or more student records; no guardian dashboard/login is in scope.
- Tenant context comes from the authenticated database user/profile and is revalidated on each request. Client parameters may identify a resource but cannot select an authorization tenant.
- Queries, background jobs, exports, notifications, storage keys and administrative actions must all carry an explicit tenant scope. Cross-tenant access should fail closed.

The current data does not identify the owner college. Tenant fields and data backfill must wait for an owner-approved mapping, an isolated PostgreSQL rehearsal, and a tested recovery path; see `TENANT_MIGRATION_PLAN.md`, `TENANT_ENTITY_OWNERSHIP_MATRIX.md` and `LEGACY_DATA_RECONCILIATION_PLAN.md`.

## Authentication and request flow

1. The client sends credentials to the common login endpoint over HTTPS.
2. The backend verifies the password hash, account state and any required privileged MFA.
3. The backend issues a short-lived access token; a refresh-token/session record with rotation and revocation is a target requirement, not currently implemented.
4. Every request validates the token and reloads current account status/permissions from the database.
5. Backend authorization resolves the user’s college membership and checks both tenant ownership and resource-level assignment/enrollment.
6. Sensitive writes execute in transactions and produce audit events; retries use idempotency where applicable.
7. Logout, password changes, suspension and privileged changes revoke sessions. Current token revocation is not available, so this remains a security gap.

## Attendance flow

Teacher opens a lecture/session. Backend binds the session and signed, expiring QR to the lecture/college and validates teacher assignment. Student submits QR, foreground GPS data when policy requires it, and optional face verification only when enabled and consented. Backend derives student identity from authentication, checks enrollment/session/time/tenant, validates inputs, and writes an idempotent attempt/final attendance record transactionally. GPS is not needed for ordinary login or timetable access. Face matching is not liveness detection. Notification events are queued only after eligible finalization and delivered only through configured providers with confirmed provider status.

## Integrations and operations

Email, SMS, WhatsApp, FCM, payment, object storage, monitoring and backups are external integrations. Configuration and secrets belong in environment-specific secret stores. Missing providers must report `NOT CONFIGURED`; no simulated delivery/payment is acceptable. Development, staging and production have separate databases, secrets, origins, storage and provider credentials.

## Architecture gates

1. Agree on role permissions and explicit college ownership for legacy records.
2. Design and rehearse additive tenant migrations in a separate PostgreSQL database.
3. Implement backend authorization and tenant-aware operations before exposing tenant selection in UI.
4. Complete onboarding, invitation and account lifecycle flows.
5. Decide on native Android architecture only after a documented client/API contract; no Android project is currently present.
6. Validate migration recovery, security, providers, deployment and device workflows in staging. Production readiness is not established.
