import api from "./api";

export async function getNotificationHistory() {
  const response = await api.get("/notifications/history");
  return response.data;
}