import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import api from "../src/services/api.js";
import { assignTeacher, createTeacher, deactivateTeacher, deactivateTeacherAssignment, getTeacher, getTeacherAssignments, getTeacherManagementProfile, getTeachers, resetTeacherPassword, updateTeacherProfile } from "../src/services/teachers.js";
import { teacherLoadMessage } from "../src/services/tenantSelection.js";

test("Teacher list/detail clients pass explicit College selection using GET", async () => {
  const calls = [];
  const oldAdapter = api.defaults.adapter;
  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: (key) => key === "attendx_token" ? "synthetic-token" : null };
  api.defaults.adapter = async (config) => {
    calls.push({ method: config.method, url: config.url, collegeId: config.params?.college_id });
    return { data: [], status: 200, statusText: "OK", headers: {}, config };
  };
  try {
    await getTeachers(121);
    await getTeacher(1201, 122);
    await createTeacher({ name: "Synthetic Teacher" }, 123);
    await resetTeacherPassword(1201, { password: "Synthetic!Teacher2026", password_confirmation: "Synthetic!Teacher2026" }, 124);
    await getTeacherManagementProfile(1201, 125);
    await updateTeacherProfile(1201, { name: "Updated" }, 126);
    await deactivateTeacher(1201, 127);
    await getTeacherAssignments(1201, 128);
    await assignTeacher(1201, { class_id: 1 }, 129);
    await deactivateTeacherAssignment(1201, 91, 130);
    assert.deepEqual(calls, [
      { method: "get", url: "/teachers/", collegeId: 121 },
      { method: "get", url: "/teachers/1201", collegeId: 122 },
      { method: "post", url: "/teachers/", collegeId: 123 },
      { method: "patch", url: "/teachers/1201/password", collegeId: 124 },
      { method: "get", url: "/teachers/1201/management-profile", collegeId: 125 },
      { method: "patch", url: "/teachers/1201", collegeId: 126 },
      { method: "delete", url: "/teachers/1201", collegeId: 127 },
      { method: "get", url: "/teachers/1201/assignments", collegeId: 128 },
      { method: "post", url: "/teachers/1201/assignments", collegeId: 129 },
      { method: "delete", url: "/teachers/1201/assignments/91", collegeId: 130 },
    ]);
    await assert.rejects(getTeachers(null), { code: "COLLEGE_SELECTION_REQUIRED" });
    await assert.rejects(getTeacher(1201, null), { code: "COLLEGE_SELECTION_REQUIRED" });
    await assert.rejects(createTeacher({ name: "No College" }, null), { code: "COLLEGE_SELECTION_REQUIRED" });
    await assert.rejects(resetTeacherPassword(1201, {}, null), { code: "COLLEGE_SELECTION_REQUIRED" });
    await assert.rejects(updateTeacherProfile(1201, {}, null), { code: "COLLEGE_SELECTION_REQUIRED" });
    await assert.rejects(assignTeacher(1201, {}, null), { code: "COLLEGE_SELECTION_REQUIRED" });
    assert.equal(calls.length, 10);
  } finally {
    api.defaults.adapter = oldAdapter;
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldStorage;
  }
});

test("Teacher API errors have safe messages for required statuses", () => {
  assert.match(teacherLoadMessage(401), /session expired/i);
  assert.match(teacherLoadMessage(403), /active membership/i);
  assert.match(teacherLoadMessage(404, true), /not available/i);
  assert.match(teacherLoadMessage(409), /Select one active College/i);
  assert.match(teacherLoadMessage(503), /temporarily unavailable/i);
});

test("Teachers screen uses AuthContext, clears stale data, and rejects stale responses", async () => {
  const source = await readFile(new URL("../src/pages/auth/admin/Teachers.jsx", import.meta.url), "utf8");
  assert.match(source, /const \{ user, activeCollegeId, collegeMemberships \} = useAuth\(\)/);
  assert.match(source, /membership\.membership_role === "college_admin"/);
  assert.match(source, /getTeachers\(activeCollegeId\)/);
  assert.match(source, /getTeacher\(teacher\.id, activeCollegeId\)/);
  assert.match(source, /setTeachers\(\[\]\)/);
  assert.match(source, /setSelectedTeacher\(null\)/);
  assert.match(source, /createLatestRequestGuard/);
  assert.match(source, /isCurrent\(version\)/);
  assert.match(source, /aria-label="Search teachers"/);
  assert.match(source, /Filter by status/);
  assert.match(source, /Filter by department/);
  assert.match(source, /teacher-stat-grid/);
  assert.match(source, /teacher-table/);
  assert.match(source, /teacher-modal teacher-view/);
  assert.match(source, /createTeacher\(payload, submittedCollegeId\)/);
  assert.match(source, /name="password" type="password"/);
  assert.match(source, /name="password_confirmation" type="password"/);
  assert.match(source, /Teacher account created successfully\. Teacher can log in using the password set by College Admin\./);
  assert.match(source, /resetTeacherPassword\(selectedTeacher\.id/);
  assert.match(source, /getTeacherManagementProfile\(teacher\.id, activeCollegeId\)/);
  assert.match(source, /updateTeacherProfile\(selectedTeacher\.id/);
  assert.match(source, /deactivateTeacher\(selectedTeacher\.id/);
  assert.match(source, /assignTeacher\(selectedTeacher\.id/);
  assert.match(source, /deactivateTeacherAssignment\(selectedTeacher\.id/);
  assert.match(source, /selectedTeacher\.is_active/);
  assert.match(source, /function closeDetails\(\)[\s\S]*?setNewPassword\(""\)[\s\S]*?setNewPasswordConfirmation\(""\)/);
  assert.doesNotMatch(source, /localStorage|\bupdateTeacher\(|\bdeleteTeacher\(|\bactivateTeacher\(/i);
});

test("Teacher service exposes only explicit selected-College management operations", async () => {
  const [page, service] = await Promise.all([
    readFile(new URL("../src/pages/auth/admin/Teachers.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/teachers.js", import.meta.url), "utf8"),
  ]);
  assert.match(page, /createTeacher\(payload, submittedCollegeId\)/);
  assert.match(service, /function resetTeacherPassword\(id, payload, collegeId\)/);
  assert.match(service, /function createTeacher\(payload, collegeId\)/);
  assert.doesNotMatch(page, /\bupdateTeacher\(|\bdeleteTeacher\(|\bactivateTeacher\(/i);
  assert.match(service, /function createTeacher\(payload, collegeId\)/);
  assert.doesNotMatch(service, /function\s+(?:updateTeacher\(|deleteTeacher\(|activateTeacher\(|createAssignment\(|deleteAssignment\()/);
});
