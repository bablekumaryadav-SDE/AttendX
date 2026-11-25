import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import api from "../src/services/api.js";
import {
  getTenantAttendanceSummary,
  getTenantDashboardSummary,
  hasTenantDashboardSummaryShape,
  tenantDashboardErrorMessage,
} from "../src/services/tenantDashboard.js";
import { createLatestRequestGuard } from "../src/services/tenantSelection.js";

test("tenant dashboard services pass selected College IDs in GET requests only", async () => {
  const calls = [];
  const oldAdapter = api.defaults.adapter;
  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: (key) => key === "attendx_token" ? "synthetic-token" : null };
  api.defaults.adapter = async (config) => {
    calls.push({ method: config.method, url: config.url, params: config.params });
    return { data: {}, status: 200, statusText: "OK", headers: {}, config };
  };
  try {
    await getTenantDashboardSummary(201);
    await getTenantAttendanceSummary(202);
    assert.deepEqual(calls, [
      { method: "get", url: "/tenant/dashboard/summary", params: { college_id: 201 } },
      { method: "get", url: "/tenant/dashboard/attendance-summary", params: { college_id: 202 } },
    ]);
    await assert.rejects(getTenantDashboardSummary(null), { code: "COLLEGE_SELECTION_REQUIRED" });
    await assert.rejects(getTenantAttendanceSummary(null), { code: "COLLEGE_SELECTION_REQUIRED" });
    assert.equal(calls.length, 2);
  } finally {
    api.defaults.adapter = oldAdapter;
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldStorage;
  }
});

test("tenant dashboard errors distinguish authentication, authorization, selection and schema availability", () => {
  assert.match(tenantDashboardErrorMessage(401), /session expired/i);
  assert.match(tenantDashboardErrorMessage(403), /active College Admin membership/i);
  assert.match(tenantDashboardErrorMessage(409), /Select one active College/i);
  assert.match(tenantDashboardErrorMessage(503), /unavailable/i);
});

test("dashboard rejects malformed aggregate payloads before rendering can dereference them", () => {
  const valid = { college_name: "Example College", ...Object.fromEntries(["students", "teachers", "classes", "subjects"].map((key) => [key, { total: 3, active: 2, inactive: 1 }])), face_registered_count: 2, face_not_registered_count: 1 };
  assert.equal(hasTenantDashboardSummaryShape(valid), true);
  assert.equal(hasTenantDashboardSummaryShape(null), false);
  assert.equal(hasTenantDashboardSummaryShape({ ...valid, classes: null }), false);
  assert.equal(hasTenantDashboardSummaryShape({ ...valid, students: { total: 2, active: 2, inactive: 1 } }), false);
  assert.equal(hasTenantDashboardSummaryShape({ ...valid, college_name: "  " }), false);
  assert.equal(hasTenantDashboardSummaryShape({ ...valid, face_registered_count: 4 }), false);
});

test("admin dashboard clears College state and ignores stale results without global metrics", async () => {
  const [routes, page, service] = await Promise.all([
    readFile(new URL("../src/routes/AppRoutes.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/auth/admin/TenantAdminDashboard.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/tenantDashboard.js", import.meta.url), "utf8"),
  ]);
  assert.match(routes, /path="\/admin"[\s\S]*?<TenantAdminDashboard \/>/);
  assert.match(routes, /<WorkspaceErrorBoundary>[\s\S]*?<DashboardLayout \/>[\s\S]*?<\/WorkspaceErrorBoundary>/);
  assert.match(page, /const \{[^}]*\bactiveCollegeId\b[^}]*\} = useAuth\(\)/);
  assert.match(page, /getTenantDashboardSummary\(activeCollegeId\)/);
  assert.match(page, /getTenantAttendanceSummary\(activeCollegeId\)/);
  assert.match(page, /setSummary\(null\)/);
  assert.match(page, /setAttendance\(null\)/);
  assert.match(page, /requestGuard\.current\.isCurrent\(version\)/);
  assert.match(page, /Loading College metrics/);
  assert.match(page, /No College-owned directory records are available yet/);
  assert.match(page, /Some College metrics are unavailable/);
  assert.match(page, /Earliest reliable trend date: not established/);
  assert.match(page, /Calculated from \{attendance\.trend_start_date\}/);
  assert.match(page, /date-tracked student enrollment and Teacher assignment were both valid on its attendance date/);
  assert.match(page, /Partial trend coverage/);
  assert.match(service, /attendance-summary/);
  assert.match(page, /Incomplete status data/);
  assert.match(page, /Numerator: present \+ late records/);
  assert.match(page, /Session event presence rate/);
  assert.match(page, /verified_attendance_event_rows/);
  assert.match(page, /Session attendance events/);
  assert.match(page, /including absences finalized when a Teacher closes a session/);
  assert.doesNotMatch(page, /Verified QR \/ face events/);
  assert.doesNotMatch(page, /localStorage|getAdminDashboard|getAnalyticsOverview|getLowAttendance|getAttendanceSessions|total_users|api\.(?:post|put|patch|delete)/i);
  assert.match(page, /summary\.face_registered_count/);
  assert.match(page, /summary\.face_not_registered_count/);
  assert.match(page, /Pending and failed face enrollment states are not stored/);
  assert.doesNotMatch(service, /api\.(?:post|put|patch|delete)|admin-dashboard|\/analytics\/|\/attendance\/sessions/i);
});

test("latest request guard rejects a response made stale by a College reload", () => {
  const guard = createLatestRequestGuard();
  const collegeARequest = guard.begin();
  const collegeBRequest = guard.begin();
  assert.equal(guard.isCurrent(collegeARequest), false);
  assert.equal(guard.isCurrent(collegeBRequest), true);
});
