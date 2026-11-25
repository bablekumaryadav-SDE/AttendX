export const COLLEGE_SELECTION_KEY = "attendx_college_id";

export function membershipIdentity(user) {
  const id = user?.id ?? user?.user_id;
  if (id != null && String(id).trim() !== "") return String(id);
  const email = String(user?.email ?? "").trim().toLowerCase();
  return email || null;
}

export function resolveConfirmedCollege(memberships, storedCollegeId) {
  const options = Array.isArray(memberships) ? memberships : [];
  const stored = storedCollegeId == null ? "" : String(storedCollegeId);
  if (stored && options.some((item) => String(item.college_id) === stored)) return stored;
  if (options.length === 1) return String(options[0].college_id);
  return null;
}

export function membershipLoadMessage(status, errorCode = null) {
  if (status == null) {
    if (errorCode === "ECONNABORTED" || errorCode === "ETIMEDOUT") {
      return "The College membership request timed out. Check the backend and retry.";
    }
    return "AttendX could not reach the backend. Check that the API is running and that its URL and CORS settings allow this frontend, then retry.";
  }
  if (status === 401) return "Your session expired. Sign in again to load College access.";
  if (status === 403) return "This account has no active College membership.";
  if (status === 404) return "The College membership endpoint was not found. Check that the frontend and backend versions match.";
  if (status === 409) return "Choose one College to continue.";
  if (status === 422) return "The backend rejected the College membership request. Refresh the page and retry.";
  if (status === 500) return "The server encountered an error while loading College memberships. Retry, and contact support if it continues.";
  if (status === 503) return "College selection is temporarily unavailable because the tenant schema is unavailable.";
  if (status >= 500) return `The server could not load College memberships (HTTP ${status}). Retry, and contact support if it continues.`;
  return "Unable to load your College memberships. Try refreshing the page.";
}

export function subjectLoadMessage(status) {
  if (status === 401) return "Your session expired. Sign in again.";
  if (status === 403) return "You do not have an active membership in the selected College.";
  if (status === 409) return "Select one active College before loading Subjects.";
  if (status === 503) return "The College Subjects catalog is temporarily unavailable.";
  return "Unable to load Subjects.";
}

export function classLoadMessage(status) {
  if (status === 401) return "Your session expired. Sign in again.";
  if (status === 403) return "You do not have an active membership in the selected College.";
  if (status === 404) return "This Class is not available in the selected College.";
  if (status === 409) return "Select one active College before loading Classes.";
  if (status === 503) return "The College Classes catalog is temporarily unavailable.";
  return "Unable to load Classes.";
}

export function teacherLoadMessage(status, detail = false) {
  if (status === 401) return "Your session expired. Sign in again.";
  if (status === 403) return "You do not have an active membership in the selected College.";
  if (status === 404 && detail) return "This Teacher profile is not available in the selected College.";
  if (status === 409) return "Select one active College before loading Teachers.";
  if (status === 503) return "The College Teachers catalog is temporarily unavailable.";
  return detail ? "Unable to load this Teacher profile." : "Unable to load Teachers.";
}

export function studentLoadMessage(status, detail = false) {
  if (status === 401) return "Your session expired. Sign in again.";
  if (status === 403) return "You do not have an active College Admin membership for this directory.";
  if (status === 404 && detail) return "This Student is not available in the selected College.";
  if (status === 409) return "Select one active College before loading Students.";
  if (status === 503) return "The College Students directory is temporarily unavailable.";
  return detail ? "Unable to load this Student profile." : "Unable to load Students.";
}


export function requireSelectedCollegeId(value) {
  const id = value == null ? "" : String(value).trim();
  const numericId = Number(id);
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(numericId) || numericId < 1) {
    const error = new Error("Select an active College before loading Subjects.");
    error.code = "COLLEGE_SELECTION_REQUIRED";
    throw error;
  }
  return numericId;
}

export function selectedCollegeParams(value) {
  return { params: { college_id: requireSelectedCollegeId(value) } };
}

export function confirmedSelectionChange(currentId, candidateId, memberships) {
  const candidate = String(candidateId ?? "");
  const confirmed = (Array.isArray(memberships) ? memberships : [])
    .some((item) => String(item.college_id) === candidate);
  if (!confirmed) return { selectedId: currentId ?? null, changed: false };
  return { selectedId: candidate, changed: candidate !== String(currentId ?? "") };
}

export function tenantViewKey(collegeId) {
  return collegeId ? `college:${collegeId}` : "college:unselected";
}

export function createSingleFlight() {
  const pending = new Map();
  return function runOnce(key, operation) {
    if (pending.has(key)) return pending.get(key);
    const request = Promise.resolve()
      .then(operation)
      .finally(() => {
        if (pending.get(key) === request) pending.delete(key);
      });
    pending.set(key, request);
    return request;
  };
}

export function getSingleFlightForIdentity(requestRef, identity, operation) {
  if (requestRef.current?.identity === identity) return requestRef.current;
  const entry = { identity, promise: Promise.resolve().then(operation) };
  requestRef.current = entry;
  return entry;
}

export function createLatestRequestGuard() {
  let currentVersion = 0;
  return {
    begin: () => ++currentVersion,
    isCurrent: (version) => version === currentVersion,
    invalidate: () => { currentVersion += 1; },
  };
}
