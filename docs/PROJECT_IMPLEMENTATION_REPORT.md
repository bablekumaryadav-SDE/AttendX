# AttendX Implementation Status — Student/Teacher Registration and Activation

**Date:** 2026-11-10
**Overall:** Partial implementation; synthetic API/workflow checks pass. Database migrations remain DRAFT / NOT APPLIED, live PostgreSQL and real email are NOT TESTED, and production readiness is NOT CLAIMED.

## Completed in this continuation

- Added pending Student and Teacher account invitation and password-setup workflow using single-use random tokens, digest-only persistence, bounded expiry, resend revocation and transactional account activation.
- Added tenant-authorized invitation-status/resend operations and public activation route/page.
- Kept registration User/profile inactive and membership pending until the invite holder sets a password. Existing login rejects pending accounts.
- Extended the student/teacher migration draft preflight for the legacy users primary key, assignment tables/ownership columns and same-College constraints. Added a separate activation migration draft with exact membership identity FK.
- Added synthetic tests for registration, activation, login, expiry, reuse, resend, delivery failure, no SMTP configuration and cross-College invitation authorization.

## Partial or pending

- SMTP delivery is tested only through a mock; no provider is configured or contacted.
- PostgreSQL schema compatibility, migration execution and real-database persistence remain unverified. `users`, guardian, assignment and tenant ownership prerequisites must be checked on an explicitly approved local target.
- Student profile-photo/face consent and Teacher photo uploads are not implemented here; no document/photo upload or face-recognition behavior was introduced.
- Enrollment number and employee ID remain globally unique in ORM metadata, stricter than College-scoped uniqueness. A per-College uniqueness decision needs separate schema/data review.
- Academic progression is verified with synthetic SQLite only. Production/PostgreSQL history persistence is untested.
- The legacy API default-deny gate remains active, so successful activation does not claim all Student/Teacher workspace routes function.
- The complete legacy backend suite contains existing tests that expect now-blocked global APIs and fixtures with conflicting setup. See `TEST_RESULTS.md` for exact totals.

## Safety

No `.env`, credential, token store, DPAPI file or secret was read. No PostgreSQL/database/service/cluster/port operation or migration occurred. No SMTP request was sent. No production configuration was changed.
