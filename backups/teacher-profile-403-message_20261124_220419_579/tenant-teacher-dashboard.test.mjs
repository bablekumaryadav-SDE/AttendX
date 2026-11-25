import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import api from "../src/services/api.js";
import { getTenantTeacherAssignments, getTenantTeacherAttendanceSummary } from "../src/services/tenantAttendanceSessions.js";

test("teacher summary client requires and passes the selected College ID", async () => {
  const calls = [];
  const oldAdapter = api.defaults.adapter;
  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: (key) => key === "attendx_token" ? "synthetic-token" : null };
  api.defaults.adapter = async (config) => {
    calls.push({ method: config.method, url: config.url, params: config.params });
    return { data: { sessions: 2 }, status: 200, statusText: "OK", headers: {}, config };
  };
  try {
    await getTenantTeacherAttendanceSummary(74);
    assert.deepEqual(calls, [{ method: "get", url: "/tenant/attendance/sessions/summary", params: { college_id: 74 } }]);
    await assert.rejects(getTenantTeacherAttendanceSummary(null), { code: "COLLEGE_SELECTION_REQUIRED" });
    await getTenantTeacherAssignments(74);
    assert.deepEqual(calls[1], { method: "get", url: "/tenant/attendance/sessions/assignments", params: { college_id: 74 } });
    await assert.rejects(getTenantTeacherAssignments(null), { code: "COLLEGE_SELECTION_REQUIRED" });
    assert.equal(calls.length, 2);
  } finally {
    api.defaults.adapter = oldAdapter;
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldStorage;
  }
});

test("Teacher Dashboard uses tenant services, refreshes on return, and avoids polling or legacy APIs", async () => {
  const [page, layout] = await Promise.all([
    readFile(new URL("../src/pages/teacher/TeacherDashboard.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/layouts/DashboardLayout.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /const \{ user, activeCollegeId \} = useAuth\(\)/);
  assert.match(page, /getTenantTeacherAttendanceSummary\(activeCollegeId, authenticatedUserId/);
  assert.match(page, /getTenantTeacherAssignments\(activeCollegeId, authenticatedUserId/);
  assert.match(page, /getTenantAttendanceSessions\(activeCollegeId, authenticatedUserId/);
  assert.match(page, /requestVersion\.current/);
  assert.match(page, /dataScopeRef\.current/);
  assert.match(page, /const authenticatedUserId = user\?\.user_id \?\? user\?\.id/);
  assert.match(page, /const requestScope = `\$\{authenticatedUserId \?\? ""\}:\$\{activeCollegeId \?\? ""\}`/);
  assert.match(page, /dataScopeRef\.current !== requestScope/);
  assert.match(page, /const currentDataScope = dataScope === `\$\{authenticatedUserId \?\? ""\}:\$\{activeCollegeId \?\? ""\}`/);
  assert.match(page, /setAssignments\(\[\]\)/);
  assert.match(page, /addEventListener\("focus", refreshVisibleDashboard\)/);
  assert.match(page, /addEventListener\("visibilitychange", refreshVisibleDashboard\)/);
  assert.match(page, /lastAutoRefreshAtRef\.current < 1000/);
  assert.match(page, /id="subject-assignments"/);
  assert.match(page, /id="my-subjects"/);
  assert.match(page, /subject_code \|\| "Code unavailable"/);
  assert.match(page, /assignment\.effective_from/);
  assert.doesNotMatch(page, /setInterval|SUB-\$\{/);
  assert.match(layout, /label: "Subject Assignments"/);
  assert.match(layout, /label: "My Subjects"/);
  assert.match(page, /Present \+ late among classified events/);
  assert.match(page, /const assignedClassCount = new Set\(activeAssignments/);
  assert.match(page, /const assignedSubjectCount = new Set\(activeAssignments/);
  assert.match(page, /<span>Assigned classes<\/span>/);
  assert.match(page, /<span>Assigned subjects<\/span>/);
  assert.match(page, /visibleOverview\.present_events/);
  assert.match(page, /visibleOverview\.absent_events/);
  assert.match(page, /Verified events across your sessions/);
  assert.match(page, /Classified events across your sessions/);
  assert.doesNotMatch(page, /Today's present|Today's absent/);
  assert.match(page, /attendanceRate == null \? "N\/A"/);
  assert.match(page, /setError\(uniqueApiErrorMessages\(errors\)\)/);
  assert.doesNotMatch(page, /Check that the backend is running/);
  assert.match(page, /error\?\.code === "ERR_NETWORK"/);
  assert.doesNotMatch(page, /getTeacherDashboard|getAnalyticsOverview|getAttendanceSessions|localStorage|services\/dashboard/);
});
