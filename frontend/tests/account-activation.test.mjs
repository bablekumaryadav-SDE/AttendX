import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import api from "../src/services/api.js";
import { completeAccountActivation } from "../src/services/accountActivation.js";
import { getTenantStudentInvitation, resendTenantStudentInvitation } from "../src/services/tenantStudents.js";
import { getTeacherInvitation, resendTeacherInvitation } from "../src/services/teachers.js";

test("activation request uses the public endpoint and never attaches a stored bearer token", async () => {
  const calls = [];
  const oldAdapter = api.defaults.adapter;
  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => "synthetic-existing-session" };
  api.defaults.adapter = async (config) => {
    calls.push({ url: config.url, method: config.method, auth: config.headers?.Authorization, data: config.data });
    return { data: { status: "activated" }, status: 200, statusText: "OK", headers: {}, config };
  };
  try {
    const result = await completeAccountActivation("synthetic-one-time-token", "Synthetic!Password-2026");
    assert.equal(result.status, "activated");
    assert.equal(calls[0].url, "/account-activation/complete");
    assert.equal(calls[0].method, "post");
    assert.equal(calls[0].auth, undefined);
    assert.deepEqual(JSON.parse(calls[0].data), {
      token: "synthetic-one-time-token",
      password: "Synthetic!Password-2026",
    });
  } finally {
    api.defaults.adapter = oldAdapter;
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldStorage;
  }
});

test("admin invitation status and resend services require the selected College", async () => {
  const calls = [];
  const oldAdapter = api.defaults.adapter;
  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => "synthetic-admin-session" };
  api.defaults.adapter = async (config) => {
    calls.push({ method: config.method, url: config.url, collegeId: config.params?.college_id });
    return { data: { status: "sent" }, status: 200, statusText: "OK", headers: {}, config };
  };
  try {
    await getTenantStudentInvitation(31, 7);
    await resendTenantStudentInvitation(31, 7);
    await getTeacherInvitation(41, 8);
    await resendTeacherInvitation(41, 8);
    assert.deepEqual(calls, [
      { method: "get", url: "/students/31/invitation", collegeId: 7 },
      { method: "post", url: "/students/31/invitation/resend", collegeId: 7 },
      { method: "get", url: "/teachers/41/invitation", collegeId: 8 },
      { method: "post", url: "/teachers/41/invitation/resend", collegeId: 8 },
    ]);
    await assert.rejects(getTenantStudentInvitation(31, null), { code: "COLLEGE_SELECTION_REQUIRED" });
    await assert.rejects(resendTeacherInvitation(41, null), { code: "COLLEGE_SELECTION_REQUIRED" });
    assert.equal(calls.length, 4);
  } finally {
    api.defaults.adapter = oldAdapter;
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldStorage;
  }
});

test("activation page consumes a URL fragment token and clears it from browser history", async () => {
  const source = await readFile(new URL("../src/pages/public/AccountActivationPage.jsx", import.meta.url), "utf8");
  const routes = await readFile(new URL("../src/routes/AppRoutes.jsx", import.meta.url), "utf8");
  assert.match(source, /window\.location\.hash/);
  assert.match(source, /window\.history\.replaceState/);
  assert.match(source, /completeAccountActivation\(token, password\)/);
  assert.match(routes, /path="\/activate-account"/);
  assert.doesNotMatch(source, /localStorage\.(?:setItem|clear)/);
});
