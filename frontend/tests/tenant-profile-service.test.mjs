import assert from "node:assert/strict";
import test from "node:test";

import api from "../src/services/api.js";
import {
  getTenantCollegeProfile,
  tenantCollegeProfileErrorMessage,
  updateTenantCollegeProfile,
} from "../src/services/tenant.js";
import { submitStudentFaceAttendance } from "../src/services/attendance.js";

test("GPS profile service sends selected College and exact PATCH schema", async () => {
  const oldAdapter = api.defaults.adapter;
  const oldStorage = globalThis.localStorage;
  const calls = [];
  globalThis.localStorage = { getItem: () => "synthetic-token" };
  api.defaults.adapter = async (config) => {
    calls.push({ method: config.method, url: config.url, params: config.params, data: config.data });
    return {
      data: { id: 301, gps_accuracy_limit_m: 120 },
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    };
  };
  try {
    const loaded = await getTenantCollegeProfile(301);
    const saved = await updateTenantCollegeProfile(301, { gps_accuracy_limit_m: 120 });
    assert.equal(loaded.gps_accuracy_limit_m, 120);
    assert.equal(saved.gps_accuracy_limit_m, 120);
    assert.deepEqual(calls.map(({ method, url, params }) => ({ method, url, params })), [
      { method: "get", url: "/tenant/pilot/college-profile", params: { college_id: 301 } },
      { method: "patch", url: "/tenant/pilot/college-profile", params: { college_id: 301 } },
    ]);
    assert.deepEqual(JSON.parse(calls[1].data), { gps_accuracy_limit_m: 120 });
    await assert.rejects(updateTenantCollegeProfile(null, { gps_accuracy_limit_m: 120 }));
    assert.equal(calls.length, 2);
  } finally {
    api.defaults.adapter = oldAdapter;
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldStorage;
  }
});

test("GPS settings errors distinguish validation, authorization, schema, service and transport failures", () => {
  assert.match(tenantCollegeProfileErrorMessage({ response: { status: 401 } }), /session has expired/i);
  assert.match(tenantCollegeProfileErrorMessage({ response: { status: 403 } }), /permission/i);
  assert.match(tenantCollegeProfileErrorMessage({ response: { status: 422 } }), /whole-number/i);
  assert.match(tenantCollegeProfileErrorMessage({
    response: { status: 503, data: { detail: "College GPS settings schema is unavailable." } },
  }), /reviewed College settings migration/i);
  assert.match(tenantCollegeProfileErrorMessage({ response: { status: 503 } }), /temporarily unavailable/i);
  assert.match(tenantCollegeProfileErrorMessage({ request: {} }), /server could not be reached/i);
  assert.match(tenantCollegeProfileErrorMessage({ response: { status: 500 } }), /contact the administrator/i);
});

test("face attendance request does not require or send student GPS data", async () => {
  const oldAdapter = api.defaults.adapter;
  const oldStorage = globalThis.localStorage;
  let request;
  globalThis.localStorage = { getItem: () => "synthetic-token" };
  api.defaults.adapter = async (config) => {
    request = config;
    return { data: { success: true, status: "present" }, status: 200, statusText: "OK", headers: {}, config };
  };
  try {
    const file = new Blob(["synthetic image"], { type: "image/jpeg" });
    Object.defineProperty(file, "name", { value: "synthetic.jpg" });
    await submitStudentFaceAttendance(44, file, null, 301);
    const fields = [...request.data.keys()];
    assert.deepEqual(fields, ["file"]);
    assert.deepEqual(request.params, { college_id: 301 });
    assert.match(request.url, /\/tenant\/face\/student\/sessions\/44\/face$/);
  } finally {
    api.defaults.adapter = oldAdapter;
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldStorage;
  }
});
