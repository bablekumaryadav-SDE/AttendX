import api from "./api.js";
import { requireSelectedCollegeId } from "./tenantSelection.js";

const SUMMARY_KEYS = Object.freeze(["students", "teachers", "classes", "subjects"]);

export function hasTenantDashboardSummaryShape(value) {
  return Boolean(value && typeof value === "object" && SUMMARY_KEYS.every((key) => {
    const counts = value[key];
    return counts && Number.isSafeInteger(counts.total) && counts.total >= 0
      && Number.isSafeInteger(counts.active) && counts.active >= 0
      && Number.isSafeInteger(counts.inactive) && counts.inactive >= 0
      && counts.active + counts.inactive === counts.total;
  }));
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
