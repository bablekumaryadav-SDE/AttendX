import api from "./api";

export async function getAnalyticsOverview() {
  const response = await api.get("/analytics/overview");
  return response.data;
}

export async function getLowAttendance(threshold = 75) {
  const response = await api.get(
    `/analytics/low-attendance?threshold=${encodeURIComponent(threshold)}`
  );

  return response.data;
}

export async function getAdminDashboard() {
  const response = await api.get("/admin-dashboard");
  return response.data;
}

export async function getTeacherDashboard() {
  const response = await api.get(
    "/teacher-dashboard/teacher/dashboard"
  );

  return response.data;
}

export async function getBaseDashboard() {
  const response = await api.get("/dashboard");
  return response.data;
}