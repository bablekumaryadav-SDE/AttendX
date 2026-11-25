export function submitCollegeRegistration(payload) {
  return globalThis.__collegeRegistrationMock.submit(payload);
}

export function checkCollegeRegistrationStatus(payload) {
  return globalThis.__collegeRegistrationMock.checkStatus(payload);
}

export function listCollegeApplications(status, q) {
  return globalThis.__collegeRegistrationMock.list(status, q);
}

export function getCollegeApplication(id) {
  return globalThis.__collegeRegistrationMock.get(id);
}

export function getCollegeApplicationHistory(id) {
  return globalThis.__collegeRegistrationMock.history(id);
}

export function startCollegeApplicationReview(id, reason) {
  return globalThis.__collegeRegistrationMock.start(id, reason);
}

export function approveCollegeApplication(id, reason) {
  return globalThis.__collegeRegistrationMock.approve(id, reason);
}

export function rejectCollegeApplication(id, reason) {
  return globalThis.__collegeRegistrationMock.reject(id, reason);
}

export function listPlatformColleges(params) {
  return globalThis.__collegeRegistrationMock.listColleges(params);
}

export function getPlatformCollege(id) {
  return globalThis.__collegeRegistrationMock.getCollege(id);
}

export function getPlatformCollegeHistory(id) {
  return globalThis.__collegeRegistrationMock.collegeHistory(id);
}

export function updatePlatformCollege(id, payload) {
  return globalThis.__collegeRegistrationMock.updateCollege(id, payload);
}

export function setPlatformCollegeStatus(id, nextStatus, reason) {
  return globalThis.__collegeRegistrationMock.setCollegeStatus(id, nextStatus, reason);
}
