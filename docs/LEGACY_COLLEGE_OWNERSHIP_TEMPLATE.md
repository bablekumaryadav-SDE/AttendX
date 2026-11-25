# Legacy College Ownership Mapping Template

**Purpose:** Collect auditable evidence for assigning existing AttendX records to a real institution before tenant migration design. This is a blank template; it contains no inferred or default ownership.

## Mapping rules

- Every source record must be traceable by source database identifier, table and primary key. Do not put passwords, tokens, connection strings, face images/embeddings or unnecessary student PII in this worksheet.
- A proposed institution must be identified by verified legal/official name and, where relevant, official affiliation/recognition identifier and address. Do not use a synthetic “default college.”
- Accept evidence only when it establishes that institution’s ownership of the specific records or a documented cohort with a traceable link to those records.
- Email domain, department name, academic-year label, local `.env`, database name, current admin status or the fact that only one college is believed to exist are not sufficient evidence by themselves.
- Ambiguous, conflicting or orphaned rows remain unresolved and must block assignment/constraints for that row until reviewed. Never silently discard, merge or guess.
- Use record IDs and redacted evidence references; store any sensitive source extracts in access-controlled storage, not in Git.
- Require a preparer and independent reviewer. Record evidence provenance, review date and approval source.

## Institution identity register

| Mapping batch | Verified legal institution name | Official identifier / affiliation | Verified address (city/state) | Evidence source/type | Evidence reference (redacted) | Evidence owner/source | Reviewer identity/reference | Review date | Approval status |
|---|---|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |  |  | UNREVIEWED |

## Record mapping worksheet

Copy one row per source record or per precisely defined cohort whose membership is reproducible from a reviewed query. For cohorts, attach the query text/hash and the complete source primary-key set in controlled storage.

| Batch ID | Source DB fingerprint (non-secret) | Record type/table | Source record ID (PK) | Related parent record IDs (type + PK) | Record/cohort definition ref | Proposed institution ref | Evidence source/type | Evidence reference | Confidence | Reason reference (no free-text PII) | Parent/child validation | Conflict/orphan status | Reviewer identity/authorized review ref | Review date | Approval status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |  | UNKNOWN |  |  |  |  |  |  | UNREVIEWED |

Use only these `Approval status` values: `UNREVIEWED`, `VERIFIED`, `CONFLICT`, `ORPHANED`, `REJECTED`, `APPROVED`. `VERIFIED` means an authorized reviewer checked the evidence; it does not approve a migration. `APPROVED` requires the designated owner and independent reviewer to sign off on the institution and the exact record/cohort mapping. `CONFLICT`, `ORPHANED`, `REJECTED` and `UNREVIEWED` rows must never be backfilled. Confidence values are `HIGH`, `MEDIUM`, `LOW`, `UNKNOWN`; confidence alone never changes approval status.

## Required source coverage checklist

Inventory every current data family; “not applicable” needs reviewer evidence. Record row counts and primary-key-set hashes before mapping in a separate protected audit record.

| Data family / tables to enumerate | Inventory complete | Ownership evidence reference | Parent-child validation complete | Unresolved rows count | Reviewer status |
|---|---|---|---|---:|---|
| Users and user/profile links (`users`, `students`, `teachers`) |  |  |  |  |  |
| Academic structure (`classes`, `subjects`, teacher assignments, student class assignments) |  |  |  |  |  |
| Legacy attendance (`attendance`, `attendance_records`) |  |  |  |  |  |
| Session attendance, QR/session records and attendance audit events |  |  |  |  |  |
| Guardian contacts/relationships and notification events/delivery records |  |  |  |  |  |
| Face/biometric consent, references and registrations |  |  |  |  |  |
| Imports, uploads, exports, backups and external object references |  |  |  |  |  |

## Evidence expected before migration approval

1. Owner-signed identification of the institution or institutions represented in the current data, with official identifiers.
2. Reproducible source queries and exact primary-key exports for every table/cohort; preserve a cryptographic checksum and row counts in access-controlled storage.
3. Documentary evidence for each ownership cohort (for example, institution-maintained enrollment/HR/academic records or an authorized system-of-record export) with provenance and a named verifier.
4. Relationship closure checks proving user/profile, enrollment, class/subject assignment, attendance, guardian and notification references resolve to the same proposed institution.
5. A duplicate, orphan, ambiguous and conflict report, each resolved or explicitly kept out of the backfill.
6. A second reviewer’s sign-off and a written recovery plan.
7. A successful restore and migration rehearsal against a separate PostgreSQL test database, including exact before/after counts, key-set comparison and cross-tenant authorization tests.

## Approval status

No institution mapping was provided with the Phase 4 request. This template remains unpopulated; ownership is **UNKNOWN**, and no tenant migration or database operation is authorized by this document. Do not fill rows from names, domains, IDs or assumptions.
