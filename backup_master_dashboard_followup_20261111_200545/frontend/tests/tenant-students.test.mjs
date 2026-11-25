import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import api from "../src/services/api.js";
import {
  assignTenantStudentToClass,
  createTenantStudent,
  deactivateTenantStudent,
  deactivateTenantStudentClassAssignment,
  getTenantStudent,
  getTenantStudentClassAssignments,
  getTenantStudents,
  resetTenantStudentPassword,
  updateTenantStudent,
} from "../src/services/tenantStudents.js";
import { studentLoadMessage } from "../src/services/tenantSelection.js";
import { isPasswordPolicyValid } from "../src/services/passwordPolicy.js";

test("permanent account password policy is enforced without accepting weak or overlong values", () => {
  assert.equal(isPasswordPolicyValid("SyntheticStudent!2026"), true);
  for (const value of ["short", "NoDigitsOrSymbol", "NOLOWERCASE1!", `LongA1!${"x".repeat(70)}`]) {
    assert.equal(isPasswordPolicyValid(value), false);
  }
});

test("tenant Student services propagate the selected College for reads and writes", async () => {
  const calls = [];
  const oldAdapter = api.defaults.adapter;
  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: (key) => key === "attendx_token" ? "synthetic-token" : null };
  api.defaults.adapter = async (config) => {
    calls.push({ method: config.method, url: config.url, params: config.params });
    return { data: { items: [], total: 0 }, status: 200, statusText: "OK", headers: {}, config };
  };
  try {
    await getTenantStudents(161, { search: "Ada", activeOnly: true, page: 2, pageSize: 10, college_id: 999 });
    await getTenantStudent(1611, 162);
    await createTenantStudent({ name: "Synthetic Student" }, 163);
    await updateTenantStudent(1611, { name: "Updated" }, 164);
    await deactivateTenantStudent(1611, 165);
    await resetTenantStudentPassword(1611, { password: "Synthetic!Password2026", password_confirmation: "Synthetic!Password2026" }, 169);
    await getTenantStudentClassAssignments(1611, 166);
    await assignTenantStudentToClass(1611, { class_id: 40, academic_year: "2026-27" }, 167);
    await deactivateTenantStudentClassAssignment(1611, 92, 168);
    assert.deepEqual(calls, [
      { method: "get", url: "/students/", params: { search: "Ada", active_only: true, page: 2, page_size: 10, college_id: 161 } },
      { method: "get", url: "/students/1611", params: { college_id: 162 } },
      { method: "post", url: "/students/", params: { college_id: 163 } },
      { method: "patch", url: "/students/1611", params: { college_id: 164 } },
      { method: "delete", url: "/students/1611", params: { college_id: 165 } },
      { method: "patch", url: "/students/1611/password", params: { college_id: 169 } },
      { method: "get", url: "/students/1611/class-assignments", params: { college_id: 166 } },
      { method: "post", url: "/students/1611/class-assignments", params: { college_id: 167 } },
      { method: "delete", url: "/students/1611/class-assignments/92", params: { college_id: 168 } },
    ]);
    await assert.rejects(getTenantStudents(null), { code: "COLLEGE_SELECTION_REQUIRED" });
    await assert.rejects(getTenantStudent(1611, null), { code: "COLLEGE_SELECTION_REQUIRED" });
    await assert.rejects(createTenantStudent({ name: "No College" }, null), { code: "COLLEGE_SELECTION_REQUIRED" });
    await assert.rejects(updateTenantStudent(1611, {}, null), { code: "COLLEGE_SELECTION_REQUIRED" });
    await assert.rejects(deactivateTenantStudent(1611, null), { code: "COLLEGE_SELECTION_REQUIRED" });
    await assert.rejects(resetTenantStudentPassword(1611, {}, null), { code: "COLLEGE_SELECTION_REQUIRED" });
    await assert.rejects(assignTenantStudentToClass(1611, { class_id: 1 }, null), { code: "COLLEGE_SELECTION_REQUIRED" });
    assert.equal(calls.length, 9);
  } finally {
    api.defaults.adapter = oldAdapter;
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldStorage;
  }
});

test("Student directory errors distinguish authentication, authorization, tenant selection and missing records", () => {
  assert.match(studentLoadMessage(401), /session expired/i);
  assert.match(studentLoadMessage(403), /College Admin membership/i);
  assert.match(studentLoadMessage(404, true), /not available/i);
  assert.match(studentLoadMessage(409), /Select one active College/i);
  assert.match(studentLoadMessage(503), /temporarily unavailable/i);
});

test("Admin Students route uses tenant directory and exposes College Admin CRUD controls", async () => {
  const [routes, page] = await Promise.all([
    readFile(new URL("../src/routes/AppRoutes.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/auth/admin/TenantStudents.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(routes, /import TenantStudents from .*TenantStudents/);
  assert.match(routes, /path="students"[\s\S]*?element=\{<TenantStudents \/>\}/);
  assert.match(page, /const \{ user, activeCollegeId, collegeMemberships \} = useAuth\(\)/);
  assert.match(page, /user\?\.role !== "super_admin"/);
  assert.match(page, /getTenantStudents\(activeCollegeId, \{ search, course: courseFilter, department: departmentFilter, activeOnly, page, pageSize \}\)/);
  assert.match(page, /getTenantStudent\(student\.id, activeCollegeId\)/);
  assert.match(page, /setStudents\(\[\]\)/);
  assert.match(page, /createLatestRequestGuard/);
  assert.match(page, /Search students/);
  assert.match(page, /Loading Students/);
  assert.match(page, /No Student records available/);
  assert.match(page, /student\.email/);
  assert.match(page, /createTenantStudent\(payload, submittedCollegeId\)/);
  assert.match(page, /name="password" type="password"/);
  assert.match(page, /name="password_confirmation" type="password"/);
  assert.match(page, /Student account created successfully\. Student can log in using the password set by College Admin\./);
  assert.match(page, /resetTenantStudentPassword\(selectedStudent\.id/);
  assert.match(page, /updateTenantStudent\(selectedStudent\.id, payload, submittedCollegeId\)/);
  assert.match(page, /deactivateTenantStudent\(student\.id, submittedCollegeId\)/);
  assert.match(page, /assignTenantStudentToClass\(selectedStudent\.id/);
  assert.match(page, /deactivateTenantStudentClassAssignment/);
  assert.match(page, /setStudents\(\[\]\)/);
  assert.match(page, /activeCollegeIdRef\.current\) !== String\(submittedCollegeId\)/);
  assert.match(page, /Previous/);
  assert.match(page, /Next/);
  assert.match(page, /promoteTenantStudent\(selectedStudent\.id/);
  assert.doesNotMatch(page, /localStorage|registerStudentFace/);
  assert.match(page, /registerTenantStudentFace\(selectedStudent\.id/);
  assert.match(page, /FaceCamera/);
  assert.match(page, /Student consent has been obtained/);
});

test("tenant Student service exposes College-scoped CRUD, assignment, and face operations", async () => {
  const service = await readFile(new URL("../src/services/tenantStudents.js", import.meta.url), "utf8");
  assert.match(service, /api\.get\("\/students\/"/);
  assert.match(service, /api\.get\(`\/students\/\$\{Number\(studentId\)\}`/);
  assert.match(service, /api\.post\("\/students\//);
  assert.match(service, /api\.patch\(`\/students\/\$\{Number\(studentId\)\}`/);
  assert.match(service, /api\.delete\(`\/students\/\$\{Number\(studentId\)\}`/);
  assert.match(service, /api\.patch\(`\/students\/\$\{Number\(studentId\)\}\/password`/);
  assert.match(service, /\/class-assignments/);
  assert.match(service, /requireSelectedCollegeId\(collegeId\)/);
  assert.match(service, /getTenantStudentFaceStatus/);
  assert.match(service, /registerTenantStudentFace/);
  assert.match(service, /requireSelectedCollegeId\(collegeId\)/);
  assert.doesNotMatch(service, /localStorage/);
});

test("Admin dashboard Student metrics are tenant-scoped and selection-dependent", async () => {
  const source = await readFile(new URL("../src/pages/auth/admin/AdminDashboard.jsx", import.meta.url), "utf8");
  assert.match(source, /getTenantStudents\(activeCollegeId\)/);
  assert.match(source, /activeCollegeId \? getTenantStudents\(activeCollegeId\) : Promise\.resolve\(\[\]\)/);
});
