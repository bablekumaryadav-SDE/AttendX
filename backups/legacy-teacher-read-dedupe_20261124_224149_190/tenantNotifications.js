import api from "./api.js";
import { requireSelectedCollegeId } from "./tenantSelection.js";

function tenantConfig(collegeId, params = {}) {
  return { params: { ...params, college_id: requireSelectedCollegeId(collegeId) } };
}

function requireId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Notification ID is required.");
  return id;
}

export async function listTenantNotifications(collegeId, filters = {}, pagination = {}) {
  const params = {};
  if (typeof filters.unread === "boolean") params.unread = filters.unread;
  if (filters.event_type) params.event_type = filters.event_type;
  params.limit = pagination.limit ?? 25;
  params.offset = pagination.offset ?? 0;
  return (await api.get("/tenant/notifications", tenantConfig(collegeId, params))).data;
}

export async function getTenantUnreadNotificationCount(collegeId) {
  return (await api.get("/tenant/notifications/unread-count", tenantConfig(collegeId))).data;
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
