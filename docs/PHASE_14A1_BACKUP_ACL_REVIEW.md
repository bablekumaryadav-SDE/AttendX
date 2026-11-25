# Phase 14A.1 — Protected Backup Directory ACL Review

**Date:** 2026-11-09
**Scope:** Read-only Windows ACL and execution-context review. **No ACL, ownership, directory, file, database, role, cluster, service, or application setting was changed.**
**Phase 14A database operations A–D:** **BLOCKED / NOT EXECUTED**.

## Findings

| Check | Status | Result |
|---|---|---|
| Current backup directory ACL | PASS (inspected) | `D:\AttendX\PostgreSQL-Test\backups` owner is `LAPTOP-G6VAKMU3\Asus`; `AreAccessRulesProtected=False`. Its ACL contains inherited `BUILTIN\Administrators: FullControl`, `NT AUTHORITY\SYSTEM: FullControl`, `NT AUTHORITY\Authenticated Users: Modify`, and `BUILTIN\Users: ReadAndExecute`. Inherited propagation-only ACEs are also present for descendants. `icacls` confirmed the effective displayed rules. |
| Inheritance source | PASS (inspected) | The same ACEs are inherited at `D:\AttendX`, `D:\AttendX\PostgreSQL-Test`, and `...\backups`. At `D:\`, the rules are explicit: Administrators and SYSTEM Full Control; Authenticated Users Modify (including an inheritable propagation ACE); Users Read and Execute (including an inheritable propagation ACE). `D:\AttendX` and its descendants are unprotected and inherit the root rules. The broad Modify grant therefore originates at the drive root, not from an explicit rule added to `backups`. |
| Current Windows identity | PASS (inspected) | Current process identity: `LAPTOP-G6VAKMU3\Asus`, SID `S-1-5-21-801617878-2430668760-3645567244-1001`. The backup directory has no direct ACE for that user. It receives **Modify** through `Authenticated Users`; it does not receive a direct user Full Control grant. Owner status is not treated as an explicit Full Control ACE. |
| Backup execution identity | PASS (documented context) | Phase 11 records show `pg_dump`/`pg_restore` were invoked as PostgreSQL client processes from the operator's PowerShell context, using DPAPI credentials for database authentication. PostgreSQL client tools write/read the artifact under the Windows identity launching the process; the database server/service does not write the client-side `pg_dump --file` destination. On that documented invocation path, the Windows file identity is the current interactive user above. No PostgreSQL command or connection was run for this ACL review. |
| Candidate dedicated child | PASS (read-only absence check) | `D:\AttendX\PostgreSQL-Test\backups\phase14a-protected` and `...\phase14a-private` do not currently exist. No directory was created. A dedicated new child can have a protected DACL without changing parent ACLs, while leaving existing siblings/files untouched. The parent will still govern directory creation/traversal; this does not remove its broad access to the parent or existing files. |
| Preserve current user / exclude broad principals | DRAFT | A new child directory can have inheritance disabled and an explicit Full Control ACE for only the current user SID. Since the documented backup process runs as this user, that permits creating, reading, listing, verifying, and managing its backup artifacts. The child DACL would contain no `Authenticated Users`, `Everyone`, or `BUILTIN\Users` ACE. This must be set on a new empty child; applying it to the existing `backups` directory could affect existing files and is not proposed. |

### ACL / inheritance detail

Read-only commands used:

```powershell
$paths = @('D:\','D:\AttendX','D:\AttendX\PostgreSQL-Test','D:\AttendX\PostgreSQL-Test\backups')
foreach ($p in $paths) {
  $acl = Get-Acl -LiteralPath $p
  # Inspected Owner, AreAccessRulesProtected and each Access rule's
  # identity, type, FileSystemRights, IsInherited, InheritanceFlags,
  # and PropagationFlags.
}
icacls 'D:\AttendX\PostgreSQL-Test\backups'
[System.Security.Principal.WindowsIdentity]::GetCurrent()
```

The `D:\` root's Authenticated Users Modify rule is explicit there (`IsInherited=False`), and its propagated rule is marked inherit-only for child objects. At the three descendant levels it is inherited (`IsInherited=True`). `backups` itself is not protected from inheritance. The owner at the root is SYSTEM; the owner at each inspected AttendX child is the current Asus account. There are no explicit backup-directory ACEs in the observed ACL listing.

### Proposed protected child DACL (DRAFT — not executed)

Use a new, uniquely named, empty child such as `D:\AttendX\PostgreSQL-Test\backups\phase14a-protected`. First recheck that the path is absent. Create only that new child, disable inheritance on it without copying inherited ACEs, and install an inheritable Full Control ACE for the current account SID `S-1-5-21-801617878-2430668760-3645567244-1001`. Re-read the resulting ACL and verify it is protected, the SID has Full Control, no broad principals have an allow ACE, and the owner remains the intended account. Do not change the parent or any pre-existing backup.

Illustrative exact ACL operation for a separately approved future step (not run in this phase):

```powershell
$backupDir = 'D:\AttendX\PostgreSQL-Test\backups\phase14a-protected'
# Recheck absence; create this new directory only under separate approval.
New-Item -ItemType Directory -Path $backupDir
icacls $backupDir /inheritance:r
icacls $backupDir /grant:r '*S-1-5-21-801617878-2430668760-3645567244-1001:(OI)(CI)(F)'
```

This proposal deliberately grants only the identified backup execution user. If later automation runs as a different Windows identity, identify that exact SID and add it only after a separate review/approval; no PostgreSQL Windows service identity is needed for the documented client-side dump operation. A user-only protected DACL reduces recovery access for SYSTEM/Administrators; this is a tradeoff that should be accepted explicitly or the plan revised to include named recovery principals. The `D:` parent remains broadly writable, so another authenticated user with parent Modify may be able to delete or replace the child directory entry even though they cannot access its protected contents. Restricting that parent would change ACLs outside this phase and is not proposed.

The exact operation requiring separate approval is: create the absent child `D:\AttendX\PostgreSQL-Test\backups\phase14a-protected`, turn off inherited ACEs on that new child, and set its DACL to the above current-user SID Full Control rule; then perform read-only ACL verification. This is separate from approval for any database, fixture, or backup-file operation.

## Limits and stop condition

- **NOT TESTED:** No effective-access token simulation, non-owner account access check, PostgreSQL invocation, port probe, database connection, or service inspection was performed in this phase. The client execution context is based on the Phase 11 recorded command path.
- **PASS (scope):** Existing parent ACLs, backup artifacts, cluster files, Windows service, port 5432, and database state were not changed or accessed for this review.
- **BLOCKED:** The current shared backup directory does not meet the protected-storage condition because it inherits Authenticated Users Modify.
- **AWAITING APPROVAL:** Any creation or ACL change for a new protected child requires separate explicit approval. No backup path has been changed or created.
- **BLOCKED:** Phase 14A operations A–D remain blocked pending an approved protected destination and their own execution gate. No migration or production-readiness claim is made.
