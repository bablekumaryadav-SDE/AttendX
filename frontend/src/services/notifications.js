import api from "./api";

export async function getNotificationHistory() {
  const response = await api.get("/notifications/history");
  return response.data;
}

export async function markNotificationRead(notificationId) {
  if (!Number.isInteger(Number(notificationId)) || Number(notificationId) < 1) {
    throw new Error("A valid notification ID is required.");
  }
  const response = await api.post(`/notifications/${Number(notificationId)}/read`);
  return response.data;
}
