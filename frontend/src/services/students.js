import api from "./api";

// ---------------------------------------------------------
// Students
// ---------------------------------------------------------

export async function getStudents(params = {}) {
  const response = await api.get("/students", {
    params,
  });

  return response.data;
}

export async function getStudent(studentId) {
  const response = await api.get(
    `/students/${studentId}`
  );

  return response.data;
}

export async function createStudent(student) {
  const response = await api.post(
    "/students",
    student
  );

  return response.data;
}

export async function updateStudent(
  studentId,
  student
) {
  const response = await api.put(
    `/students/${studentId}`,
    student
  );

  return response.data;
}

export async function deactivateStudent(
  studentId
) {
  const response = await api.delete(
    `/students/${studentId}`
  );

  return response.data;
}

export async function activateStudent(
  studentId
) {
  const response = await api.post(
    `/students/${studentId}/activate`
  );

  return response.data;
}

// ---------------------------------------------------------
// Face registration
// ---------------------------------------------------------

export async function registerStudentFace(
  studentId,
  file
) {
  if (!studentId) {
    throw new Error(
      "Student ID is required for face registration."
    );
  }

  if (!file) {
    throw new Error(
      "A face image is required."
    );
  }

  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
  ];

  if (!allowedTypes.includes(file.type)) {
    throw new Error(
      "Only JPG, PNG, and WEBP images are supported."
    );
  }

  const maxSize =
    5 * 1024 * 1024;

  if (file.size > maxSize) {
    throw new Error(
      "Face image must be smaller than 5 MB."
    );
  }

  const formData = new FormData();

  formData.append(
    "file",
    file,
    file.name || "face-registration.jpg"
  );

  const response = await api.post(
    `/students/${studentId}/face`,
    formData,
    {
      headers: {
        "Content-Type":
          "multipart/form-data",
      },
      timeout: 30000,
    }
  );

  return response.data;
}

export async function removeStudentFace(
  studentId
) {
  const response = await api.delete(
    `/students/${studentId}/face`
  );

  return response.data;
}

// ---------------------------------------------------------
// Parent / Guardian
// ---------------------------------------------------------

export async function getStudentGuardian(
  studentId
) {
  const response = await api.get(
    `/students/${studentId}/guardian`
  );

  return response.data;
}

export async function saveStudentGuardian(
  studentId,
  guardian
) {
  if (!studentId) {
    throw new Error(
      "Student ID is required."
    );
  }

  const response = await api.put(
    `/students/${studentId}/guardian`,
    guardian
  );

  return response.data;
}