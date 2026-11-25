# Legacy Unassigned Data Policy

**Status: policy implemented; no legacy row has been assigned or queried. Ownership remains UNKNOWN.**

1. Existing users, profiles, classes, subjects, assignments, attendance, sessions, QR/audit events, face records, guardian contacts and notifications remain in the legacy application with no guessed College assignment.
2. Do not infer ownership from email, email domain, name, department, global role, academic-year label, IDs, local configuration, or a presumed single-college deployment.
3. Legacy login and attendance continue through their existing routes and global `User.role`. Tenant-context dependencies are opt-in for new scoped operations only; this phase does not apply them to legacy routes.
4. The additive ORM models create no tenant rows or legacy foreign keys. No startup hook auto-creates a College. Existing records and attendance/face/GPS/QR/guardian data are not altered.
5. Before future backfill, a data owner must provide official College identity, reproducible primary-key inventory, record-level/cohort evidence, relationship closure checks, conflict/orphan report, independent approval, and a verified restore into isolated PostgreSQL.
6. During any later migration, unresolved rows must remain explicitly unassigned and be excluded from tenant-scoped operations. Do not force a non-null ownership constraint until every included record is approved; preserve unresolved data for reviewed remediation.
7. Compare counts and primary-key-set hashes before and after backfill, validate all parent/child tenant relationships, and stop on any ownership ambiguity or mismatch.

See `LEGACY_COLLEGE_OWNERSHIP_TEMPLATE.md`, `PHASE_4_OWNERSHIP_EVIDENCE.md`, and `TENANT_MIGRATION_PLAN.md` for evidence and gates.
