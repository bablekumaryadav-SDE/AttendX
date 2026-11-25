import api from "./api.js";
import { requireSelectedCollegeId } from "./tenantSelection.js";

// Tenant-scoped Student reads plus narrowly authorized registration and progression.
export async function getTenantStudents(collegeId, filters = {}) {
  const params = Object.fromEntries(Object.entries({
    search: filters.search,
    active_only: filters.activeOnly,
    course: filters.course,
    department: filters.department,
    admission_year: filters.admissionYear,
    current_academic_year: filters.currentAcademicYear,
    current_semester: filters.currentSemester,
    section: filters.section,
    page: filters.page,
    page_size: filters.pageSize,
    college_id: requireSelectedCollegeId(collegeId),
  }).filter(([, value]) => value !== undefined && value !== null && value !== ""));
  const response = await api.get("/students/", { params });
  return response.data;
}

export async function getTenantStudent(studentId, collegeId) {
  if (!Number.isSafeInteger(Number(studentId)) || Number(studentId) < 1) {
    throw new Error("Student ID is required.");
  }
  const response = await api.get(`/students/${Number(studentId)}`, {
    params: { college_id: requireSelectedCollegeId(collegeId) },
  });
  return response.data;
}

export async function createTenantStudent(payload, collegeId) {
  const response = await api.post("/students/", payload, {
    params: { college_id: requireSelectedCollegeId(collegeId) },
  });
  return response.data;
}

export async function updateTenantStudent(studentId, payload, collegeId) {
  if (!Number.isSafeInteger(Number(studentId)) || Number(studentId) < 1) throw new Error("Student ID is required.");
  const response = await api.patch(`/students/${Number(studentId)}`, payload, {
    params: { college_id: requireSelectedCollegeId(collegeId) },
  });
  return response.data;
}

export async function deactivateTenantStudent(studentId, collegeId) {
  if (!Number.isSafeInteger(Number(studentId)) || Number(studentId) < 1) throw new Error("Student ID is required.");
  const response = await api.delete(`/students/${Number(studentId)}`, {
    params: { college_id: requireSelectedCollegeId(collegeId) },
  });
  return response.data;
}

export async function resetTenantStudentPassword(studentId, payload, collegeId) {
  if (!Number.isSafeInteger(Number(studentId)) || Number(studentId) < 1) throw new Error("Student ID is required.");
  const response = await api.patch(`/students/${Number(studentId)}/password`, payload, {
    params: { college_id: requireSelectedCollegeId(collegeId) },
  });
  return response.data;
}

export async function getTenantStudentClassAssignments(studentId, collegeId) {
  if (!Number.isSafeInteger(Number(studentId)) || Number(studentId) < 1) throw new Error("Student ID is required.");
  const response = await api.get(`/students/${Number(studentId)}/class-assignments`, {
    params: { college_id: requireSelectedCollegeId(collegeId) },
  });
  return response.data;
}

export async function assignTenantStudentToClass(studentId, payload, collegeId) {
  if (!Number.isSafeInteger(Number(studentId)) || Number(studentId) < 1) throw new Error("Student ID is required.");
  const response = await api.post(`/students/${Number(studentId)}/class-assignments`, payload, {
    params: { college_id: requireSelectedCollegeId(collegeId) },
  });
  return response.data;
}

export async function deactivateTenantStudentClassAssignment(studentId, assignmentId, collegeId) {
  if (!Number.isSafeInteger(Number(studentId)) || Number(studentId) < 1 || !Number.isSafeInteger(Number(assignmentId)) || Number(assignmentId) < 1) {
    throw new Error("Student and assignment IDs are required.");
  }
  const response = await api.delete(`/students/${Number(studentId)}/class-assignments/${Number(assignmentId)}`, {
    params: { college_id: requireSelectedCollegeId(collegeId) },
  });
  return response.data;
}

export async function getTenantStudentAcademicHistory(studentId, collegeId) {
  if (!Number.isSafeInteger(Number(studentId)) || Number(studentId) < 1) {
    throw new Error("Student ID is required.");
  }
  const response = await api.get(`/students/${Number(studentId)}/academic-history`, {
    params: { college_id: requireSelectedCollegeId(collegeId) },
  });
  return response.data;
}

export async function promoteTenantStudent(studentId, payload, collegeId) {
  if (!Number.isSafeInteger(Number(studentId)) || Number(studentId) < 1) {
    throw new Error("Student ID is required.");
  }
  const response = await api.post(`/students/${Number(studentId)}/promotions`, payload, {
    params: { college_id: requireSelectedCollegeId(collegeId) },
  });
  return response.data;
}

export async function getTenantStudentInvitation(studentId, collegeId) {
  const response = await api.get(`/students/${Number(studentId)}/invitation`, {
    params: { college_id: requireSelectedCollegeId(collegeId) },
  });
  return response.data;
}

export async function resendTenantStudentInvitation(studentId, collegeId) {
  const response = await api.post(`/students/${Number(studentId)}/invitation/resend`, null, {
    params: { college_id: requireSelectedCollegeId(collegeId) },
  });
  return response.data;
}
