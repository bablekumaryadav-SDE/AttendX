import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

import api from "../src/services/api.js";
import {
  attendanceLoadMessage,
  getTenantAttendance,
  getTenantAttendanceDetail,
  getTenantAttendanceRecordDetail,
  getTenantAttendanceRecords,
  getTenantAttendanceEvents,
  getTenantAttendanceEventDetail,
} from "../src/services/tenantAttendance.js";
import {
  closeTenantAttendanceSession,
  createTenantAttendanceSession,
  getTenantAttendanceSessions,
  getTenantLiveAttendance,
  getTenantSessionQr,
  getTenantTeacherAssignments,
  refreshTenantSessionQr,
} from "../src/services/tenantAttendanceSessions.js";

test("tenant attendance clients send explicit selected College IDs through GET only", async () => {
  const calls = [];
  const oldAdapter = api.defaults.adapter;
  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: (key) => key === "attendx_token" ? "synthetic-token" : null };
  api.defaults.adapter = async (config) => {
    calls.push({ method: config.method, url: config.url, params: config.params });
    return { data: [], status: 200, statusText: "OK", headers: {}, config };
  };
  try {
    await getTenantAttendance(81);
    await getTenantAttendanceDetail(811, 82);
    await getTenantAttendanceRecords(83);
    await getTenantAttendanceRecordDetail(831, 84);
    await getTenantAttendanceEvents(85, { status: "present", page: 2 });
    await getTenantAttendanceEventDetail(851, 86);
    assert.deepEqual(calls, [
      { method: "get", url: "/attendance/", params: { college_id: 81 } },
      { method: "get", url: "/attendance/811", params: { college_id: 82 } },
      { method: "get", url: "/attendance-records/", params: { college_id: 83 } },
      { method: "get", url: "/attendance-records/831", params: { college_id: 84 } },
      { method: "get", url: "/tenant/attendance/events", params: { status: "present", page: 2, college_id: 85 } },
      { method: "get", url: "/tenant/attendance/events/851", params: { college_id: 86 } },
    ]);
    await assert.rejects(getTenantAttendanceRecords(null), { code: "COLLEGE_SELECTION_REQUIRED" });
    await assert.rejects(getTenantAttendanceRecordDetail(831, null), { code: "COLLEGE_SELECTION_REQUIRED" });
    await assert.rejects(getTenantAttendanceEvents(null), { code: "COLLEGE_SELECTION_REQUIRED" });
    await assert.rejects(getTenantAttendanceDetail("bad", 81), /Attendance ID is required/);
    assert.equal(calls.length, 6);
  } finally {
    api.defaults.adapter = oldAdapter;
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldStorage;
  }
});

test("attendance history errors safely map authentication, membership, selection and missing-schema statuses", () => {
  assert.match(attendanceLoadMessage(401), /session expired/i);
  assert.match(attendanceLoadMessage(403), /College Admin membership/i);
  assert.match(attendanceLoadMessage(404, true), /not available/i);
  assert.match(attendanceLoadMessage(409), /Select one active College/i);
  assert.match(attendanceLoadMessage(503), /temporarily unavailable/i);
});

test("teacher session services use only selected-College tenant endpoints", async () => {
  const calls = [];
  const oldAdapter = api.defaults.adapter;
  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: (key) => key === "attendx_token" ? "synthetic-token" : null };
  api.defaults.adapter = async (config) => {
    calls.push({ method: config.method, url: config.url, params: config.params });
    return { data: [], status: 200, statusText: "OK", headers: {}, config };
  };
  try {
    await getTenantTeacherAssignments(10);
    await getTenantAttendanceSessions(10);
    await createTenantAttendanceSession({ title: "Lecture" }, 10);
    await getTenantSessionQr(101, 10);
    await refreshTenantSessionQr(101, 10);
    await getTenantLiveAttendance(101, 10);
    await closeTenantAttendanceSession(101, 10);
    assert.deepEqual(calls.map(({ method, url, params }) => [method, url, params]), [
      ["get", "/tenant/attendance/sessions/assignments", { college_id: 10 }],
      ["get", "/tenant/attendance/sessions", { college_id: 10 }],
      ["post", "/tenant/attendance/sessions", { college_id: 10 }],
      ["get", "/tenant/attendance/sessions/101/qr", { college_id: 10 }],
      ["post", "/tenant/attendance/sessions/101/qr/refresh", { college_id: 10 }],
      ["get", "/tenant/attendance/sessions/101/live", { college_id: 10 }],
      ["post", "/tenant/attendance/sessions/101/close", { college_id: 10 }],
    ]);
    await assert.rejects(getTenantAttendanceSessions(null), { code: "COLLEGE_SELECTION_REQUIRED" });
    assert.equal(calls.length, 7);
  } finally {
    api.defaults.adapter = oldAdapter;
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldStorage;
  }
});

test("Student Attendance keeps successful session/history data when face profile verification is denied", async () => {
  const page = await readFile(new URL("../src/pages/student/StudentAttendance.jsx", import.meta.url), "utf8");
  assert.match(page, /const results = await Promise\.allSettled\(\[[\s\S]*?getActiveStudentSessions\(activeCollegeId\)[\s\S]*?getMyAttendance\(activeCollegeId\)[\s\S]*?getMyFaceStatus\(activeCollegeId\)/);
  assert.match(page, /setSessions\(sessionsResult\.status === "fulfilled"/);
  assert.match(page, /setRecords\(attendanceResult\.status === "fulfilled"/);
  assert.match(page, /attendanceHistoryLoadState === "error"[\s\S]*?"Unavailable"/);
  assert.match(page, /sessionsLoadState === "error" \? "Unavailable"/);
  assert.match(page, /faceStatusLoadState === "ready" && !faceStatus\?\.face_registered/);
  assert.match(page, /Student account needs an active, verified profile link/);
  assert.match(page, /Verification Required/);
  assert.match(page, /disabled=\{faceStatusLoadState !== "ready" \|\| !faceStatus\?\.face_registered/);
  assert.match(page, /authorizationBlockedScopeRef\.current = requestScope/);
  assert.match(page, /loadData\(true, true\)/);
});

test("Admin Attendance page clears and guards stale tenant requests; exposes read-only views only", async () => {
  const [routes, page, service] = await Promise.all([
    readFile(new URL("../src/routes/AppRoutes.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/auth/admin/TenantAttendance.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/tenantAttendance.js", import.meta.url), "utf8"),
  ]);
  assert.match(routes, /path="attendance"[\s\S]*?element=\{<TenantAttendance \/>\}/);
  assert.match(page, /const \{ activeCollegeId \} = useAuth\(\)/);
  assert.match(page, /getTenantAttendanceRecords\(activeCollegeId\)/);
  assert.match(page, /getTenantAttendanceRecordDetail\(row\.id, activeCollegeId\)/);
  assert.match(page, /getTenantAttendanceEvents\(activeCollegeId\)/);
  assert.match(page, /getTenantAttendanceEventDetail\(row\.id, activeCollegeId\)/);
  assert.match(page, /Promise\.allSettled/);
  assert.match(page, /Verified event/);
  assert.match(page, /setRecords\(\[\]\)/);
  assert.match(page, /createLatestRequestGuard/);
  assert.match(page, /Loading attendance/);
  assert.match(page, /No attendance records available/);
  assert.doesNotMatch(page, /localStorage|createAttendance|updateAttendance|deleteAttendance|markManualAttendance|createAttendanceSession|fetch\(/i);
  assert.match(service, /api\.get\("\/attendance-records\/"/);
  assert.doesNotMatch(service, /api\.(?:post|put|patch|delete)/);
});

test("Teacher Attendance workspace supports explicit GPS modes and maps GPS-on fixes to the tenant session contract", async () => {
  const [page, service, main, schema] = await Promise.all([
    readFile(new URL("../src/pages/teacher/TeacherAttendance.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/tenantAttendanceSessions.js", import.meta.url), "utf8"),
    readFile(new URL("../../backend/app/main.py", import.meta.url), "utf8"),
    readFile(new URL("../../backend/app/schemas/attendance_gis.py", import.meta.url), "utf8"),
  ]);
  assert.match(page, /const \{ user, activeCollegeId, collegeMemberships, membershipsLoading \} = useAuth\(\)/);
  assert.match(page, /const authenticatedUserId = user\?\.user_id \?\? user\?\.id/);
  assert.match(page, /if \(membershipsLoading\) \{[\s\S]*?setLoading\(true\);[\s\S]*?return;/);
  assert.match(page, /selectedCollegeMembership\?\.membership_role === "teacher"/);
  assert.match(page, /if \(!selectedMembershipIsTeacher\) \{[\s\S]*?setSessions\(\[\]\);[\s\S]*?setError\(/);
  assert.match(page, /getTenantAttendanceSessions\(activeCollegeId, authenticatedUserId/);
  assert.match(page, /getTenantTeacherAssignments\(activeCollegeId, authenticatedUserId/);
  assert.match(page, /location_verification_mode: locationVerificationMode/);
  assert.match(page, /if \(locationVerificationMode === "gps_on"\) \{[\s\S]*?getTenantCollegeProfile\(activeCollegeId\)[\s\S]*?getFreshAttendanceLocation\([\s\S]*?validateFreshAttendanceFix/);
  assert.match(page, /teacher_latitude: teacherFix\.latitude/);
  assert.match(page, /teacher_longitude: teacherFix\.longitude/);
  assert.match(page, /teacher_accuracy_m: teacherFix\.accuracy/);
  assert.match(page, /location_verification_mode: locationVerificationMode,[\s\S]*?\.\.\.\(locationVerificationMode === "gps_on" \?/);
  assert.match(page, /GPS Verification: OFF \(start without location check\)/);
  assert.match(page, /GPS Verification: \{locationVerificationMode === "gps_on" \? "ON" : "OFF"\}/);
  assert.match(page, /useState\("gps_on"\)/);
  assert.match(page, /Location verification is OFF\. Classroom presence has not been verified/);
  assert.match(page, /session\.location_verification_status !== expectedLocationStatus/);
  assert.match(page, /Location not verified/);
  assert.match(page, /\{ requireStableFix: true \}/);
  assert.match(page, /validateFreshAttendanceFix\(capturedFix, accuracyLimit\)/);
  assert.match(page, /Number\.isSafeInteger\(value\) && value > 0/);
  assert.match(schema, /teacher_latitude: float \| None/);
  assert.match(schema, /teacher_longitude: float \| None/);
  assert.match(schema, /teacher_accuracy_m: float \| None/);
  assert.match(schema, /teacher_latitude.*teacher_longitude/s);
  assert.match(page, /dataScope !== `\$\{authenticatedUserId \?\? ""\}:\$\{activeCollegeId \?\? ""\}`/);
  assert.match(page, /setSelectedSession\(null\)/);
  assert.doesNotMatch(page, /getTeacherDashboard|services\/attendance|\/attendance\/sessions/);
  assert.match(service, /requireSelectedCollegeId/);
  assert.match(main, /tenant_attendance_sessions_router/);
  assert.match(page, /const classes = useMemo\(\(\) =>/);
  assert.match(page, /const subjects = useMemo\(\(\) => assignments[\s\S]*String\(assignment\.class_id\) === String\(form\.class_id\)/);
  assert.match(page, /class_id: event\.target\.value,[\s\S]*subject_id: ""/);
  assert.match(page, /disabled=\{saving \|\| !selectedAssignmentIsValid\}/);
  assert.match(page, /if \(!form\.subject_id \|\| !selectedAssignmentIsValid\)/);
  assert.match(page, /const classLocationConfigured = \(\(\) =>/);
  assert.match(page, /Number\(latitude\) >= -90[\s\S]*Number\(longitude\) <= 180[\s\S]*radius > 0/);
  assert.match(page, /locationVerificationMode === "gps_on" && !classLocationConfigured/);
  assert.doesNotMatch(page, /useCurrentLocation|You can still create a session without a geo-fence/);
  assert.match(page, /College Admin setup required/);
  assert.match(page, /The College Admin configured this classroom location and radius; they will be used for this session/);
  assert.match(page, /selectedSession\.location_verification_status/);
  assert.match(page, /No active Class and Subject assignments are available/);
  assert.match(page, /No active Subject is assigned to this Class/);
});

test("GPS mode control is confined to the Teacher Create Session page", async () => {
  const [teacherPage, adminPage, studentAttendance, studentDashboard] = await Promise.all([
    readFile(new URL("../src/pages/teacher/TeacherAttendance.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/auth/admin/TenantAttendance.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/student/StudentAttendance.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/student/StudentDashboard.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(teacherPage, /GPS Verification:/);
  for (const page of [adminPage, studentAttendance, studentDashboard]) {
    assert.doesNotMatch(page, /GPS Verification:|locationVerificationMode/);
  }
});

test("Teacher Attendance JSX has no unbound classItem reference in Subject options", async () => {
  const page = await readFile(new URL("../src/pages/teacher/TeacherAttendance.jsx", import.meta.url), "utf8");
  const ast = parse(page, { sourceType: "module", plugins: ["jsx"] });
  const traverse = traverseModule.default || traverseModule;
  const unresolvedLines = [];
  traverse(ast, {
    ReferencedIdentifier(identifierPath) {
      if (identifierPath.node.name === "classItem" && !identifierPath.scope.hasBinding("classItem")) {
        unresolvedLines.push(identifierPath.node.loc?.start.line);
      }
    },
  });
  assert.deepEqual(unresolvedLines, []);
});
