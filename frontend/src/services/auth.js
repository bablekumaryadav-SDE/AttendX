import api from "./api.js";
import { getApiErrorMessage } from "../utils/errors.js";

const currentUserRequests = new Map();

// ============================================================
// LOGIN
// ============================================================

export async function loginUser(email, password) {
  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();

  if (!normalizedEmail || !password) {
    throw new Error("Email aur password required hain.");
  }

  try {
    const response = await api.post("/auth/login", {
      email: normalizedEmail,
      password,
    });

    if (!response.data) {
      throw new Error("Backend se empty login response mila.");
    }

    return response.data;
  } catch (error) {
    if (error.response) {
      throw new Error(getApiErrorMessage(error, `Login request fail hui. HTTP status: ${error.response.status}`));
    }

    if (error.request) {
      throw new Error(
        error.userMessage || "Backend se response nahi mila. Backend server, API URL aur CORS check karein."
      );
    }

    throw error;
  }
}

// ============================================================
// CURRENT USER
// ============================================================

export function getCurrentUser(token) {
  if (!token) {
    return Promise.reject(new Error("Authentication token nahi mila."));
  }

  const pending = currentUserRequests.get(token);
  if (pending) return pending;

  const request = api.get("/auth/me", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      preserveAuthorization: true,
    })
    .then((response) => response.data)
    .catch((error) => {
      if (error.response) {
        throw new Error(getApiErrorMessage(error, `User details load nahi hue. HTTP status: ${error.response.status}`));
      }

      if (error.request) {
        throw new Error(
          "Backend se response nahi mila. API connection check karein."
        );
      }

      throw error;
    });
  currentUserRequests.set(token, request);
  const clearRequest = () => {
    if (currentUserRequests.get(token) === request) currentUserRequests.delete(token);
  };
  request.then(clearRequest, clearRequest);

  return request;
}
