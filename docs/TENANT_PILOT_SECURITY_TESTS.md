# Tenant Pilot Security Tests

**Status: PASS** for isolated API behavior with synthetic SQLite fixtures. These tests do not establish PostgreSQL behavior or broader application isolation.

Tests live in `backend/tests/test_tenant_api_pilot_isolated.py` and call the mounted FastAPI API with signed bearer tokens, then check response status and persisted College rows.

| Requirement | Behavioral test | Result |
|---|---|---|
| College A member can read and update permitted A profile | `test_college_a_admin_reads_and_updates_only_its_profile` | PASS; GET and PATCH succeed; A row updates. |
| A cannot read B | `test_college_a_cannot_read_or_modify_college_b_by_selector` | PASS; B selector returns 403. |
| A cannot modify B | Same test | PASS; PATCH returns 403; B database value remains unchanged. |
| Missing membership denied | `test_missing_membership_is_denied_by_api` | PASS; 403. |
| Inactive membership denied | `test_inactive_membership_is_denied_by_api` | PASS; 403. |
| Suspended College denied | `test_suspended_college_is_denied_by_api` | PASS; 403. |
| Membership role enforced | `test_membership_role_cannot_write_admin_profile` | PASS; teacher PATCH denied despite forged `college_admin` JWT role claim. |
| Client College ID/body cannot override membership | `test_college_a_cannot_read_or_modify_college_b_by_selector`; `test_client_body_cannot_supply_an_alternate_tenant_or_fields` | PASS; cross-tenant selector denied and extra body fields rejected with 422; neither row changes. |
| Ambiguous tenant denied | `test_ambiguous_membership_requires_selecting_a_verified_college` | PASS; no selector returns 409; valid membership selection succeeds. |
| Super Admin does not inherit College Admin or legacy Admin API | `test_super_admin_does_not_inherit_college_admin_or_legacy_admin_access` | PASS; both pilot and `/admin-dashboard` return 403. |
| Unassigned legacy Admin login/API remains | `test_unassigned_legacy_admin_login_and_legacy_api_behavior_remain` | PASS; login succeeds, `/auth/me` reports legacy role, legacy dashboard returns 200, pilot returns 403. |
| Missing additive schema fails closed | `test_missing_tenant_schema_fails_closed_with_service_unavailable` | PASS; pilot returns sanitized 503. |
| Unauthenticated request denied | `test_unauthenticated_request_is_denied` | PASS; 401. |

The 12 pilot tests passed in the final full suite. The tests use only synthetic IDs and data in per-test in-memory SQLite; no configured database is used. Existing legacy auth/attendance/GIS/QR/face/guardian/notification suites ran in the same full backend suite. No browser UI was added.

**Not tested:** PostgreSQL, production data, concurrency under PostgreSQL, tenant isolation of non-pilot routes, load/race behavior, production deployment, database RLS, or a live browser workflow.
