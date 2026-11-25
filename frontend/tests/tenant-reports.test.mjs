import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasTenantAttendanceSummaryShape } from "../src/services/tenantDashboard.js";
import { buildTenantReportCsv } from "../src/utils/tenantReportCsv.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const attendanceSummary = {
  legacy_attendance_rows: 0,
  attendance_record_rows: 0,
  verified_attendance_event_rows: 0,
  verified_present_events: 0,
  verified_late_events: 0,
  verified_absent_events: 0,
  verified_unclassified_events: 0,
  verified_classified_events_denominator: 0,
  verified_presence_rate_percent: null,
  present_records: 0,
  late_records: 0,
  absent_records: 0,
  unclassified_status_records: 0,
  classified_records_denominator: 0,
  recorded_presence_rate_percent: null,
  trend_available: false,
  trend_start_date: null,
  trend_partial: false,
  trend_excluded_records: 0,
  trends: [],
  trend_unavailable_reason: "No verified relationship dates are available.",
};

test("attendance report accepts a valid empty response without inventing a percentage", () => {
  assert.equal(hasTenantAttendanceSummaryShape(attendanceSummary), true);
  assert.equal(attendanceSummary.recorded_presence_rate_percent, null);
});

test("attendance report rejects malformed counts and trend points", () => {
  assert.equal(hasTenantAttendanceSummaryShape({ ...attendanceSummary, present_records: -1 }), false);
  assert.equal(hasTenantAttendanceSummaryShape({
    ...attendanceSummary,
    trend_available: true,
    trends: [{ period: "2026-01", records: 1, present: 1, late: 0, absent: 0, unclassified: 0, presence_rate_percent: 101 }],
  }), false);
});

test("CSV export contains only server summary fields and neutralizes formula-like labels", () => {
  const summary = {
    college_name: "=Imported College",
    students: { total: 2, active: 2, inactive: 0 },
    teachers: { total: 1, active: 1, inactive: 0 },
    classes: { total: 1, active: 1, inactive: 0 },
    subjects: { total: 1, active: 1, inactive: 0 },
    face_registered_count: 1,
    face_not_registered_count: 1,
  };
  const csv = buildTenantReportCsv(summary, attendanceSummary);
  assert.match(csv, /"'\=Imported College"/);
  assert.match(csv, /"Attendance","Present records","0"/);
  assert.doesNotMatch(csv, /student-level|fake|sample/i);
});

test("College Reports uses approved tenant summary APIs and keeps unsupported reports explicit", () => {
  const page = read("src/pages/auth/admin/TenantReports.jsx");
  const routes = read("src/routes/AppRoutes.jsx");
  const backend = read("../backend/app/main.py");
  assert.match(page, /getTenantDashboardSummary\(activeCollegeId\)/);
  assert.match(page, /getTenantAttendanceSummary\(activeCollegeId\)/);
  assert.match(page, /createLatestRequestGuard/);
  assert.match(page, /Date-range, class, subject and student-level reports are unavailable/);
  assert.match(routes, /path="reports"\s+element=\{<TenantReports \/>\}/);
  assert.match(backend, /app\.include_router\(analytics_router, dependencies=legacy_business_dependencies, include_in_schema=False\)/);
});
