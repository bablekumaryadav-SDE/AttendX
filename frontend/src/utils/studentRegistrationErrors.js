import { getApiErrorMessage } from "./errors.js";

const FIELD_NAMES = new Set([
  "name", "email", "date_of_birth", "gender", "enrollment_number", "roll_number",
  "course", "department", "admission_year", "admission_session",
  "program_duration_years", "current_academic_year", "current_semester", "section",
  "mobile", "address", "city", "state", "postal_code", "father_name", "mother_name",
  "parent_mobile", "parent_email", "guardian_name", "guardian_relationship",
  "initial_class_id", "password", "password_confirmation",
]);

const FALLBACK_MESSAGE = "Student registration could not be completed. Check the form and try again.";

export function mapStudentRegistrationFailure(failure) {
  const detail = failure?.response?.data?.detail;
  const fieldErrors = {};
  let formError = "";

  if (detail && !Array.isArray(detail) && typeof detail === "object") {
    const message = typeof detail.message === "string" ? detail.message : FALLBACK_MESSAGE;
    if (FIELD_NAMES.has(detail.field)) fieldErrors[detail.field] = message;
    else formError = message;
    return { fieldErrors, formError };
  }

  if (Array.isArray(detail)) {
    for (const issue of detail) {
      const path = Array.isArray(issue?.loc) ? issue.loc : [];
      const field = path.at(-1);
      const message = typeof issue?.msg === "string" ? issue.msg : FALLBACK_MESSAGE;
      if (FIELD_NAMES.has(field)) fieldErrors[field] = message;
      else if (!formError) formError = message;
    }
    return { fieldErrors, formError: formError || (Object.keys(fieldErrors).length ? "" : FALLBACK_MESSAGE) };
  }

  if (typeof detail === "string" && detail.trim()) formError = detail;
  else if (failure?.response?.status === 503) formError = "Student registration is temporarily unavailable. Please retry shortly.";
  else formError = FALLBACK_MESSAGE;
  return { fieldErrors, formError };
}

export function studentInvitationFailureMessage(failure) {
  const detail = failure?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (detail && typeof detail.message === "string" && detail.message.trim()) return detail.message;
  if (failure?.response?.status === 401) return "Your session has expired. Sign in again to manage invitations.";
  if (failure?.response?.status === 403) return "You are not authorized to manage invitations for this College.";
  if (failure?.response?.status === 404) return "Student record was not found in the selected College.";
  if (failure?.response?.status === 503) return "Invitation service is temporarily unavailable. Try again later.";
  return "Invitation could not be processed for the current Student account state.";
}

export function studentStatusActionFailureMessage(failure, action) {
  const normalizedAction = action === "activated" ? "activated" : "deactivated";
  if (failure?.response?.data?.detail != null) {
    return getApiErrorMessage(failure, `Student could not be ${normalizedAction}.`);
  }
  const messages = {
    401: "Your session expired. Sign in again, then retry the Student status change.",
    403: "An active College Admin membership is required to change Student status.",
    404: "Student not found in the selected College.",
    409: `Student ${normalizedAction} conflicts with the current account or membership state. Refresh the directory and retry.`,
    422: `The Student ${normalizedAction} request did not pass validation. Refresh the directory and retry.`,
    500: `The server could not complete Student ${normalizedAction}. Retry later or contact support.`,
    503: `The Student ${normalizedAction} service is temporarily unavailable. Retry later.`,
  };
  return messages[failure?.response?.status] || (failure?.response
    ? `Student could not be ${normalizedAction} (HTTP ${failure.response.status}).`
    : `Could not reach the server to ${normalizedAction} the Student. Check the connection and retry.`);
}
