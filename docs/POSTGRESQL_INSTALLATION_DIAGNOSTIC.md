# PostgreSQL Installation Diagnostic

**Read-only result (2026-11-05):** PostgreSQL 18.6 is installed. Its Windows service is running. This does not establish that its data is disposable or safe for migration rehearsal.

## Service configuration evidence

| Property | Observed value |
|---|---|
| Service name | `postgresql-x64-18` |
| Display name | `postgresql-x64-18 - PostgreSQL Server 18` |
| State / start mode | Running / Automatic |
| Service account | `NT AUTHORITY\NetworkService` |
| Service executable | `C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe` |
| Startup command | `runservice -N "postgresql-x64-18" -D "C:\Program Files\PostgreSQL\18\data" -w` |
| Installation directory | `C:\Program Files\PostgreSQL\18` |
| Data directory | `C:\Program Files\PostgreSQL\18\data` |
| Cluster markers | Directory and `global\pg_control` exist; `PG_VERSION` contains `18`; `postgresql.conf` and `pg_hba.conf` exist. Their contents were not read. |

The service command contains no credentials. No database name, owner, active port, search path, or cluster contents were inspected. The cluster's identity/use remains **UNKNOWN**. It is not treated as a disposable test cluster.

## Client binaries and PATH

All requested binaries exist at version 18.6:

| Binary | Path |
|---|---|
| `postgres.exe` | `C:\Program Files\PostgreSQL\18\bin\postgres.exe` |
| `psql.exe` | `C:\Program Files\PostgreSQL\18\bin\psql.exe` |
| `pg_dump.exe` | `C:\Program Files\PostgreSQL\18\bin\pg_dump.exe` |
| `pg_restore.exe` | `C:\Program Files\PostgreSQL\18\bin\pg_restore.exe` |
| `pg_ctl.exe` | `C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe` |
| `initdb.exe` | `C:\Program Files\PostgreSQL\18\bin\initdb.exe` |
| `createdb.exe` | `C:\Program Files\PostgreSQL\18\bin\createdb.exe` |

The PostgreSQL `bin` directory is **not on the current PATH**. For a future PowerShell session only, after choosing to use these tools:

```powershell
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$env:PATH = "$pgBin;$env:PATH"
Get-Command psql,pg_dump,pg_restore,pg_ctl
```

This changes only the current process environment. It was not run in Phase 8. No system/user PATH, PostgreSQL service setting, installation, or file was changed. Persistent PATH changes or any service/cluster administration require the user's explicit approval.

## Safety result

The cluster data directory is locatable from the service configuration, but its identity and contents are not verified. Do not connect, create/drop databases, or rehearse migrations there until the user explicitly approves a dedicated test target and its identity is positively verified.
