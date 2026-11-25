import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
