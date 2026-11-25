import api from "./api.js";
import { requireSelectedCollegeId } from "./tenantSelection.js";

function tenantConfig(collegeId, params = {}) {
  return { params: { ...params, college_id: requireSelectedCollegeId(collegeId) } };
}

function requireId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error(`${label} is required.`);
  return id;
}

const assignmentPath = (role, id) => `/tenant/coursework/${role}/assignments/${requireId(id, "Assignment ID")}`;

export async function listTeacherCoursework(collegeId) {
  return (await api.get("/tenant/coursework/teacher/assignments", tenantConfig(collegeId))).data;
}

export async function listTeacherCourseworkMappings(collegeId) {
  return (await api.get("/tenant/coursework/teacher/mappings", tenantConfig(collegeId))).data;
}

export async function createTeacherCourseworkDraft(collegeId, payload) {
  return (await api.post("/tenant/coursework/teacher/assignments", payload, tenantConfig(collegeId))).data;
}

export async function updateTeacherCourseworkDraft(collegeId, assignmentId, payload) {
  return (await api.patch(assignmentPath("teacher", assignmentId), payload, tenantConfig(collegeId))).data;
}

export async function publishTeacherCoursework(collegeId, assignmentId) {
  return (await api.post(`${assignmentPath("teacher", assignmentId)}/publish`, {}, tenantConfig(collegeId))).data;
}

export async function extendTeacherCourseworkDeadline(collegeId, assignmentId, dueAt, reason) {
  return (await api.post(
    `${assignmentPath("teacher", assignmentId)}/deadline-extension`,
    { reason },
    tenantConfig(collegeId, { due_at: dueAt }),
  )).data;
}

export async function archiveTeacherCoursework(collegeId, assignmentId, reason) {
  return (await api.post(`${assignmentPath("teacher", assignmentId)}/archive`, { reason }, tenantConfig(collegeId))).data;
}

export async function listTeacherCourseworkSubmissions(collegeId, assignmentId) {
  return (await api.get(`${assignmentPath("teacher", assignmentId)}/submissions`, tenantConfig(collegeId))).data;
}

export async function getTeacherCourseworkSubmission(collegeId, assignmentId, studentId) {
  return (await api.get(
    `${assignmentPath("teacher", assignmentId)}/submissions/${requireId(studentId, "Student ID")}`,
    tenantConfig(collegeId),
  )).data;
}

export async function listStudentCoursework(collegeId) {
  return (await api.get("/tenant/coursework/student/assignments", tenantConfig(collegeId))).data;
}

export async function submitStudentCoursework(collegeId, assignmentId, payload) {
  return (await api.post(
    `${assignmentPath("student", assignmentId)}/submissions`,
    payload,
    tenantConfig(collegeId),
  )).data;
}

export async function getStudentCourseworkHistory(collegeId, assignmentId) {
  return (await api.get(
    `${assignmentPath("student", assignmentId)}/submissions`,
    tenantConfig(collegeId),
  )).data;
}

export async function listAdminCoursework(collegeId, filters = {}, pagination = {}) {
  const params = {};
  for (const key of ["teacher_id", "class_id", "subject_id", "status", "due_from", "due_to"]) {
    if (filters[key] != null && filters[key] !== "") params[key] = filters[key];
  }
  params.limit = pagination.limit ?? 50;
  params.offset = pagination.offset ?? 0;
  return (await api.get("/tenant/coursework/admin/assignments", tenantConfig(collegeId, params))).data;
}

export async function getAdminCourseworkAssignment(collegeId, assignmentId) {
  return (await api.get(assignmentPath("admin", assignmentId), tenantConfig(collegeId))).data;
}

export async function listAdminCourseworkSubmissions(collegeId, assignmentId) {
  return (await api.get(`${assignmentPath("admin", assignmentId)}/submissions`, tenantConfig(collegeId))).data;
}

export async function getAdminCourseworkSubmission(collegeId, assignmentId, studentId) {
  return (await api.get(
    `${assignmentPath("admin", assignmentId)}/submissions/${requireId(studentId, "Student ID")}`,
    tenantConfig(collegeId),
  )).data;
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
  const id = requireId(notificationId, "Notification ID");
  const saved = (await api.patch(`/tenant/notifications/${id}/read`, {}, tenantConfig(collegeId))).data;
  if (typeof window !== "undefined") window.dispatchEvent(new Event("attendx:notifications-updated"));
  return saved;
}

export async function markAllTenantNotificationsRead(collegeId) {
  const result = (await api.post("/tenant/notifications/read-all", {}, tenantConfig(collegeId))).data;
  if (typeof window !== "undefined") window.dispatchEvent(new Event("attendx:notifications-updated"));
  return result;
}

export function isCourseworkFilterUnavailable(error) {
  return error?.response?.status === 404
    && error?.response?.data?.detail === "One or more selected filters are not available in this College.";
}

export function courseworkErrorMessage(error, action = "load") {
  const status = error?.response?.status;
  if (status === 401) return "Your session expired. Sign in again.";
  if (status === 403) return "Your active College membership does not allow this coursework action.";
  if (isCourseworkFilterUnavailable(error)) return "One or more selected filters are no longer available in this College. Clear filters and retry.";
  if (status === 404 && action === "load") return "The Coursework list route returned HTTP 404. This backend currently leaves Coursework unregistered until its required migrations and PostgreSQL verification are approved.";
  if (status === 404) return "The requested coursework record was not found in the selected College.";
  if (status === 409) return "This coursework action conflicts with the current assignment or submission state. Refresh and retry.";
  if (status === 422) return "Check the required coursework fields, content, and date values, then try again.";
  if (status === 503) return "Coursework is unavailable until the approved College schema and APIs are deployed.";
  if (!error?.response) return `Could not ${action} coursework because the server could not be reached.`;
  return `Could not ${action} coursework. Please retry.`;
}
