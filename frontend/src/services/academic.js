import api from "./api.js";
import { selectedCollegeParams } from "./tenantSelection.js";

export async function getClasses(collegeId) {
  const response = await api.get("/classes/", selectedCollegeParams(collegeId));
  return response.data;
}

export async function getClass(id, collegeId) {
  if (!id) {
    throw new Error("Class ID is required.");
  }

  const response = await api.get(`/classes/${id}`, selectedCollegeParams(collegeId));
  return response.data;
}

export async function createClass(payload, collegeId) {
  const response = await api.post("/classes/", payload, selectedCollegeParams(collegeId));
  return response.data;
}

export async function updateClass(id, payload, collegeId) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) throw new Error("Class ID is required.");
  const response = await api.patch(`/classes/${Number(id)}`, payload, selectedCollegeParams(collegeId));
  return response.data;
}

export async function deactivateClass(id, collegeId) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) throw new Error("Class ID is required.");
  const response = await api.delete(`/classes/${Number(id)}`, selectedCollegeParams(collegeId));
  return response.data;
}

export async function getSubjects(collegeId) {
  const response = await api.get("/subjects/", selectedCollegeParams(collegeId));
  return response.data;
}

export async function getSubject(id, collegeId) {
  if (!id) {
    throw new Error("Subject ID is required.");
  }

  const response = await api.get(`/subjects/${id}`, selectedCollegeParams(collegeId));
  return response.data;
}

export async function createSubject(payload, collegeId) {
  const response = await api.post("/subjects/", payload, selectedCollegeParams(collegeId));
  return response.data;
}

export async function updateSubject(id, payload, collegeId) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) throw new Error("Subject ID is required.");
  const response = await api.patch(`/subjects/${Number(id)}`, payload, selectedCollegeParams(collegeId));
  return response.data;
}

export async function deactivateSubject(id, collegeId) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) throw new Error("Subject ID is required.");
  const response = await api.delete(`/subjects/${Number(id)}`, selectedCollegeParams(collegeId));
  return response.data;
}

export async function getAssignments() {
  const response = await api.get("/assignments/");
  return response.data;
}

export async function createAssignment(payload) {
  const response = await api.post("/assignments/", payload);
  return response.data;
}

export async function updateAssignment(id, payload) {
  const response = await api.put(`/assignments/${id}`, payload);
  return response.data;
}

export async function deactivateAssignment(id) {
  const response = await api.delete(`/assignments/${id}`);
  return response.data;
}

export async function activateAssignment(id) {
  const response = await api.put(`/assignments/${id}`, { is_active: true });
  return response.data;
}
