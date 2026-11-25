import api from "./api.js";

export async function getMyFaceStatus(collegeId) {
  if (!collegeId) throw new Error("Select an active College before checking face registration.");
  const response = await api.get("/tenant/face/me", { params: { college_id: collegeId } });
  return response.data;
}

export async function registerMyFace(file, collegeId, consent) {
  if (!file) throw new Error("Capture a face image before registration.");
  if (!collegeId) throw new Error("Select an active College before registering your face.");
  const formData = new FormData();
  formData.append("file", file, file.name || "my-face.jpg");
  formData.append("consent", consent ? "true" : "false");
  const response = await api.post("/tenant/face/me/register", formData, {
    params: { college_id: collegeId },
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

export async function getActiveStudentSessions(collegeId) {
  if (!collegeId) throw new Error("Select an active College before loading attendance sessions.");
  const response = await api.get("/tenant/face/student/sessions", { params: { college_id: collegeId } });

  return response.data;
}


export async function submitStudentQrAttendance(
  sessionId,
  payload,
  collegeId
) {
  if (!collegeId) throw new Error("Select an active College before submitting attendance.");
  const response = await api.post(`/tenant/face/student/sessions/${sessionId}/qr`, payload, { params: { college_id: collegeId } });

  return response.data;
}

export async function submitStudentFaceAttendance(sessionId, file, coordinates = null, collegeId) {
  if (!sessionId || !file) throw new Error("An active session and face capture are required.");
  if (!collegeId) throw new Error("Select an active College before submitting attendance.");
  const formData = new FormData();
  formData.append("file", file, file.name || "attendance-face.jpg");
  if (coordinates?.latitude != null) formData.append("latitude", String(coordinates.latitude));
  if (coordinates?.longitude != null) formData.append("longitude", String(coordinates.longitude));
  if (coordinates?.accuracy != null) formData.append("accuracy_m", String(coordinates.accuracy));
  const response = await api.post(`/tenant/face/student/sessions/${sessionId}/face`, formData, {
    params: { college_id: collegeId },
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


export async function getMyAttendance(collegeId) {
  if (!collegeId) throw new Error("Select an active College before loading attendance history.");
  const response = await api.get("/tenant/face/student/attendance", { params: { college_id: collegeId } });

  return response.data;
}
