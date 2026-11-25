# Phase 14A.2 — Protected Backup Directory

**Date:** 2026-11-09
**Scope:** Create and verify only the approved new backup directory and its DACL.
**Result:** **PASS** for the authorized ACL operation. **Phase 14A database operations A–D remain BLOCKED and were not performed.**

## Preflight and operation

| Check | Status | Result |
|---|---|---|
| Current account SID | PASS | Current identity SID matched the approved `S-1-5-21-801617878-2430668760-3645567244-1001`. |
| Target absence | PASS | `D:\AttendX\PostgreSQL-Test\backups\phase14a-protected` was absent immediately before creation. No existing path was reused. |
| Directory creation | PASS | Created only `D:\AttendX\PostgreSQL-Test\backups\phase14a-protected`. |
| Inheritance | PASS | Disabled DACL inheritance on the new directory without copying inherited ACEs. `AreAccessRulesProtected=True`. |
| Final DACL | PASS | Exactly three explicit allow ACEs were present, all Full Control with ContainerInherit and ObjectInherit, no propagation-only flags, and `IsInherited=False`. No other ACEs were present. |
| Owner | PASS | Owner is `LAPTOP-G6VAKMU3\Asus`, matching the expected current account. |
| Parent ACL | PASS | Parent `D:\AttendX\PostgreSQL-Test\backups` SDDL was captured before and after; the strings compared equal. No parent ACL was changed. |
| Existing siblings | PASS | Existing child names and basic metadata (mode, size where applicable, creation time, last-write time) were captured before and after; all entries other than the newly created target compared equal. No existing file or directory was modified. |
| Backup/database scope | PASS | No backup file was created. No PostgreSQL client, connection, database, role, fixture, migration, cluster, Windows service, application setting, or port 5432 was accessed or changed. |

## Exact final DACL

| SID | Resolved identity | Type | Rights | Inherited | Inheritance flags | Propagation |
|---|---|---|---|---|---|---|
| `S-1-5-21-801617878-2430668760-3645567244-1001` | Current user `LAPTOP-G6VAKMU3\Asus` | Allow | FullControl | No | ContainerInherit, ObjectInherit | None |
| `S-1-5-18` | `NT AUTHORITY\SYSTEM` | Allow | FullControl | No | ContainerInherit, ObjectInherit | None |
| `S-1-5-32-544` | `BUILTIN\Administrators` | Allow | FullControl | No | ContainerInherit, ObjectInherit | None |

The final DACL contained exactly these three entries. `Authenticated Users`, `Everyone`, `BUILTIN\Users`, and other broad groups were not granted access.

## Operation/verification record

The operation first checked the current SID and exact target absence, then captured the parent DACL and existing child entries. It created the target, called `SetAccessRuleProtection($true, $false)` to disable inheritance without retaining inherited rules, installed the three explicit SID-based Full Control rules, applied the ACL, and read it back. Verification checked the protected state, exact ACE count and SIDs, allow type, Full Control rights, inheritance/propagation flags, owner, parent SDDL equality, and unchanged prior siblings.

Verified output:

```text
INHERITANCE_DISABLED=True
OWNER=LAPTOP-G6VAKMU3\Asus
FINAL_ACE_COUNT=3
PARENT_DACL_UNCHANGED=True
EXISTING_SIBLINGS_UNCHANGED=True
NO_BACKUP_FILE_CREATED=True
```

## Remaining gates

- **PASS:** The new directory now meets the approved protected-DACL design for storing future backup artifacts.
- **BLOCKED / NOT EXECUTED:** Phase 14A operations A–D remain blocked and need separate explicit approval. This ACL approval did not authorize database creation, fixture application, backup creation/listing/checksum, or any migration.
- **NOT TESTED:** No application tests or PostgreSQL checks were run. No production-readiness claim is made.
