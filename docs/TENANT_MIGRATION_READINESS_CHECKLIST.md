# Tenant Migration Readiness Checklist

Migration may proceed only when every mandatory gate below has named evidence, an accountable owner, and independent review. `UNKNOWN`, `NOT TESTED`, `DRAFT`, `BLOCKED`, or blank is not a pass.

| Gate | Required evidence | Current status after Phase 8 review |
|---|---|---|
| Institution identity | Owner-approved legal/official identity and authoritative identifiers for every institution represented | **UNKNOWN / BLOCKED** |
| Source inventory | Actual database catalog, tables, row counts, PK-set hashes, and data families reconciled | **NOT TESTED** — source definitions only |
| Record ownership | Evidence-backed mapping for every in-scope row/cohort; explicit unresolved/conflict/orphan disposition | **UNKNOWN / BLOCKED** |
| Relationship closure | Parent/child validation and same-institution proof for all linked entities | **NOT TESTED** — utility uses synthetic fixtures only |
| Sensitive data | Consent, minimization, retention, access, and tenant-isolation design for face/guardian data reviewed | **DRAFT / REVIEW REQUIRED** |
| Authorization | Tenant-scoped policy, Super Admin separation, and cross-tenant negative tests approved | **DRAFT / NOT TESTED against PostgreSQL** |
| Test environment | Dedicated disposable PostgreSQL cluster/database/role identity verified | **BLOCKED** — PostgreSQL 18.6 service/cluster path and binaries found, but cluster use and database identity unknown; no test database configured. |
| Test URL guard | Separate fail-closed test database configuration | **IMPLEMENTED / PASS** — 9 no-connect tests; not evidence that a cluster is disposable. |
| Backup and restore | Isolated restore rehearsal, integrity checks, and reviewer sign-off | **BLOCKED / NOT TESTED** — binaries exist but no approved test/restore database; no connection or backup. |
| SQL static review | Draft structure and ORM consistency reviewed | **PASS WITH DOCUMENTED DRIFT** — see `TENANT_MIGRATION_SQL_REVIEW.md`; server validation not done. |
| Migration design | Reviewed expand/backfill/validate/constraint/cutover sequence and idempotency plan | **DRAFT / NOT APPLIED** — v2 preferred for future isolated rehearsal only; original preserved; no rehearsal. |
| Recovery | Tested rollback/restore plan, recovery point, and accountable operator | **NOT TESTED / BLOCKED** — restore not rehearsed. |
| Operational controls | Monitoring, audit, secrets, access, retention, and incident response updated | **NOT TESTED** |
| Approval | Data owner, security, operations, and independent reviewer sign-off | **BLOCKED** |

## Decision

Current status: **NOT READY — MIGRATION BLOCKED**. Do not add tenant constraints, backfill `college_id`, or apply migrations until all mandatory gates are evidenced as passing and separately approved. This checklist is not a production readiness certification.
