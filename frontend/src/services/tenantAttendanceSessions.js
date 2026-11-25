import api from "./api.js";
import { requireSelectedCollegeId } from "./tenantSelection.js";

const pendingTenantReads = new Map();
const forbiddenTenantReads = new Map();
let lastObservedAuthorizationScope = null;

function params(collegeId) {
  return { params: { college_id: requireSelectedCollegeId(collegeId) } };
}

function tenantRead(endpoint, collegeId, requestIdentity, { retryAuthorization = false } = {}) {
  const selectedCollegeId = requireSelectedCollegeId(collegeId);
  const config = { params: { college_id: selectedCollegeId } };
  if (requestIdentity == null || String(requestIdentity) === "") {
    return api.get(endpoint, config).then((response) => response.data);
  }

  const authorizationScope = `${String(requestIdentity)}:${String(selectedCollegeId)}`;
  if (lastObservedAuthorizationScope !== null && lastObservedAuthorizationScope !== authorizationScope) {
    forbiddenTenantReads.clear();
  }
  lastObservedAuthorizationScope = authorizationScope;
  const key = `${String(requestIdentity)}:${String(selectedCollegeId)}:${endpoint}`;
  if (retryAuthorization) forbiddenTenantReads.delete(key);
  else if (forbiddenTenantReads.has(key)) return Promise.reject(forbiddenTenantReads.get(key));

  const pending = pendingTenantReads.get(key);
  if (pending) return pending;

  const request = api.get(endpoint, config)
    .then((response) => {
      forbiddenTenantReads.delete(key);
      return response.data;
    })
    .catch((error) => {
      if (Number(error?.response?.status) === 403) {
        const denied = new Error(error?.userMessage || error?.message || "This account is not authorized for the selected College.");
        denied.userMessage = error?.userMessage;
        denied.response = { status: 403 };
        forbiddenTenantReads.set(key, denied);
      }
      throw error;
    })
    .finally(() => {
      if (pendingTenantReads.get(key) === request) pendingTenantReads.delete(key);
    });
  pendingTenantReads.set(key, request);
  return request;
}

export async function getTenantTeacherAssignments(collegeId, requestIdentity, options) {
  return tenantRead("/tenant/attendance/sessions/assignments", collegeId, requestIdentity, options);
}

export async function getTenantTeacherAttendanceSummary(collegeId, requestIdentity, options) {
  return tenantRead("/tenant/attendance/sessions/summary", collegeId, requestIdentity, options);
}

export async function getTenantAttendanceSessions(collegeId, requestIdentity, options) {
  return tenantRead("/tenant/attendance/sessions", collegeId, requestIdentity, options);
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
