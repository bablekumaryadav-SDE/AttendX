import api from "./api.js";
import { createSingleFlight } from "./tenantSelection.js";

const runMembershipRequest = createSingleFlight();

export async function getMyCollegeMemberships() {
  const token = localStorage.getItem("attendx_token");
  return runMembershipRequest(token, async () => {
    const response = await api.get("/tenant/memberships");
    return response.data;
  });
}

export async function getTenantCollegeProfile(collegeId) {
  if (!collegeId) throw new Error("Select an active College before loading its settings.");
  const response = await api.get("/tenant/pilot/college-profile", {
    params: { college_id: collegeId },
  });
  return response.data;
}

export async function updateTenantCollegeProfile(collegeId, payload) {
  if (!collegeId) throw new Error("Select an active College before updating its settings.");
  const response = await api.patch("/tenant/pilot/college-profile", payload, {
    params: { college_id: collegeId },
  });
  return response.data;
}

export async function getTenantGuardians(collegeId, params = {}) {
  if (!collegeId) throw new Error("Select an active College before loading guardian records.");
  const response = await api.get("/tenant/guardians", { params: { ...params, college_id: collegeId } });
  return response.data;
}

export async function getTenantNotificationEvents(collegeId, params = {}) {
  if (!collegeId) throw new Error("Select an active College before loading notification records.");
  const response = await api.get("/tenant/notification-events", { params: { ...params, college_id: collegeId } });
  return response.data;
}

export function tenantCollegeProfileErrorMessage(error, operation = "load") {
  if (error?.code === "INVALID_COLLEGE_PROFILE_RESPONSE") {
    return "The server returned an invalid College GPS setting. No save confirmation was accepted.";
  }
  const status = error?.response?.status;
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string" && /(?:College GPS settings|Required College settings|Tenant pilot) schema is unavailable/i.test(detail)) {
    return "College GPS settings schema is unavailable. The reviewed College settings migration must be applied before this setting can be used.";
  }
  if (status === 401) return "Your session has expired. Sign in again and retry.";
  if (status === 403) return "You do not have permission to change settings for this College.";
  if (status === 404) return "The selected College could not be found. Refresh your College selection and retry.";
  if (status === 409) return "Select an active College before changing its GPS setting.";
  if (status === 422) return "Enter a whole-number GPS accuracy limit from 1 to 150 metres.";
  if (status === 503) return "College settings are temporarily unavailable. Check the server status and retry.";
  if (!error?.response) return `Could not ${operation} College GPS settings because the server could not be reached.`;
  return `Could not ${operation} the GPS accuracy limit. Please retry or contact the administrator.`;
}
