import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("student attendance clears and invalidates data when account or College changes", async () => {
  const page = await read("../src/pages/student/StudentAttendance.jsx");
  assert.match(page, /const authenticatedUserId = user\?\.user_id \?\? user\?\.id/);
  assert.match(page, /useLayoutEffect\(\(\) => \{\s*attendanceRequestRef\.current \+= 1;/);
  assert.match(page, /\[activeCollegeId, authenticatedUserId\]/);
  assert.match(page, /String\(requestUserId\) !== String\(authenticatedUserId\)/);
});

test("teacher attendance scopes loaded sessions and live polling to the authenticated account", async () => {
  const page = await read("../src/pages/teacher/TeacherAttendance.jsx");
  assert.match(page, /const authenticatedUserId = user\?\.user_id \?\? user\?\.id/);
  assert.match(page, /const requestScope = `\$\{authenticatedUserId \?\? ""\}:\$\{activeCollegeId \?\? ""\}`/);
  assert.match(page, /dataScope !== `\$\{authenticatedUserId \?\? ""\}:\$\{activeCollegeId \?\? ""\}`/);
  assert.match(page, /\[selectedSession, activeCollegeId, authenticatedUserId\]/);
});

test("notification inbox clears prior-account records and ignores stale scope responses", async () => {
  const page = await read("../src/pages/TenantNotificationInbox.jsx");
  assert.match(page, /const authenticatedUserId = user\?\.user_id \?\? user\?\.id/);
  assert.match(page, /const scope = `\$\{authenticatedUserId \?\? ""\}:\$\{activeCollegeId \?\? ""\}`/);
  assert.match(page, /useLayoutEffect\(\(\) => \{\s*requestRef\.current \+= 1;\s*setItems\(\[\]\)/);
  assert.match(page, /activeScopeRef\.current !== requestScope/);
  assert.match(page, /\[activeCollegeId, authenticatedUserId, unreadOnly, offset\]/);
});

test("Teacher Dashboard coalesces duplicate loads and suppresses automatic retries after 403", async () => {
  const page = await read("../src/pages/teacher/TeacherDashboard.jsx");
  assert.match(page, /inFlightDashboardRef\.current\?\.scope === requestScope/);
  assert.match(page, /authorizationBlockedScopeRef\.current === requestScope && !explicitAuthorizationRetry/);
  assert.match(page, /result\.status === "rejected" && Number\(result\.reason\?\.response\?\.status\) === 403/);
  assert.match(page, /onClick=\{\(\) => loadDashboard\(true, true\)\}/);
  assert.match(page, /loadDashboard\(true\);/);
});

test("Student dashboard and attendance stop background retries after authorization failure", async () => {
  const [dashboard, attendance] = await Promise.all([
    read("../src/pages/student/StudentDashboard.jsx"),
    read("../src/pages/student/StudentAttendance.jsx"),
  ]);
  assert.match(dashboard, /authorizationBlockedScopeRef\.current === requestScope && !explicitAuthorizationRetry/);
  assert.match(dashboard, /result\.status === "rejected" && Number\(result\.reason\?\.response\?\.status\) === 403/);
  assert.match(attendance, /authorizationBlockedScopeRef\.current === requestScope && !explicitAuthorizationRetry/);
  assert.match(attendance, /if \(Number\(error\?\.response\?\.status\) === 403\) authorizationBlockedScopeRef\.current = requestScope/);
  assert.match(attendance, /loadData\(true, true\)/);
});

test("Teacher Attendance coalesces list requests and stops its live poll after 403", async () => {
  const page = await read("../src/pages/teacher/TeacherAttendance.jsx");
  assert.match(page, /authorizationBlockedScopeRef\.current === requestScope && !explicitAuthorizationRetry/);
  assert.match(page, /inFlightListRef\.current\?\.scope === requestScope/);
  assert.match(page, /if \(Number\(err\?\.response\?\.status\) === 403\) \{[\s\S]*?authorizationDenied = true;[\s\S]*?clearInterval\(timer\)/);
  assert.match(page, /onClick=\{\(\) => load\(true\)\}/);
  const closeFlow = page.slice(page.indexOf("const closeSession"), page.indexOf("/* =========================================================\n     RENDER"));
  assert.match(closeFlow, /const updatedSessions = await load\(true\)/);
  assert.doesNotMatch(closeFlow, /getTenantAttendanceSessions\(/);
});
