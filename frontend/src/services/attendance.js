import api from "./api";

export async function getMyFaceStatus() {
  const response = await api.get("/face/me/status");
  return response.data;
}

export async function registerMyFace(file) {
  if (!file) throw new Error("Capture a face image before registration.");
  const formData = new FormData();
  formData.append("file", file, file.name || "my-face.jpg");
  const response = await api.post("/face/me/register", formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 30000,
  });
  return response.data;
}


// ============================================================
// Teacher attendance sessions
// ============================================================

export async function getAttendanceSessions() {
  const response = await api.get(
    "/attendance/sessions",
    { timeout: 10000 }
  );

  return response.data;
}


export async function createAttendanceSession(
  payload
) {
  const response = await api.post(
    "/attendance/sessions",
    payload,
    { timeout: 15000 }
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

export async function submitStudentFaceAttendance(sessionId, file, coordinates = null) {
  if (!sessionId || !file) throw new Error("An active session and face capture are required.");
  const formData = new FormData();
  formData.append("file", file, file.name || "attendance-face.jpg");
  if (coordinates?.latitude != null) formData.append("latitude", String(coordinates.latitude));
  if (coordinates?.longitude != null) formData.append("longitude", String(coordinates.longitude));
  const response = await api.post(`/attendance/student/sessions/${sessionId}/face`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 30000,
  });
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
