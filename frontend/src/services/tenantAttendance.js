import api from "./api.js";
import { requireSelectedCollegeId } from "./tenantSelection.js";

// This module exposes only read operations for the reviewed tenant history.
export async function getTenantAttendance(collegeId) {
  const response = await api.get("/attendance/", {
    params: { college_id: requireSelectedCollegeId(collegeId) },
  });
  return response.data;
}

export async function getTenantAttendanceDetail(attendanceId, collegeId) {
  const id = Number(attendanceId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Attendance ID is required.");
  const response = await api.get(`/attendance/${id}`, {
    params: { college_id: requireSelectedCollegeId(collegeId) },
  });
  return response.data;
}

export async function getTenantAttendanceRecords(collegeId) {
  const response = await api.get("/attendance-records/", {
    params: { college_id: requireSelectedCollegeId(collegeId) },
  });
  return response.data;
}

export async function getTenantAttendanceRecordDetail(recordId, collegeId) {
  const id = Number(recordId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Attendance record ID is required.");
  const response = await api.get(`/attendance-records/${id}`, {
    params: { college_id: requireSelectedCollegeId(collegeId) },
  });
  return response.data;
}

export async function getTenantAttendanceEvents(collegeId, filters = {}) {
  const response = await api.get("/tenant/attendance/events", {
    params: { ...filters, college_id: requireSelectedCollegeId(collegeId) },
  });
  return response.data;
}

export async function getTenantAttendanceEventDetail(eventId, collegeId) {
  const id = Number(eventId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Attendance event ID is required.");
  const response = await api.get(`/tenant/attendance/events/${id}`, {
    params: { college_id: requireSelectedCollegeId(collegeId) },
  });
  return response.data;
}

export function attendanceLoadMessage(status, detail = false) {
  if (status === 401) return "Your session expired. Sign in again.";
  if (status === 403) return "An active College Admin membership is required for attendance history.";
  if (status === 404 && detail) return "This attendance record is not available in the selected College.";
  if (status === 409) return "Select one active College before loading attendance history.";
  if (status === 503) return "College-scoped attendance history is temporarily unavailable.";
  return detail ? "Unable to load this attendance record." : "Unable to load attendance history.";
}
