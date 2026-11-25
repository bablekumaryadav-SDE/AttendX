import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import api from "../src/services/api.js";
import { createClass, deactivateClass, getClass, getClasses, updateClass } from "../src/services/academic.js";
import { getClasses as getTeacherClasses } from "../src/services/teachers.js";
import { classLoadMessage } from "../src/services/tenantSelection.js";

test("Class read and write API clients pass the selected College explicitly", async () => {
  const calls = [];
  const oldAdapter = api.defaults.adapter;
  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: (key) => key === "attendx_token" ? "synthetic-token" : null };
  api.defaults.adapter = async (config) => {
    calls.push({ method: config.method, url: config.url, collegeId: config.params?.college_id });
    return { data: config.method === "get" ? [] : { id: 1, name: "Synthetic" }, status: config.method === "post" ? 201 : 200, statusText: "OK", headers: {}, config };
  };
  try {
    await getClasses(111);
    await getClass(1111, 112);
    await getTeacherClasses(113);
    await createClass({ name: "Synthetic" }, 114);
    await updateClass(1151, { name: "Updated" }, 115);
    await deactivateClass(1161, 116);
    assert.deepEqual(calls, [
      { method: "get", url: "/classes/", collegeId: 111 },
      { method: "get", url: "/classes/1111", collegeId: 112 },
      { method: "get", url: "/classes/", collegeId: 113 },
      { method: "post", url: "/classes/", collegeId: 114 },
      { method: "patch", url: "/classes/1151", collegeId: 115 },
      { method: "delete", url: "/classes/1161", collegeId: 116 },
    ]);
    await assert.rejects(getClasses(null), { code: "COLLEGE_SELECTION_REQUIRED" });
    await assert.rejects(createClass({ name: "No tenant" }, null), { code: "COLLEGE_SELECTION_REQUIRED" });
    assert.equal(calls.length, 6);
  } finally {
    api.defaults.adapter = oldAdapter;
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldStorage;
  }
});

test("Class API errors have safe messages for 401, 403, 404, 409 and 503", () => {
  assert.match(classLoadMessage(401), /session expired/i);
  assert.match(classLoadMessage(403), /active membership/i);
  assert.match(classLoadMessage(404), /not available/i);
  assert.match(classLoadMessage(409), /Select one active College/i);
  assert.match(classLoadMessage(503), /temporarily unavailable/i);
});

test("Classes screen reload clears stale list/detail and uses AuthContext selection", async () => {
  const source = await readFile(new URL("../src/pages/auth/admin/Classes.jsx", import.meta.url), "utf8");
  assert.match(source, /const \{ activeCollegeId, collegeMemberships \} = useAuth\(\)/);
  assert.match(source, /getClasses\(activeCollegeId\)/);
  assert.match(source, /getClass\(classId, activeCollegeId\)/);
  assert.match(source, /setClasses\(\[\]\)/);
  assert.match(source, /setClassDetail\(null\)/);
  assert.match(source, /createLatestRequestGuard/);
});

test("Class writes are available only through explicit tenant service calls and College Admin UI", async () => {
  const [page, service] = await Promise.all([
    readFile(new URL("../src/pages/auth/admin/Classes.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/academic.js", import.meta.url), "utf8"),
  ]);
  assert.match(service, /function createClass\(payload, collegeId\)/);
  assert.match(service, /function updateClass\(id, payload, collegeId\)/);
  assert.match(service, /function deactivateClass\(id, collegeId\)/);
  assert.match(service, /selectedCollegeParams\(collegeId\)/);
  assert.match(page, /membership\.membership_role === "college_admin"/);
  assert.match(page, /createClass\(payload, activeCollegeId\)/);
  assert.match(page, /updateClass\(editingClassId, payload, activeCollegeId\)/);
  assert.match(page, /deactivateClass\(classId, activeCollegeId\)/);
  assert.match(page, /Classes for the selected College/);
  assert.match(page, /Historical records are retained when a Class is deactivated/);
});

test("College Admin can inspect the persisted classroom pin and select a replacement before saving", async () => {
  const [page, map] = await Promise.all([
    readFile(new URL("../src/pages/auth/admin/Classes.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/LocationMap.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /import LocationMap from "\.\.\/\.\.\/\.\.\/components\/LocationMap"/);
  assert.match(page, /latitude=\{form\.latitude\}/);
  assert.match(page, /longitude=\{form\.longitude\}/);
  assert.match(page, /onLocationSelect=\{\(\{ latitude, longitude \}\) => updateManualLocation/);
  assert.match(page, /Selected classroom coordinates:/);
  assert.match(page, /updateClass\(editingClassId, payload, activeCollegeId\)/);
  assert.match(page, /Number\(classDetail\.latitude\)\.toFixed\(7\)/);
  assert.match(page, /Number\(classDetail\.longitude\)\.toFixed\(7\)/);
  assert.match(page, /Number\(classDetail\.radius_m \?\? 100\)/);
  assert.match(map, /if \(!interactiveRef\.current\) return/);
  assert.match(map, /latitude: Number\(event\.latlng\.lat\.toFixed\(7\)\)/);
  assert.match(map, /longitude: Number\(event\.latlng\.lng\.toFixed\(7\)\)/);
});
