import axios from "axios";
import { getApiErrorMessage } from "../utils/errors.js";
import { resolveApiBaseUrl } from "./apiBaseUrl.js";

const API_ENV = import.meta.env || {};
let API_BASE_URL;
if (import.meta.env?.DEV !== false) {
  API_BASE_URL = resolveApiBaseUrl(
    { ...API_ENV, DEV: true },
    { developmentDefault: "http://127.0.0.1:8000" },
  );
} else {
  // Keep production resolution in its own statically selected branch so Vite
  // removes the development loopback URL from production bundles entirely.
  API_BASE_URL = resolveApiBaseUrl({ ...API_ENV, DEV: false });
}

export const TOKEN_KEY = "attendx_token";

const api = axios.create({
  baseURL: API_BASE_URL.replace(/\/+$/, ""),
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Har request ke saath token bhejein, agar available ho.
api.interceptors.request.use(
  (config) => {
    const preserveAuthorization = config.preserveAuthorization === true;
    delete config.preserveAuthorization;
    const token = config.skipAuth === true || preserveAuthorization ? null : localStorage.getItem(TOKEN_KEY);

    if (preserveAuthorization) {
      // A narrowly scoped caller supplied an explicit token (session restore).
      // Preserve it so an account switch cannot replace it with localStorage's token.
    } else if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    } else if (config.headers?.Authorization) {
      delete config.headers.Authorization;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// API errors ko readable message ke saath handle karein.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    error.userMessage = getApiErrorMessage(error);
    if (!error.response) {
      error.userMessage = error.request
        ? `AttendX API at ${API_BASE_URL} returned no response. Check that FastAPI is running and that the frontend origin is allowed by CORS.`
        : getApiErrorMessage(error, "The request could not be sent.");
    } else if (error.response.status === 401) {
      error.userMessage = getApiErrorMessage(error, "Login session invalid hai. Dobara login karein.");
    } else if (error.response.status === 403) {
      error.userMessage = getApiErrorMessage(error, "Aapko is action ki permission nahi hai.");
    } else if (error.response.status >= 500) {
      const detail = error.response.data?.detail;
      error.userMessage = detail != null
        ? getApiErrorMessage(error, "The backend request failed.")
        : `AttendX API returned HTTP ${error.response.status}. Check the backend logs for the server error.`;
    }
    return Promise.reject(error);
  }
);

export default api;
