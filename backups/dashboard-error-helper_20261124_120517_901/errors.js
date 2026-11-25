export function formatApiError(value, fallback = "The request could not be completed.") {
  const seen = new WeakSet();

  function format(item, context = "") {
    if (item == null) return "";
    if (typeof item === "string") return item.trim();
    if (typeof item === "number" || typeof item === "boolean") return String(item);

    if (Array.isArray(item)) {
      const parts = item.map((entry) => format(entry)).filter(Boolean);
      return parts.join("; ");
    }

    if (typeof item === "object") {
      if (seen.has(item)) return "";
      seen.add(item);

      if (typeof item.msg === "string") {
        const location = Array.isArray(item.loc)
          ? item.loc.filter((part) => part !== "body" && part !== "query" && part !== "path").join(".")
          : typeof item.loc === "string" ? item.loc : "";
        return `${location ? `${location} - ` : ""}${item.msg}`;
      }

      for (const key of ["detail", "message", "error", "reason"] ) {
        if (item[key] != null) {
          const nested = format(item[key], key);
          if (nested) return nested;
        }
      }

      const entries = Object.entries(item)
        .filter(([key]) => !["input", "ctx", "body"].includes(key))
        .map(([key, nested]) => {
          const message = format(nested, key);
          return message ? `${key}: ${message}` : "";
        })
        .filter(Boolean);
      return entries.join("; ");
    }

    return context ? `${context}: ${String(item)}` : "";
  }

  const message = format(value);
  if (!message) return fallback;
  return Array.isArray(value) ? `Validation error: ${message}` : message;
}

export function getApiErrorMessage(error, fallback = "The request could not be completed.") {
  if (typeof error?.userMessage === "string" && error.userMessage.trim()) {
    return error.userMessage;
  }
  const detail = error?.response?.data?.detail;
  if (detail != null) return formatApiError(detail, fallback);
  const message = error?.message;
  return typeof message === "string" && message.trim() ? message : fallback;
}
