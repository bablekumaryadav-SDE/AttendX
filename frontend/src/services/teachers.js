import api from "./api.js";
import { selectedCollegeParams } from "./tenantSelection.js";

/*
 * =========================================================
 * AttendX â€” Teacher API Service
 * =========================================================
 *
 * All requests use the shared Axios instance.
 * The shared api.js automatically attaches:
 *
 * Authorization: Bearer <JWT>
 *
 * Tenant Teacher reads require an explicit, server-validated College ID.
 */

/* =========================================================
   TEACHERS
   ========================================================= */

export async function getTeachers(collegeId) {
  const response = await api.get("/teachers/", selectedCollegeParams(collegeId));
  return response.data;
}

export async function getMyTeacherProfile(collegeId) {
  const response = await api.get("/teachers/me/profile", selectedCollegeParams(collegeId));
  return response.data;
}

export async function getTeacher(id, collegeId) {
  if (!id) {
    throw new Error("Teacher ID is required.");
  }

  const response = await api.get(`/teachers/${id}`, selectedCollegeParams(collegeId));
  return response.data;
}

export async function getTeacherManagementProfile(id, collegeId) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) throw new Error("Teacher ID is required.");
  const response = await api.get(`/teachers/${Number(id)}/management-profile`, selectedCollegeParams(collegeId));
  return response.data;
}

export async function getTeacherAccountLink(id, collegeId) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) throw new Error("Teacher ID is required.");
  const response = await api.get(`/tenant/account-links/teachers/${Number(id)}`, selectedCollegeParams(collegeId));
  return response.data;
}

export async function searchTeacherAccountLinkCandidates(search, collegeId) {
  const term = String(search || "").trim();
  if (term.length < 2) throw new Error("Enter at least two characters to search existing accounts.");
  const config = selectedCollegeParams(collegeId);
  config.params = { ...config.params, search: term, limit: 25 };
  const response = await api.get("/tenant/account-links/teachers/eligible-users", config);
  return response.data;
}

export async function createTeacherAccountLink(id, userId, collegeId) {
  const teacherId = Number(id);
  const linkedUserId = Number(userId);
  if (!Number.isSafeInteger(teacherId) || teacherId < 1 || !Number.isSafeInteger(linkedUserId) || linkedUserId < 1) {
    throw new Error("Teacher profile ID and verified User ID are required.");
  }
  const response = await api.post(
    `/tenant/account-links/teachers/${teacherId}`,
    { user_id: linkedUserId, identity_verified: true },
    selectedCollegeParams(collegeId),
  );
  return response.data;
}

export async function reconcileLegacyTeacher(id, payload, collegeId) {
  const config = selectedCollegeParams(collegeId);
  const teacherId = Number(id);
  const userId = Number(payload?.user_id);
  if (!Number.isSafeInteger(teacherId) || teacherId < 1 || !Number.isSafeInteger(userId) || userId < 1) {
    throw new Error("Select an existing Teacher profile and login account.");
  }
  if (payload?.relationship_attested !== true) throw new Error("Confirm the selected Teacher and login belong together based on institutional records.");
  const body = {
    user_id: userId,
    relationship_attested: true,
    reason: String(payload?.reason || "").trim() || null,
  };
  if (body.reason && body.reason.length > 500) throw new Error("Keep the optional reason under 500 characters.");
  const response = await api.post(
    `/tenant/account-links/teachers/${teacherId}/legacy-reconcile`,
    body,
    config,
  );
  return response.data;
}

export async function revokeTeacherAccountLink(id, reason, collegeId) {
  const linkId = Number(id);
  if (!Number.isSafeInteger(linkId) || linkId < 1) throw new Error("Account link ID is required.");
  const response = await api.post(
    `/tenant/account-links/teachers/${linkId}/revoke`,
    { reason },
    selectedCollegeParams(collegeId),
  );
  return response.data;
}

export async function getTeacherProfileVerification(id, collegeId) {
  const teacherId = Number(id);
  if (!Number.isSafeInteger(teacherId) || teacherId < 1) throw new Error("Teacher ID is required.");
  const response = await api.get(`/teachers/${teacherId}/verification`, selectedCollegeParams(collegeId));
  return response.data;
}

export async function reviewTeacherProfileVerification(id, verificationStatus, reason, collegeId) {
  const teacherId = Number(id);
  if (!Number.isSafeInteger(teacherId) || teacherId < 1) throw new Error("Teacher ID is required.");
  if (!["verified", "rejected"].includes(verificationStatus)) throw new Error("Select a supported verification action.");
  const normalizedReason = String(reason || "").trim();
  if (normalizedReason.length < 5) throw new Error("Provide a verification reason of at least five characters.");
  const response = await api.put(
    `/teachers/${teacherId}/verification`,
    { verification_status: verificationStatus, reason: normalizedReason },
    selectedCollegeParams(collegeId),
  );
  return response.data;
}

export async function reconcileTrustedTeacherRegistration(id, collegeId) {
  const teacherId = Number(id);
  if (!Number.isSafeInteger(teacherId) || teacherId < 1) throw new Error("Teacher ID is required.");
  const response = await api.post(
    `/teachers/${teacherId}/registration-reconcile`,
    null,
    selectedCollegeParams(collegeId),
  );
  return response.data;
}

export async function getTeacherProfileVerificationHistory(id, collegeId) {
  const teacherId = Number(id);
  if (!Number.isSafeInteger(teacherId) || teacherId < 1) throw new Error("Teacher ID is required.");
  const response = await api.get(`/teachers/${teacherId}/verification-history`, selectedCollegeParams(collegeId));
  return response.data;
}

export async function updateTeacherProfile(id, payload, collegeId) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) throw new Error("Teacher ID is required.");
  const response = await api.patch(`/teachers/${Number(id)}`, payload, selectedCollegeParams(collegeId));
  return response.data;
}

export async function deactivateTeacher(id, collegeId) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) throw new Error("Teacher ID is required.");
  const response = await api.delete(`/teachers/${Number(id)}`, selectedCollegeParams(collegeId));
  return response.data;
}

export async function activateTeacher(id, collegeId) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) throw new Error("Teacher ID is required.");
  const response = await api.patch(`/teachers/${Number(id)}/activate`, {}, selectedCollegeParams(collegeId));
  return response.data;
}

export async function getTeacherAssignments(id, collegeId) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) throw new Error("Teacher ID is required.");
  const response = await api.get(`/teachers/${Number(id)}/assignments`, selectedCollegeParams(collegeId));
  return response.data;
}

export async function assignTeacher(id, payload, collegeId) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) throw new Error("Teacher ID is required.");
  const response = await api.post(`/teachers/${Number(id)}/assignments`, payload, selectedCollegeParams(collegeId));
  return response.data;
}

export async function deactivateTeacherAssignment(id, assignmentId, collegeId) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1 || !Number.isSafeInteger(Number(assignmentId)) || Number(assignmentId) < 1) {
    throw new Error("Teacher and assignment IDs are required.");
  }
  const response = await api.delete(`/teachers/${Number(id)}/assignments/${Number(assignmentId)}`, selectedCollegeParams(collegeId));
  return response.data;
}

export async function createTeacher(payload, collegeId) {
  const response = await api.post("/teachers/", payload, selectedCollegeParams(collegeId));
  return response.data;
}

export async function resetTeacherPassword(id, payload, collegeId) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) throw new Error("Teacher ID is required.");
  const response = await api.patch(`/teachers/${Number(id)}/password`, payload, selectedCollegeParams(collegeId));
  return response.data;
}

export async function getTeacherInvitation(id, collegeId) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) throw new Error("Teacher ID is required.");
  const response = await api.get(`/teachers/${Number(id)}/invitation`, selectedCollegeParams(collegeId));
  return response.data;
}

export function teacherInvitationFromSettledResult(result) {
  if (result?.status === "fulfilled") return result.value;
  const failure = result?.reason;
  const status = failure?.response?.status;
  const detail = failure?.response?.data?.detail;
  if (status === 409 && detail === "No verified Teacher account link is available for this profile.") {
    return {
      status: "link_required",
      message: "Invitation status cannot be checked yet. Verify the existing Teacher login in the account-link section first.",
    };
  }
  if (status === 409) {
    return { status: "conflict", message: detail || "The invitation state conflicts with the current account state." };
  }
  if (status === 404) {
    return { status: "not_found", message: "The Teacher profile was not found in the selected College." };
  }
  if (status === 503) {
    return { status: "unavailable", message: "Invitation status is temporarily unavailable. Refresh the Teacher details after the service is restored." };
  }
  return { status: "unavailable", message: "Invitation status could not be loaded. Refresh the Teacher details to retry." };
}

export async function resendTeacherInvitation(id, collegeId) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) throw new Error("Teacher ID is required.");
  const response = await api.post(`/teachers/${Number(id)}/invitation/resend`, null, selectedCollegeParams(collegeId));
  return response.data;
}

/* =========================================================
   SUBJECTS
   ========================================================= */

export async function getSubjects(collegeId) {
  const response = await api.get("/subjects/", selectedCollegeParams(collegeId));
  return response.data;
}

/* =========================================================
   CLASSES
   ========================================================= */

export async function getClasses(collegeId) {
  const response = await api.get("/classes/", selectedCollegeParams(collegeId));
  return response.data;
}
