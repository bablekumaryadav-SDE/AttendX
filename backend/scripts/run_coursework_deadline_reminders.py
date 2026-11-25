"""One-shot entry point for an external scheduler after schema approval.

Run from the backend directory on a host with the approved application
DATABASE_URL configured. Schedule this command hourly with the host's protected
task runner; it never sends email or SMS.
"""

import sys

from app.database import SessionLocal
from app.services.coursework_reminders import queue_deadline_reminders


def main() -> int:
    db = SessionLocal()
    try:
        queued = queue_deadline_reminders(db)
        print(f"Coursework deadline reminder batch complete; queued={queued}.")
        return 0
    except Exception as exc:  # Do not print DB error text or connection details.
        db.rollback()
        print(f"Coursework deadline reminder batch failed ({type(exc).__name__}).", file=sys.stderr)
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
