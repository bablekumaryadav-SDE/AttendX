import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { uniqueApiErrorMessages } from "../src/utils/errors.js";

const dashboardPath = new URL("../src/pages/student/StudentDashboard.jsx", import.meta.url);
const routesPath = new URL("../src/routes/AppRoutes.jsx", import.meta.url);

test("student dashboard declares its notification state used by JSX and handlers", async () => {
  const source = await readFile(dashboardPath, "utf8");
  assert.match(source, /const\s+\[notice\s*,\s*setNotice\]\s*=\s*useState\(/);
});

test("camera dialog errors render once instead of duplicating the same GPS or face error", async () => {
  const source = await readFile(dashboardPath, "utf8");
  assert.match(source, /\{error && !cameraMethod && \([\s\S]*?sd-alert/);
  assert.match(source, /\{error && <p className="sd-camera-inline-message" role="alert">\{error\}<\/p>\}/);
});

test("dashboard API error aggregation deduplicates identical authorization failures", () => {
  const repeated = "An active, verified Student profile link is required in this College.";
  assert.equal(uniqueApiErrorMessages([repeated, repeated, "  ", repeated]), repeated);
  assert.equal(uniqueApiErrorMessages([repeated, "Attendance history is unavailable."]), `${repeated} Attendance history is unavailable.`);
});

test("student dashboard scopes data and stale responses by authenticated user_id and College", async () => {
  const source = await readFile(dashboardPath, "utf8");
  assert.match(source, /const authenticatedUserId = user\?\.user_id \?\? user\?\.id/);
  assert.match(source, /useLayoutEffect\(\(\) => \{[\s\S]*dashboardScopeRef\.current = scope;[\s\S]*dashboardRequestRef\.current \+= 1;[\s\S]*setRecords\(\[\]\)/);
  assert.match(source, /const requestScope = `\$\{requestUserId \?\? ""\}:\$\{activeCollegeId \?\? ""\}`/);
  assert.match(source, /String\(requestUserId \?\? ""\) !== String\(authenticatedUserId \?\? ""\)/);
  assert.match(source, /\}, \[activeCollegeId, authenticatedUserId\]\)/);
});

test("student dashboard cancels late camera streams and suppresses stale camera errors", async () => {
  const source = await readFile(dashboardPath, "utf8");
  assert.match(source, /acquireCameraStreamSafely\(/);
  assert.match(source, /mountedRef\.current = false;[\s\S]*?cameraRequestVersionRef\.current \+= 1;[\s\S]*?stopCameraStream\(cameraStreamRef\.current\)/);
  assert.match(source, /isCurrent: \(\) => mountedRef\.current && cameraRequestVersionRef\.current === requestVersion/);
  assert.match(source, /if \(!stream\) return;[\s\S]*?cameraStreamRef\.current = stream;[\s\S]*?setCameraActive\(true\)/);
  assert.match(source, /if \(!mountedRef\.current \|\| cameraRequestVersionRef\.current !== requestVersion\) return;/);
  assert.doesNotMatch(source, /cameraStreamRef\.current = await navigator\.mediaDevices\.getUserMedia/);
});

test("admin home route renders the API-backed admin dashboard", async () => {
  const source = await readFile(routesPath, "utf8");
  assert.match(source, /import TenantAdminDashboard from ["']\.\.\/pages\/auth\/admin\/TenantAdminDashboard["']/);
  assert.match(source, /<Route index element=\{<TenantAdminDashboard \/>\} \/>/);
});

test("student academic panel loads explicit College-scoped class and Subject data", async () => {
  const source = await readFile(dashboardPath, "utf8");
  const service = await readFile(new URL("../src/services/attendance.js", import.meta.url), "utf8");
  assert.match(source, /getMyStudentAcademics\(activeCollegeId\)/);
  assert.match(source, /setError\(uniqueApiErrorMessages\(errors\)\)/);
  assert.doesNotMatch(source, /Check that the backend is running/);
  assert.match(source, /error\?\.code === "ERR_NETWORK"/);
  assert.match(service, /\/tenant\/face\/student\/academics[\s\S]*college_id:\s*collegeId/);
  assert.match(source, /My Classes &amp; Subjects/);
  assert.match(source, /No active College class enrollment is available/);
  assert.match(source, /enrollment\.effective_from &&/);
  assert.match(source, /dashboardRequestRef\.current !== requestId/);
  assert.match(source, /dashboardScopeRef\.current !== requestScope[\s\S]*?setRecords\(\[\]\)[\s\S]*?setAcademics\(null\)/);
});

test("student enrolled Subject count is derived only from loaded active College enrollments", async () => {
  const source = await readFile(dashboardPath, "utf8");
  assert.match(source, /const enrolledSubjectCount = useMemo\(\(\) => \{[\s\S]*academics\?\.enrollments[\s\S]*new Set\(subjectIds\.map\(String\)\)\.size/);
  assert.match(source, /<span className="sd-stat-label">Enrolled subjects<\/span>/);
  assert.match(source, /academics \? enrolledSubjectCount : "Unavailable"/);
});

test("student attendance history renders the timestamp returned by its tenant API", async () => {
  const source = await readFile(dashboardPath, "utf8");
  assert.match(source, /record\.verified_at \|\| record\.date \|\| record\.starts_at/);
});

test("an empty successful attendance history is not presented as a measured zero percent", async () => {
  const source = await readFile(dashboardPath, "utf8");
  assert.match(source, /attendanceHistoryStatus === "ready" && summary\.total === 0/);
  assert.match(source, /setAttendanceHistoryStatus\("ready"\)/);
  assert.match(source, /setAttendanceHistoryStatus\("error"\)/);
  assert.match(source, /attendanceHistoryStatus === "ready" && summary\.total > 0[\s\S]*?summary\.percentage/);
  assert.match(source, /const attendanceRateRingDisplay = attendanceHistoryStatus === "ready" && summary\.total > 0[\s\S]*?: "—"/);
  assert.match(source, /No attendance data yet/);
  assert.match(source, /attendanceHistoryStatus === "error"[\s\S]*?"Unavailable"/);
});

test("Student Dashboard keeps failed attendance, session, academic and face requests unavailable", async () => {
  const source = await readFile(dashboardPath, "utf8");
  assert.match(source, /setSessionsStatus\("error"\)/);
  assert.match(source, /sessionsStatus === "ready" \? sessions\.find/);
  assert.match(source, /sessionsStatus === "error" \? "Sessions unavailable"/);
  assert.match(source, /attendanceHistoryStatus === "ready" \? summary\.attended : "Unavailable"/);
  assert.match(source, /attendanceHistoryStatus === "ready" \? summary\.absent : "Unavailable"/);
  assert.match(source, /attendanceHistoryUnavailable \? \([\s\S]*?Attendance history is unavailable/);
  assert.match(source, /attendanceHistoryUnavailable \? \([\s\S]*?Subject attendance is unavailable/);
  assert.match(source, /faceRegistrationUnavailable \? "Unavailable"/);
  assert.match(source, /faceStatusLoadState === "ready" && !faceRegistered/);
});

test("student tab focus and visibility events do not start duplicate dashboard refreshes", async () => {
  const source = await readFile(dashboardPath, "utf8");
  assert.match(source, /lastAutoRefreshAtRef = useRef\(0\)/);
  assert.match(source, /now - lastAutoRefreshAtRef\.current < 1000/);
  assert.match(source, /window\.addEventListener\("focus", refreshVisibleDashboard\)/);
  assert.match(source, /document\.addEventListener\("visibilitychange", refreshVisibleDashboard\)/);
});

test("favicon is an existing app asset referenced by the Vite HTML entry", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const icon = await readFile(new URL("../public/favicon.svg", import.meta.url), "utf8");
  const legacyIcon = await readFile(new URL("../public/favicon.ico", import.meta.url));
  assert.match(html, /href="\/favicon\.svg"/);
  assert.match(icon, /<svg[\s\S]*viewBox="0 0 64 64"/);
  assert.deepEqual(legacyIcon.subarray(0, 4), Buffer.from([0, 0, 1, 0]));
});

test("one Student Dashboard face capture submits automatically and refreshes Student records", async () => {
  const source = await readFile(dashboardPath, "utf8");
  assert.match(source, /onClick=\{captureFace\} disabled=\{!selectedAttendanceSession[\s\S]*?Capture Face &amp; Mark Attendance/);
  assert.match(source, /await submitFaceCapture\(capture, true\)/);
  assert.match(source, /await submitStudentFaceAttendance\(selectedAttendanceSession\.id, capture\.file, null, activeCollegeId\)/);
  assert.match(source, /setSessions\(\(current\) => current\.map\([\s\S]*?already_attended: true/);
  assert.match(source, /await loadDashboard\(true\)/);
  assert.match(source, /Retry Face Verification/);
  const teacherAttendance = await readFile(new URL("../src/pages/teacher/TeacherAttendance.jsx", import.meta.url), "utf8");
  assert.match(teacherAttendance, /window\.setInterval\([\s\S]*?poll,[\s\S]*?5000/);
  assert.match(teacherAttendance, /getTenantLiveAttendance\(\s*selectedSession\.id/);
});
