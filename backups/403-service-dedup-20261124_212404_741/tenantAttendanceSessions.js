import api from "./api.js";
import { requireSelectedCollegeId } from "./tenantSelection.js";

function params(collegeId) {
  return { params: { college_id: requireSelectedCollegeId(collegeId) } };
}

export async function getTenantTeacherAssignments(collegeId) {
  const response = await api.get("/tenant/attendance/sessions/assignments", params(collegeId));
  return response.data;
}

export async function getTenantTeacherAttendanceSummary(collegeId) {
  const response = await api.get("/tenant/attendance/sessions/summary", params(collegeId));
  return response.data;
}

export async function getTenantAttendanceSessions(collegeId) {
  const response = await api.get("/tenant/attendance/sessions", params(collegeId));
  return response.data;
}

export async function createTenantAttendanceSession(payload, collegeId) {
  const response = await api.post("/tenant/attendance/sessions", payload, params(collegeId));
  return response.data;
}

export async function getTenantSessionQr(sessionId, collegeId) {
  const response = await api.get(`/tenant/attendance/sessions/${sessionId}/qr`, params(collegeId));
  return response.data;
}

export async function refreshTenantSessionQr(sessionId, collegeId) {
  const response = await api.post(`/tenant/attendance/sessions/${sessionId}/qr/refresh`, undefined, params(collegeId));
  return response.data;
}

export async function closeTenantAttendanceSession(sessionId, collegeId) {
  const response = await api.post(`/tenant/attendance/sessions/${sessionId}/close`, undefined, params(collegeId));
  return response.data;
}

export async function getTenantLiveAttendance(sessionId, collegeId) {
  const response = await api.get(`/tenant/attendance/sessions/${sessionId}/live`, params(collegeId));
  return response.data;
}
