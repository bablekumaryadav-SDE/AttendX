import api from "./api.js";

export async function submitCollegeRegistration(payload) {
  const response = await api.post("/college-registration/applications", payload, { skipAuth: true });
  return response.data;
}

export async function checkCollegeRegistrationStatus(payload) {
  const response = await api.post("/college-registration/status", payload, { skipAuth: true });
  return response.data;
}

export async function listCollegeApplications(status = "", q = "") {
  const response = await api.get("/platform/college-applications", {
    params: { ...(status ? { status } : {}), ...(q ? { q } : {}) },
  });
  return response.data;
}

export async function getCollegeApplication(applicationId) {
  const response = await api.get(`/platform/college-applications/${applicationId}`);
  return response.data;
}

export async function getCollegeApplicationHistory(applicationId) {
  const response = await api.get(`/platform/college-applications/${applicationId}/history`);
  return response.data;
}

export async function startCollegeApplicationReview(applicationId, reason) {
  const response = await api.post(`/platform/college-applications/${applicationId}/start-review`, { reason: reason || null });
  return response.data;
}

export async function approveCollegeApplication(applicationId, reason) {
  const response = await api.post(`/platform/college-applications/${applicationId}/approve`, { reason: reason || null });
  return response.data;
}

export async function rejectCollegeApplication(applicationId, reason) {
  const response = await api.post(`/platform/college-applications/${applicationId}/reject`, { reason });
  return response.data;
}

export async function listPlatformColleges({ q = "", status = "" } = {}) {
  const response = await api.get("/platform/colleges", {
    params: { ...(q ? { q } : {}), ...(status ? { status } : {}) },
  });
  return response.data;
}

export async function getPlatformCollege(collegeId) {
  const response = await api.get(`/platform/colleges/${collegeId}`);
  return response.data;
}

export async function getPlatformCollegeHistory(collegeId) {
  const response = await api.get(`/platform/colleges/${collegeId}/history`);
  return response.data;
}

export async function updatePlatformCollege(collegeId, payload) {
  const response = await api.patch(`/platform/colleges/${collegeId}`, payload);
  return response.data;
}

export async function setPlatformCollegeStatus(collegeId, status, reason) {
  const response = await api.post(`/platform/colleges/${collegeId}/status`, { status, reason });
  return response.data;
}
