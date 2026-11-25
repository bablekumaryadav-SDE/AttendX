import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import api from "../src/services/api.js";
import { assignTeacher, createTeacher, deactivateTeacher, deactivateTeacherAssignment, getTeacher, getTeacherAssignments, getTeacherManagementProfile, getTeachers, reconcileLegacyTeacher, resetTeacherPassword, updateTeacherProfile } from "../src/services/teachers.js";
import { teacherLoadMessage } from "../src/services/tenantSelection.js";
import { activeAssignableRecords, validateTeacherAssignmentRows } from "../src/utils/tenantAssignments.js";

test("Teacher assignment choices contain only explicitly active records and retain database IDs", () => {
  const rows = [
    { id: 52, name: "Active class", is_active: true },
    { id: 53, name: "Inactive class", is_active: false },
    { id: 54, name: "Unknown status class" },
    { id: 0, name: "Invalid id", is_active: true },
  ];
  assert.deepEqual(activeAssignableRecords(rows), [rows[0]]);
  assert.deepEqual(activeAssignableRecords(null), []);
});

test("Teacher registration starts with empty optional rows and validates each row without dropping valid assignments", () => {
  const emptyRows = Array.from({ length: 3 }, () => ({ class_id: "", subject_id: "", academic_year: "", semester: "" }));
  assert.deepEqual(validateTeacherAssignmentRows(emptyRows), { assignments: [], errors: {} });

  const multiple = validateTeacherAssignmentRows([
    { class_id: "15", subject_id: "22", academic_year: "2026-27", semester: "2" },
    { class_id: "16", subject_id: "23", academic_year: "2026-27", semester: "2" },
    emptyRows[2],
  ]);
  assert.deepEqual(multiple, {
    assignments: [
      { class_id: 15, subject_id: 22, academic_year: "2026-27", semester: 2 },
      { class_id: 16, subject_id: 23, academic_year: "2026-27", semester: 2 },
    ],
    errors: {},
  });

  const incomplete = validateTeacherAssignmentRows([
    emptyRows[0],
    { class_id: "15", subject_id: "", academic_year: "", semester: "" },
    emptyRows[2],
  ]);
  assert.deepEqual(incomplete.errors, { 1: "Complete Class, Subject, academic year, and semester, or leave this row empty." });
  assert.deepEqual(incomplete.assignments, []);

  const duplicate = validateTeacherAssignmentRows([
    { class_id: "15", subject_id: "22", academic_year: "2026-27", semester: "2" },
    { class_id: "15", subject_id: "22", academic_year: "2026-27", semester: "2" },
    emptyRows[2],
  ]);
  assert.match(duplicate.errors[1], /duplicates an earlier Class, Subject/);
  assert.deepEqual(duplicate.assignments, []);
});

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
  assert.match(source, /activeAssignableRecords\(classes\)\.map/);
  assert.match(source, /activeAssignableRecords\(subjects\)\.map/);
  assert.match(source, /validateTeacherAssignmentRows\(registrationAssignmentRows\)/);
  assert.match(source, /value=\{row\.class_id\}/);
  assert.match(source, /value=\{row\.subject_id\}/);
  assert.match(source, /registrationRowErrors\[index\].*role="alert"/);
  assert.match(source, /function emptyTeacherAssignmentRows\(\)/);
  assert.match(source, /registrationRequestRef\.current/);
  assert.match(source, /name="password" type="password"/);
  assert.match(source, /name="password_confirmation" type="password"/);
  assert.match(source, /Generated Teacher ID: \$\{created\.employee_id\}/);
  assert.doesNotMatch(source, /name="employee_id"|form\.get\("employee_id"\)|employee_id: profileForm/);
  assert.match(source, /Teacher account created with the password set by College Admin\. Profile verification is pending before Teacher workspace access\./);
  assert.match(source, /resetTeacherPassword\(selectedTeacher\.id/);
  assert.match(source, /getTeacherManagementProfile\(teacher\.id, activeCollegeId\)/);
  assert.match(source, /Promise\.allSettled\(\[[\s\S]*?getTeacherInvitation\(teacher\.id, activeCollegeId\)[\s\S]*?getTeacherAssignments\(teacher\.id, activeCollegeId\)[\s\S]*?getClasses\(activeCollegeId\)[\s\S]*?getSubjects\(activeCollegeId\)/);
  assert.match(source, /assignmentLoadErrors/);
  assert.match(source, /Classes could not be loaded\./);
  assert.match(source, /Subjects could not be loaded\./);
  assert.match(source, /updateTeacherProfile\(selectedTeacher\.id/);
  assert.match(source, /deactivateTeacher\(selectedTeacher\.id/);
  assert.match(source, /assignTeacher\(selectedTeacher\.id/);
  assert.match(source, /deactivateTeacherAssignment\(selectedTeacher\.id/);
  assert.match(source, /selectedTeacher\.is_active/);
  assert.match(source, /function closeDetails\(\)[\s\S]*?setNewPassword\(""\)[\s\S]*?setNewPasswordConfirmation\(""\)/);
  assert.doesNotMatch(source, /localStorage|\bupdateTeacher\(|\bdeleteTeacher\(/i);
  assert.match(source, /activateTeacher\(selectedTeacher\.id, collegeAtSubmit\)/);
});

test("Teacher service exposes only explicit selected-College management operations", async () => {
  const [page, service] = await Promise.all([
    readFile(new URL("../src/pages/auth/admin/Teachers.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/teachers.js", import.meta.url), "utf8"),
  ]);
  assert.match(page, /createTeacher\(payload, submittedCollegeId\)/);
  assert.match(service, /function resetTeacherPassword\(id, payload, collegeId\)/);
  assert.match(service, /function createTeacher\(payload, collegeId\)/);
  assert.doesNotMatch(page, /\bupdateTeacher\(|\bdeleteTeacher\(/i);
  assert.match(page, /activateTeacher\(selectedTeacher\.id, collegeAtSubmit\)/);
  assert.match(service, /function createTeacher\(payload, collegeId\)/);
  assert.match(service, /function activateTeacher\(id, collegeId\)/);
  assert.doesNotMatch(service, /function\s+(?:updateTeacher\(|deleteTeacher\(|createAssignment\(|deleteAssignment\()/);
});

test("legacy Teacher reconciliation requires explicit IDs, evidence attestations, and selected College", async () => {
  const calls = [];
  const oldAdapter = api.defaults.adapter;
  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: (key) => key === "attendx_token" ? "synthetic-token" : null };
  api.defaults.adapter = async (config) => {
    calls.push({ method: config.method, url: config.url, params: config.params, data: config.data });
    return { data: { profile_id: 12, user_id: 38, college_id: 5, profile_verification_status: "pending" }, status: 200, statusText: "OK", headers: {}, config };
  };
  try {
    const result = await reconcileLegacyTeacher("12", {
      user_id: "38",
      ownership_verified: true,
      identity_verified: true,
      ownership_evidence_reference: "HR-ROSTER-2026-04",
      identity_evidence_reference: "IN_PERSON_CHECK-2026-11-24",
      reason: "Confirmed from the original institutional record.",
    }, 5);
    assert.equal(result.profile_verification_status, "pending");
    assert.equal(calls[0].method, "post");
    assert.equal(calls[0].url, "/tenant/account-links/teachers/12/legacy-reconcile");
    assert.equal(calls[0].params.college_id, 5);
    assert.equal(JSON.parse(calls[0].data).user_id, 38);
    await assert.rejects(reconcileLegacyTeacher(12, { user_id: 38 }, 5), /Confirm both ownership and identity/);
    await assert.rejects(reconcileLegacyTeacher(12, { user_id: 38, ownership_verified: true, identity_verified: true }, null), { code: "COLLEGE_SELECTION_REQUIRED" });
    assert.equal(calls.length, 1);
  } finally {
    api.defaults.adapter = oldAdapter;
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldStorage;
  }
});

test("Teacher Admin UI exposes a manual evidence-backed legacy reconciliation form", async () => {
  const source = await readFile(new URL("../src/pages/auth/admin/Teachers.jsx", import.meta.url), "utf8");
  assert.match(source, /Reconcile an existing Teacher/);
  assert.match(source, /Existing Teacher profile ID/);
  assert.match(source, /Original login User ID/);
  assert.match(source, /ownership_evidence_reference/);
  assert.match(source, /identity_evidence_reference/);
  assert.match(source, /ownership_verified/);
  assert.match(source, /identity_verified/);
  assert.match(source, /Profile review remains \$\{result\.profile_verification_status\}/);
  assert.match(source, /reconcileLegacyTeacher\(legacyReconcileForm\.teacher_id, legacyReconcileForm, collegeAtSubmit\)/);
});
