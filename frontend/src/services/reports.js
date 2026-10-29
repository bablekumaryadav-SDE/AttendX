import api from "./api";

export async function getAnalyticsOverview() {
  const response = await api.get("/analytics/overview");
  return response.data;
}

export async function getLowAttendance(threshold = 75) {
  const response = await api.get("/analytics/low-attendance", {
    params: {
      threshold,
    },
  });

  return response.data;
}

export async function getReportSessions() {
  const response = await api.get("/attendance/sessions");
  return response.data;
}