import api, { TOKEN_KEY } from "./api.js";
import { requireSelectedCollegeId } from "./tenantSelection.js";

// React StrictMode and shared layout/page mounts can request the same read at
// once. Coalesce only in-flight reads; never cache a settled response or an
// authorization failure. Including the current bearer token prevents one
// signed-in account/session from sharing an in-flight response with another.
const pendingReads = new Map();

function currentAuthorizationScope() {
  try {
    return typeof localStorage === "undefined" ? "" : localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function readOnce(key, endpoint, config) {
  const scopedKey = JSON.stringify([currentAuthorizationScope(), key]);
  const pending = pendingReads.get(scopedKey);
  if (pending) return pending;

  const request = api.get(endpoint, config)
    .then((response) => response.data)
    .finally(() => {
      if (pendingReads.get(scopedKey) === request) pendingReads.delete(scopedKey);
    });
  pendingReads.set(scopedKey, request);
  return request;
}

function tenantConfig(collegeId, params = {}) {
  return { params: { ...params, college_id: requireSelectedCollegeId(collegeId) } };
}

function requireId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Notification ID is required.");
  return id;
}

export function listTenantNotifications(collegeId, filters = {}, pagination = {}) {
  const selectedCollegeId = requireSelectedCollegeId(collegeId);
  const params = {};
  if (typeof filters.unread === "boolean") params.unread = filters.unread;
  if (filters.event_type) params.event_type = filters.event_type;
  params.limit = pagination.limit ?? 25;
  params.offset = pagination.offset ?? 0;
  const config = tenantConfig(selectedCollegeId, params);
  const key = JSON.stringify(["list", selectedCollegeId, params]);
  return readOnce(key, "/tenant/notifications", config);
}

export function getTenantUnreadNotificationCount(collegeId) {
  const selectedCollegeId = requireSelectedCollegeId(collegeId);
  const key = JSON.stringify(["unread-count", selectedCollegeId]);
  return readOnce(key, "/tenant/notifications/unread-count", tenantConfig(selectedCollegeId));
}

export async function markTenantNotificationRead(collegeId, notificationId) {
  const saved = (await api.patch(`/tenant/notifications/${requireId(notificationId)}/read`, {}, tenantConfig(collegeId))).data;
  if (typeof window !== "undefined") window.dispatchEvent(new Event("attendx:notifications-updated"));
  return saved;
}

export async function markAllTenantNotificationsRead(collegeId) {
  const result = (await api.post("/tenant/notifications/read-all", {}, tenantConfig(collegeId))).data;
  if (typeof window !== "undefined") window.dispatchEvent(new Event("attendx:notifications-updated"));
  return result;
}
