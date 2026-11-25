import api from "./api.js";

export async function completeAccountActivation(token, password) {
  const response = await api.post(
    "/account-activation/complete",
    { token, password },
    { skipAuth: true },
  );
  return response.data;
}
