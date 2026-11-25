# Legacy Data Reconciliation Plan

**Status: BLOCKED / DESIGN ONLY.** No source database was connected, no records were inspected, and no ownership mapping has been provided. This is a manual evidence/review process, not a migration script.

## Objective and invariant

Map every existing record to a verified legal institution without losing, merging, exposing or silently reassigning records. Preserve source primary keys, attendance history, guardian relationships, biometric data, notification state and audit history. If ownership is not supportable from evidence, leave the record unresolved and stop tenant enforcement for that data set; never create an invented default tenant.

Use `LEGACY_COLLEGE_OWNERSHIP_TEMPLATE.md`. Keep row-level evidence extracts and student PII in restricted storage; the worksheet should contain stable record references, redacted evidence identifiers and approvals only.

## Reconciliation phases

### A. Establish a safe source snapshot

1. Identify the exact source environment through an approved operator; do not disclose `DATABASE_URL` or credentials in reports.
2. Obtain an approved, consistent read-only export or backup. Record a non-secret environment fingerprint, snapshot time, schema/migration ledger (if any), table row counts and hashes of sorted primary-key sets.
3. Verify restoration into a separate isolated PostgreSQL test database. Do not rehearse against the configured or production database.
4. Freeze or record a source write boundary for any future cutover; no live cutover is part of this phase.

### B. Inventory and relationship closure

5. Enumerate all current ORM and migration-managed tables, including user profiles, assignments, legacy/session attendance, guardian contacts, face rows, notifications and audit entries. Record tables, columns, PK/FK definitions, unique constraints, sequence state and orphan counts.
6. Generate controlled reports of duplicate identifiers, missing parents, cross-reference inconsistencies and unlinked users/profiles. Do not expose biometric payloads, password hashes or secret values in these reports.
7. Build candidate cohorts only where a reproducible query plus authoritative evidence establish ownership. A department name, email domain, city string or a human assumption is not enough.
8. Check relationship closure for each proposed tenant: students↔enrollments↔classes, teachers↔assignments↔subjects/classes, sessions↔QR/attendance events, guardians↔students, and notifications/audits↔their source entity.

### C. Human review and conflict resolution

9. Record each source primary key or exact reproducible cohort in the template, with evidence provenance, confidence, preparer and reviewer.
10. Assign `MAPPED` only after evidence review. Classify unresolved rows as `AMBIGUOUS`, `ORPHANED` or `CONFLICT`; classify explicitly out-of-scope data as `REJECTED` only with documented owner approval and retention handling.
11. Resolve duplicates and conflicts with the owner and record a signed decision. Do not merge users or change global email identity to force uniqueness.
12. Require independent second-person review of all high-impact cohorts and a final owner sign-off for each institution mapping.

### D. Reproducible dry run

13. Freeze the approved mapping as a versioned, access-controlled artifact. Record its SHA-256, evidence references, source snapshot hash, reviewer and approval timestamp.
14. Generate a dry-run report (no writes) listing source table, source PK, proposed college, relation checks, expected new constraints, duplicates/orphans and before/after row/key counts.
15. Require zero unmapped in-scope rows, zero cross-college relationship candidates and zero unexplained count/key differences before migration design is approved. A deliberate exception must be excluded or deferred with written approval; never silently assigned.

### E. Isolated PostgreSQL rehearsal and recovery

16. Rehearse proposed additive migrations on a restored isolated PostgreSQL database with the approved mapping. Verify backups and restore path before rehearsing.
17. Validate row counts and sorted PK hashes for each table, composite foreign keys, tenant-scoped uniqueness, indexes, query plans, QR idempotency/duplicate behavior, reports and all TEN-CTX/TEN-IDOR/TEN-ATT/TEN-FACE/TEN-GUARD/TEN-REPORT negative tests in `TENANT_AUTHORIZATION_DESIGN.md`.
18. Test migration failure halfway through a transaction/batch, retry and rollback. Retain an immutable before-snapshot and write a tenant assignment ledger with source key, target college, mapping batch/version, actor and timestamp. Do not delete source provenance.
19. Document recovery as restore-to-new-database and controlled application rollback; avoid destructive reverse migrations. Compare results before accepting the rehearsal.
20. Only a future separately authorized production phase may schedule maintenance, final backup, write freeze, migration, verification and rollback window. This plan does not authorize that work.

## Conflict report format

| Source table | Source PK/cohort | Issue | Evidence references | Candidate institution(s) | Impact | Decision owner | Resolution/status |
|---|---|---|---|---|---|---|---|
|  |  | `DUPLICATE / ORPHAN / AMBIGUOUS / CROSS-REFERENCE / OTHER` |  |  |  |  | `OPEN` |

## Stop conditions

Stop and preserve the snapshot if evidence is missing or contradictory, row counts/key hashes differ, parent references are orphaned, tenant-scoped unique keys collide, a cross-tenant relationship is detected, restore fails, migration ledger/schema state is unknown, or authorization tests leak data. Escalate for human mapping review; do not guess or continue to non-null ownership constraints.

## Current evidence requested from the owner

No mapping evidence is present in the repository. Required next inputs are: official institution identity/identifier; authoritative record source(s); authorized data owner; record-to-institution evidence with provenance; resolution for any multiple-institution or orphan records; designated independent reviewer; and approval to build a separate PostgreSQL test copy. Do not send credentials, raw face data or student exports through Git or chat.
