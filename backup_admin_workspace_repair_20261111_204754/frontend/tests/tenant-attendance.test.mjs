import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import api from "../src/services/api.js";
import {
  attendanceLoadMessage,
  getTenantAttendance,
  getTenantAttendanceDetail,
  getTenantAttendanceRecordDetail,
  getTenantAttendanceRecords,
} from "../src/services/tenantAttendance.js";

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
    assert.deepEqual(calls, [
      { method: "get", url: "/attendance/", params: { college_id: 81 } },
      { method: "get", url: "/attendance/811", params: { college_id: 82 } },
      { method: "get", url: "/attendance-records/", params: { college_id: 83 } },
      { method: "get", url: "/attendance-records/831", params: { college_id: 84 } },
    ]);
    await assert.rejects(getTenantAttendanceRecords(null), { code: "COLLEGE_SELECTION_REQUIRED" });
    await assert.rejects(getTenantAttendanceRecordDetail(831, null), { code: "COLLEGE_SELECTION_REQUIRED" });
    await assert.rejects(getTenantAttendanceDetail("bad", 81), /Attendance ID is required/);
    assert.equal(calls.length, 4);
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
  assert.match(page, /setRecords\(\[\]\)/);
  assert.match(page, /createLatestRequestGuard/);
  assert.match(page, /Loading attendance/);
  assert.match(page, /No attendance records available/);
  assert.doesNotMatch(page, /localStorage|createAttendance|updateAttendance|deleteAttendance|markManualAttendance|createAttendanceSession|fetch\(/i);
  assert.match(service, /api\.get\("\/attendance-records\/"/);
  assert.doesNotMatch(service, /api\.(?:post|put|patch|delete)/);
});
