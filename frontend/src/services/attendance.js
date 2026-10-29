import api from "./api";


// ============================================================
// Teacher attendance sessions
// ============================================================

export async function getAttendanceSessions() {
  const response = await api.get(
    "/attendance/sessions"
  );

  return response.data;
}


export async function createAttendanceSession(
  payload
) {
  const response = await api.post(
    "/attendance/sessions",
    payload
  );

  return response.data;
}


export async function closeAttendanceSession(
  sessionId
) {
  const response = await api.post(
    `/attendance/sessions/${sessionId}/close`
  );

  return response.data;
}


export async function getSessionQr(
  sessionId
) {
  const response = await api.get(
    `/attendance/sessions/${sessionId}/qr`
  );

  return response.data;
}


export async function refreshSessionQr(
  sessionId
) {
  const response = await api.post(
    `/attendance/sessions/${sessionId}/qr/refresh`
  );

  return response.data;
}


export async function getLiveAttendance(
  sessionId
) {
  const response = await api.get(
    `/attendance/sessions/${sessionId}/live`
  );

  return response.data;
}


export async function markManualAttendance(
  sessionId,
  payload
) {
  const response = await api.post(
    `/attendance/sessions/${sessionId}/manual`,
    payload
  );

  return response.data;
}


// ============================================================
// Student attendance
// ============================================================

export async function getActiveStudentSessions() {
  const response = await api.get(
    "/attendance/student/active-sessions"
  );

  return response.data;
}


export async function submitStudentQrAttendance(
  sessionId,
  payload
) {
  const response = await api.post(
    `/attendance/student/sessions/${sessionId}/qr`,
    payload
  );

  return response.data;
}


export async function verifySessionQr(
  sessionId,
  payload
) {
  const response = await api.post(
    `/attendance/sessions/${sessionId}/qr/verify`,
    payload
  );

  return response.data;
}


export async function getMyAttendance() {
  const response = await api.get(
    "/attendance/student/me"
  );

  return response.data;
}