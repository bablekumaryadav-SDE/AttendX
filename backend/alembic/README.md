# AttendX Alembic migrations

Alembic is being introduced for the additive Teacher profile-verification and
management-audit schema. Revision `20261125_01` is the first Alembic-managed
revision. Older dated SQL scripts remain historical/manual and are not
represented in this revision graph; do not infer their live state from files.

Install the declared backend requirements before invoking Alembic. From the
`backend` directory, use:

```powershell
..\.venv\Scripts\python.exe -m alembic -c alembic.ini current
..\.venv\Scripts\python.exe -m alembic -c alembic.ini upgrade head
```

The environment loads the existing application engine internally and does not
place the database URL in `alembic.ini`. Offline SQL generation is disabled so
credentials cannot be rendered into generated migration output.

The Teacher schema revision checks its PostgreSQL parent-key, integer-type and
nullability prerequisites before creating tables. It never backfills Teacher
ownership, account links, or profile verification. Downgrade is refused while
either new table contains data.
