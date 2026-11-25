import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routesPath = new URL("../src/routes/AppRoutes.jsx", import.meta.url);
const servicePath = new URL("../src/services/tenantStudents.js", import.meta.url);
const pagePath = new URL("../src/pages/auth/admin/TenantStudents.jsx", import.meta.url);
const legacyPagePath = new URL("../src/pages/auth/admin/Students.jsx", import.meta.url);
const legacyServicePath = new URL("../src/services/students.js", import.meta.url);

test("Admin Students route is the College-scoped tenant page, not the legacy page", async () => {
  const routes = await readFile(routesPath, "utf8");
  assert.match(routes, /import TenantStudents from .*TenantStudents/);
  assert.match(routes, /path="students"[\s\S]*?element=\{<TenantStudents \/>\}/);
});

test("tenant Student page exposes College-scoped guardian and class management without face APIs", async () => {
  const [service, page] = await Promise.all([
    readFile(servicePath, "utf8"),
    readFile(pagePath, "utf8"),
  ]);
  assert.match(service, /getTenantStudents/);
  assert.match(service, /createTenantStudent/);
  assert.match(service, /updateTenantStudent/);
  assert.match(service, /\/class-assignments/);
  assert.match(page, /father_name/);
  assert.match(page, /Class assignments/);
  assert.doesNotMatch(page, /registerStudentFace|face_registered|assignStudentClass/i);
});

test("preserved dormant legacy Student form retains guardian load and save coverage", async () => {
  const [legacyPage, legacyService, routes] = await Promise.all([
    readFile(legacyPagePath, "utf8"),
    readFile(legacyServicePath, "utf8"),
    readFile(routesPath, "utf8"),
  ]);
  assert.match(legacyPage, /getStudentGuardian\(studentId\)/);
  assert.match(legacyPage, /saveStudentGuardian\(/);
  assert.match(legacyPage, /guardianPayload/);
  assert.match(legacyService, /export async function getStudentGuardian/);
  assert.match(legacyService, /export async function saveStudentGuardian/);
  assert.match(legacyService, /`\/students\/\$\{studentId\}\/guardian`/);
  assert.match(routes, /path="students"[\s\S]*?element=\{<TenantStudents \/>\}/);
  assert.doesNotMatch(routes, /element=\{<Students \/>\}/);
});
