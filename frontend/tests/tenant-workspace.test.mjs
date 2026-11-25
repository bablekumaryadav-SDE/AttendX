import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("College parent workspace uses only explicit tenant read endpoints", () => {
  const service = read("src/services/tenant.js");
  const page = read("src/pages/auth/admin/ParentsNotifications.jsx");
  const routes = read("src/routes/AppRoutes.jsx");
  const backend = read("../backend/app/main.py");

  assert.match(service, /api\.get\("\/tenant\/guardians"/);
  assert.match(service, /api\.get\("\/tenant\/notification-events"/);
  assert.match(service, /params:\s*\{\s*\.\.\.params,\s*college_id:\s*collegeId\s*\}/);
  assert.match(page, /useAuth\(\)/);
  assert.match(page, /Promise\.allSettled/);
  assert.match(page, /No linked parent records found/);
  assert.match(page, /not proof of provider-confirmed email or SMS delivery/);
  assert.match(routes, /path="parents-notifications" element=\{<ParentsNotifications \/>\}/);
  assert.match(backend, /app\.include_router\(tenant_workspace_router\)/);
  assert.match(backend, /assignments_router,[\s\S]*?dependencies=legacy_business_dependencies/);
  assert.match(backend, /notifications_router, dependencies=legacy_business_dependencies/);
});

test("Parent and notification workspace exposes no create, send, or retry-delivery action", () => {
  const page = read("src/pages/auth/admin/ParentsNotifications.jsx");
  const tenantApi = read("src/services/tenant.js");
  assert.doesNotMatch(page, /Create notification|Send notification|Retry delivery/i);
  assert.doesNotMatch(tenantApi, /post\("\/tenant\/(?:guardians|notification-events)/);
  assert.doesNotMatch(tenantApi, /patch\("\/tenant\/(?:guardians|notification-events)/);
});

test("Coursework routes and router registration are absent while academic mappings remain", () => {
  const routes = read("src/routes/AppRoutes.jsx");
  const assignmentApi = read("../backend/app/api/tenant_workspace.py");
  assert.doesNotMatch(routes, /path="assignments"|TeacherAssignments|StudentAssignments|CourseworkMigrationRequired/);
  assert.doesNotMatch(assignmentApi, /TeacherAssignment|Coursework|Submission/);
  const main = read("../backend/app/main.py");
  assert.doesNotMatch(main, /tenant_coursework|coursework_router/);
  assert.match(routes, /path="notifications" element=\{<TenantNotificationInbox \/>\}/);
});

test("Teacher account linking requires explicit College Admin attestation and never pairs by PII", () => {
  const page = read("src/pages/auth/admin/Teachers.jsx");
  const service = read("src/services/teachers.js");
  const backend = read("../backend/app/api/tenant_account_links.py");

  assert.match(page, /identityVerified|accountLinkAttested/);
  assert.match(page, /independently verified this account holder and Teacher profile using official College records/);
  assert.match(page, /Search active accounts/);
  assert.match(page, /Eligible existing Teacher login accounts/);
  assert.match(page, /Search results do not verify identity/);
  assert.match(service, /searchTeacherAccountLinkCandidates/);
  assert.match(service, /\/tenant\/account-links\/teachers\/eligible-users/);
  assert.match(page, /createTeacherAccountLink\(teacherId, userId, collegeAtSubmit\)/);
  assert.match(page, /setTeacherAccountLink\(result\)/);
  assert.match(page, /revokeTeacherAccountLink\(/);
  assert.match(service, /\/tenant\/account-links\/teachers\//);
  assert.match(service, /identity_verified: true/);
  assert.match(backend, /allowed_roles=_ADMIN_ROLE/);
  assert.match(backend, /College Admin must verify identity outside this API/);
  assert.match(backend, /CollegeMembership\.role == profile_kind/);
  assert.match(backend, /CollegeMembership\.status == "active"/);
});
