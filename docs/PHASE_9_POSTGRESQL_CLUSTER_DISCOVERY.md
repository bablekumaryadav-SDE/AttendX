# Phase 9 — PostgreSQL cluster discovery

**Date:** 2026-11-05  
**Discovery status:** PASS (read-only checks)  
**Existing-cluster identity:** UNKNOWN  
**Dedicated test cluster:** NOT CREATED — REQUIRES USER APPROVAL

## Findings

| Item | Finding |
|---|---|
| PostgreSQL installation | `C:\Program Files\PostgreSQL\18` |
| Exact version | PostgreSQL **18.6**, confirmed from binary file versions |
| Binary directory | `C:\Program Files\PostgreSQL\18\bin`; not on PATH |
| Binaries | `postgres.exe`, `psql.exe`, `pg_ctl.exe`, `pg_dump.exe`, and `pg_restore.exe` all exist at that directory, version 18.6 |
| Existing service | `postgresql-x64-18`, Running, Automatic, `NT AUTHORITY\NetworkService` |
| Service executable and startup arguments | `"C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" runservice -N "postgresql-x64-18" -D "C:\Program Files\PostgreSQL\18\data" -w` |
| Existing data directory | `C:\Program Files\PostgreSQL\18\data`; `PG_VERSION` is `18`; `postgresql.conf`, `postgresql.auto.conf`, `pg_hba.conf`, and `global\pg_control` exist |
| Configured port and listener setting | `postgresql.conf`: `port = 5432`, `listen_addresses = '*'`; config locations and selected non-secret settings only were inspected |
| Existing cluster identity/owner/application | **UNKNOWN**. No database connection, database listing, ownership query, credential inspection, or config secret inspection occurred. Its directory belongs to the installed PostgreSQL service, but an AttendX relationship or disposability cannot be established offline. |
| Proposed port check | `Get-NetTCPConnection` returned no listener rows for 5432 or 55432 during this check; 55432 appeared free at that moment. Recheck immediately before setup/start because port availability can change. |
| Proposed D: directories | `D:\AttendX`, `D:\AttendX\PostgreSQL-Test`, `...\cluster`, and `...\backups` do not exist. No directory was created. |
| D: permissions | D: root ACL includes `Authenticated Users: Modify`; effective rights for the eventual operator were not proven. The operator must have write/modify access to the new directories. No access probe wrote a file. |
| Existing cluster safe to reuse? | **NO.** Its identity and ownership are UNKNOWN; do not connect or use it for tests. |

`Get-CimInstance Win32_Service` returned Access Denied. The service facts above were cross-checked read-only with `sc.exe qc postgresql-x64-18` and `Get-Service`. No service was started, stopped, or changed. No PATH was changed.

## Safety result

No PostgreSQL connection, cluster initialization, database create/drop, backup, restore, migration, service change, or production data operation was performed. The running service is not considered disposable. Existing ownership evidence remains UNKNOWN and both tenant migration drafts remain DRAFT / NOT APPLIED.

## Regression results

- Backend: **102 passed, 0 failed/errors** with isolated SQLite; 12.270 seconds.
- Frontend serial: **28 passed, 0 failed, 0 skipped**; 0.588 seconds.
- Python AST syntax: **67 files passed**.
- Babel JS/JSX/MJS syntax: **53 files passed**.
- `git diff --check`: passed (README LF-to-CRLF warning only).
- The first sandboxed backend run had two environmental temp-directory permission errors; the first frontend run had seven `spawn EPERM` environment errors. No assertion failed in those attempts. Elevated retries passed; the final backend rerun after adding the secret-output test was clean 102/102.
- No build, install, cache clear, PostgreSQL test, migration, database creation, backup, or restore was run.

## Exact read-only discovery commands

Commands used included:

```powershell
sc.exe qc postgresql-x64-18
Get-Service -Name postgresql-x64-18 | Select-Object Name,Status,StartType
```

Binary presence and versions were read from `C:\Program Files\PostgreSQL\18\bin` with `Test-Path` and `Get-Item`. Selected configuration keys only were read with:

```powershell
Select-String -LiteralPath 'C:\Program Files\PostgreSQL\18\data\postgresql.conf' -Pattern '^\s*(port|listen_addresses|data_directory|config_file|hba_file)\s*='
```

Relevant path checks used `Test-Path`; port inspection used `Get-NetTCPConnection -State Listen -LocalPort 5432,55432 -ErrorAction SilentlyContinue`. ACL review used `Get-Acl -LiteralPath 'D:\'`. No sensitive environment values or database credentials were displayed.

See [POSTGRESQL_TEST_CLUSTER_PLAN.md](POSTGRESQL_TEST_CLUSTER_PLAN.md) for the proposed isolated target and approval-gated commands.
