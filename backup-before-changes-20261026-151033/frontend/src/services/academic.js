import api from "./api";

export async function getClasses() {
  const response = await api.get("/classes/");
  return response.data;
}

export async function getClass(id) {
  if (!id) {
    throw new Error("Class ID is required.");
  }

  const response = await api.get(`/classes/${id}`);
  return response.data;
}

export async function createClass(payload) {
  if (!payload) {
    throw new Error("Class data is required.");
  }

  const response = await api.post("/classes/", payload);
  return response.data;
}

export async function updateClass(id, payload) {
  if (!id) {
    throw new Error("Class ID is required.");
  }

  if (!payload) {
    throw new Error("Class data is required.");
  }

  const response = await api.put(`/classes/${id}`, payload);
  return response.data;
}

export async function deleteClass(id) {
  if (!id) {
    throw new Error("Class ID is required.");
  }

  const response = await api.delete(`/classes/${id}`);
  return response.data;
}

export async function getSubjects() {
  const response = await api.get("/subjects/");
  return response.data;
}

export async function getSubject(id) {
  if (!id) {
    throw new Error("Subject ID is required.");
  }

  const response = await api.get(`/subjects/${id}`);
  return response.data;
}

export async function createSubject(payload) {
  if (!payload) {
    throw new Error("Subject data is required.");
  }

  const response = await api.post("/subjects/", payload);
  return response.data;
}

export async function updateSubject(id, payload) {
  if (!id) {
    throw new Error("Subject ID is required.");
  }

  if (!payload) {
    throw new Error("Subject data is required.");
  }

  const response = await api.put(`/subjects/${id}`, payload);
  return response.data;
}

export async function deleteSubject(id) {
  if (!id) {
    throw new Error("Subject ID is required.");
  }

  const response = await api.delete(`/subjects/${id}`);
  return response.data;
}