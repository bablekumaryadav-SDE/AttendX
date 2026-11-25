# Super Admin Bootstrap Guide

## Implementation status

- **IMPLEMENTED:** `backend/scripts/bootstrap_super_admin.py` supports a one-time local development bootstrap for `by706734@gmail.com`, display name `Bablu Kumar Yadav`, role `super_admin`.
- **IMPLEMENTED:** Hidden interactive password entry and confirmation; bcrypt hashing through the existing security helper; minimum 12 characters and maximum 72 UTF-8 bytes; existing accounts are not modified; any existing Super Admin blocks creation; account and audit event are in one PostgreSQL transaction.
- **IMPLEMENTED:** Script refuses non-PostgreSQL targets, non-loopback PostgreSQL hosts, missing/mismatched audit schema, and anything without `ATTENDX_BOOTSTRAP_ENV=development` plus a typed confirmation.
- **NOT EXECUTED:** No account was created or promoted. This guide does not claim account creation.
- **NOT IMPLEMENTED:** MFA, recovery, Super Admin operational controls, and production bootstrap procedure. The current page is a protected sign-in landing only.
- **VERIFIED (isolated guard tests):** Missing environment marker, SQLite target and non-loopback PostgreSQL URL are refused before DB inspection/session creation. No PostgreSQL connection was made during these tests.

## Preconditions

1. Use the active `AttendX` checkout and its intended **local development** PostgreSQL database on `localhost`, `127.0.0.1` or `::1`. The script refuses other host names, but a local proxy could still forward elsewhere; verify the selected database independently before continuing. Do not point the command at staging or production.
2. Configure `backend/.env` with the local `DATABASE_URL` and a strong `SECRET_KEY` of at least 32 bytes; the password helper loads current security settings. Never paste secrets into shell commands or print `.env`.
3. The existing `attendance_audit_logs` schema from `20261101_add_session_face_attendance.sql` must already exist in this local database. The bootstrap does not run migrations.
4. Do not use this command to promote an existing account. Existing owner email or any existing `super_admin` causes a safe refusal. Account recovery/promotion needs a separately reviewed process.

## PowerShell commands

From the repository root:

```powershell
$env:ATTENDX_BOOTSTRAP_ENV = 'development'
Push-Location .\backend
..\.venv\Scripts\python.exe .\scripts\bootstrap_super_admin.py
Pop-Location
Remove-Item Env:\ATTENDX_BOOTSTRAP_ENV
```

The script asks you to type `DEVELOPMENT`, then prompts twice for a hidden password. The password is not an argument, environment variable, log value or API response. It requires PostgreSQL and rolls back both user and audit event if either write fails. It intentionally does not print the database URL.

## Verify without exposing credentials

The success message means the transaction committed. To check later, use an authorized database client and query only role/status/name/email and the corresponding audit action; never select `hashed_password`, print connection strings, or include credentials in screenshots/logs. Alternatively sign in at the common AttendX login page and confirm the protected `/platform` landing appears. The script was **implemented but not executed** in this workspace.

## Current limitation

This creates a distinct role in the existing shared authentication table. The platform landing page does not yet implement college onboarding, approvals, subscriptions, audit browsing or operational permissions. No role promotion endpoint is added. The current Super Admin account cannot use the old College Admin dashboard.
