function isLoopback(hostname) {
  const host = String(hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost"
    || host.endsWith(".localhost")
    || host === "::1"
    || host === "0.0.0.0"
    || /^127(?:\.\d{1,3}){3}$/.test(host);
}

export function normalizeApiBaseUrl(value, {
  isDevelopment = false,
  developmentDefault,
  allowSameOriginPath = false,
} = {}) {
  if (typeof value !== "string" || value.trim() === "") {
    if (isDevelopment && developmentDefault) return developmentDefault;
    throw new Error("VITE_API_BASE_URL or VITE_API_URL is required for production.");
  }

  // A same-origin API prefix is appropriate when a reverse proxy (such as
  // the deployment Nginx config) serves the UI and forwards /api to FastAPI.
  // Keep this opt-in so arbitrary relative URLs remain invalid by default.
  if (allowSameOriginPath && /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?$/.test(value.trim())) {
    return value.trim().replace(/\/+$/, "");
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("The frontend API base URL must be an absolute HTTP(S) URL.");
  }

  if (!(["http:", "https:"].includes(parsed.protocol))
    || !parsed.hostname
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash) {
    throw new Error("The frontend API base URL contains unsupported URL components.");
  }

  if (!isDevelopment && (parsed.protocol !== "https:" || isLoopback(parsed.hostname))) {
    throw new Error("Production API configuration must use a non-loopback HTTPS URL.");
  }

  return parsed.toString().replace(/\/+$/, "");
}

export function resolveApiBaseUrl(env = {}, { developmentDefault } = {}) {
  const configured = [env.VITE_API_BASE_URL, env.VITE_API_URL]
    .filter((candidate) => typeof candidate === "string" && candidate.trim() !== "");

  if (configured.length > 1) {
    const normalized = configured.map((candidate) => normalizeApiBaseUrl(candidate, {
      isDevelopment: env.DEV === true,
      allowSameOriginPath: env.DEV !== true,
    }));
    if (normalized.some((candidate) => candidate !== normalized[0])) {
      throw new Error("VITE_API_BASE_URL and VITE_API_URL must use the same API base URL.");
    }
    return normalized[0];
  }

  return normalizeApiBaseUrl(configured[0], {
    isDevelopment: env.DEV === true,
    developmentDefault,
    allowSameOriginPath: env.DEV !== true,
  });
}
