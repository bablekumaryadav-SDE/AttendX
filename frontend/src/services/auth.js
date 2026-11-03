import api from "./api";
import { getApiErrorMessage } from "../utils/errors";

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
        "Backend se response nahi mila. Backend server, API URL aur CORS check karein."
      );
    }

    throw error;
  }
}

// ============================================================
// CURRENT USER
// ============================================================

export async function getCurrentUser(token) {
  if (!token) {
    throw new Error("Authentication token nahi mila.");
  }

  try {
    const response = await api.get("/auth/me", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    return response.data;
  } catch (error) {
    if (error.response) {
      throw new Error(getApiErrorMessage(error, `User details load nahi hue. HTTP status: ${error.response.status}`));
    }

    if (error.request) {
      throw new Error(
        "Backend se response nahi mila. API connection check karein."
      );
    }

    throw error;
  }
}
