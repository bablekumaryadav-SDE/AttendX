import api from "./api";

/*
 * =========================================================
 * AttendX — Teacher API Service
 * =========================================================
 *
 * All requests use the shared Axios instance.
 * The shared api.js automatically attaches:
 *
 * Authorization: Bearer <JWT>
 *
 * Teacher administration is protected on the backend.
 */

/* =========================================================
   TEACHERS
   ========================================================= */

export async function getTeachers() {
  const response = await api.get("/teachers/");
  return response.data;
}

export async function getTeacher(id) {
  if (!id) {
    throw new Error("Teacher ID is required.");
  }

  const response = await api.get(`/teachers/${id}`);
  return response.data;
}

export async function createTeacher(payload) {
  if (!payload) {
    throw new Error("Teacher data is required.");
  }

  const response = await api.post("/teachers/", payload);
  return response.data;
}

export async function updateTeacher(id, payload) {
  if (!id) {
    throw new Error("Teacher ID is required.");
  }

  if (!payload) {
    throw new Error("Teacher data is required.");
  }

  const response = await api.put(`/teachers/${id}`, payload);
  return response.data;
}

export async function deactivateTeacher(id) {
  if (!id) {
    throw new Error("Teacher ID is required.");
  }

  const response = await api.delete(`/teachers/${id}`);
  return response.data;
}

export async function activateTeacher(id) {
  if (!id) {
    throw new Error("Teacher ID is required.");
  }

  const response = await api.post(`/teachers/${id}/activate`);
  return response.data;
}

/* =========================================================
   TEACHER ASSIGNMENTS
   ========================================================= */

export async function getTeacherAssignments(id) {
  if (!id) {
    throw new Error("Teacher ID is required.");
  }

  const response = await api.get(`/teachers/${id}/assignments`);
  return response.data;
}

/* =========================================================
   SUBJECTS
   ========================================================= */

export async function getSubjects() {
  const response = await api.get("/subjects/");
  return response.data;
}

/* =========================================================
   CLASSES
   ========================================================= */

export async function getClasses() {
  const response = await api.get("/classes/");
  return response.data;
}

/* =========================================================
   ASSIGNMENTS
   ========================================================= */

export async function createAssignment(payload) {
  if (!payload) {
    throw new Error("Assignment data is required.");
  }

  const response = await api.post("/assignments/", payload);
  return response.data;
}

export async function deleteAssignment(id) {
  if (!id) {
    throw new Error("Assignment ID is required.");
  }

  const response = await api.delete(`/assignments/${id}`);
  return response.data;
}