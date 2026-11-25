import api from "./api.js";
import { requireSelectedCollegeId } from "./tenantSelection.js";

const SUMMARY_KEYS = Object.freeze(["students", "teachers", "classes", "subjects"]);

export function hasTenantDashboardSummaryShape(value) {
  return Boolean(value && typeof value === "object" && typeof value.college_name === "string" && value.college_name.trim() && SUMMARY_KEYS.every((key) => {
    const counts = value[key];
    return counts && Number.isSafeInteger(counts.total) && counts.total >= 0
      && Number.isSafeInteger(counts.active) && counts.active >= 0
      && Number.isSafeInteger(counts.inactive) && counts.inactive >= 0
      && counts.active + counts.inactive === counts.total;
  }) && Number.isSafeInteger(value.face_registered_count) && value.face_registered_count >= 0
    && Number.isSafeInteger(value.face_not_registered_count) && value.face_not_registered_count >= 0
    && value.face_registered_count + value.face_not_registered_count === value.students.total);
}

const COUNT_FIELDS = [
  "legacy_attendance_rows",
  "attendance_record_rows",
  "verified_attendance_event_rows",
  "verified_present_events",
  "verified_late_events",
  "verified_absent_events",
  "verified_unclassified_events",
  "verified_classified_events_denominator",
  "present_records",
  "late_records",
  "absent_records",
  "unclassified_status_records",
  "classified_records_denominator",
  "trend_excluded_records",
];

const validCount = (value) => Number.isSafeInteger(value) && value >= 0;
const validRate = (value) => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100);

export function hasTenantAttendanceSummaryShape(value) {
  return Boolean(value && typeof value === "object"
    && COUNT_FIELDS.every((field) => validCount(value[field]))
    && validRate(value.verified_presence_rate_percent)
    && validRate(value.recorded_presence_rate_percent)
    && typeof value.trend_available === "boolean"
    && (value.trend_start_date === null || typeof value.trend_start_date === "string")
    && typeof value.trend_partial === "boolean"
    && typeof value.trend_unavailable_reason === "string"
    && Array.isArray(value.trends)
    && value.trends.every((point) => Boolean(point && typeof point.period === "string"
      && ["records", "present", "late", "absent", "unclassified"].every((field) => validCount(point[field]))
      && validRate(point.presence_rate_percent))));
}

export async function getTenantDashboardSummary(collegeId) {
  const response = await api.get("/tenant/dashboard/summary", {
    params: { college_id: requireSelectedCollegeId(collegeId) },
  });
  return response.data;
}

export async function getTenantAttendanceSummary(collegeId) {
  const response = await api.get("/tenant/dashboard/attendance-summary", {
    params: { college_id: requireSelectedCollegeId(collegeId) },
  });
  return response.data;
}

export function tenantDashboardErrorMessage(status) {
  if (status === 401) return "Your session expired. Sign in again to load College metrics.";
  if (status === 403) return "An active College Admin membership is required for this dashboard.";
  if (status === 409) return "Select one active College before loading dashboard metrics.";
  if (status === 503) return "Tenant dashboard data is unavailable because required ownership schema or data is unavailable.";
  return "Unable to load tenant dashboard data.";
}
