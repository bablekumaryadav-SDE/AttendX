import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import api from "../src/services/api.js";
import { getTenantAttendanceSessions } from "../src/services/tenantAttendanceSessions.js";

const ok = (config, data) => ({ data, status: 200, statusText: "OK", headers: {}, config });
let previousStorage;
beforeEach(() => {
  previousStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: (key) => key === "attendx_token" ? "synthetic-test-token" : null };
});
afterEach(() => {
  if (previousStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = previousStorage;
});

test("concurrent same-user same-College session reads share one HTTP request", async () => {
  const calls = [];
  const previousAdapter = api.defaults.adapter;
  let resolveRequest;
  api.defaults.adapter = (config) => {
    calls.push(config);
    return new Promise((resolve) => { resolveRequest = resolve; });
  };
  try {
    const first = getTenantAttendanceSessions(8451, "test-user-coalesce-1");
    const second = getTenantAttendanceSessions(8451, "test-user-coalesce-1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls.length, 1);
    resolveRequest(ok(calls[0], [{ id: 91 }]));
    assert.deepEqual(await first, [{ id: 91 }]);
    assert.deepEqual(await second, [{ id: 91 }]);
  } finally {
    api.defaults.adapter = previousAdapter;
  }
});

test("403 is memoized per identity, College and endpoint until explicit retry", async () => {
  const calls = [];
  const previousAdapter = api.defaults.adapter;
  api.defaults.adapter = async (config) => {
    calls.push(config);
    if (calls.length === 1) {
      const error = new Error("forbidden");
      error.response = { status: 403, config };
      throw error;
    }
    return ok(config, [{ id: 92 }]);
  };
  try {
    const identity = "test-user-forbidden-2";
    await assert.rejects(getTenantAttendanceSessions(8452, identity), { message: "forbidden" });
    await assert.rejects(getTenantAttendanceSessions(8452, identity), { message: "forbidden" });
    assert.equal(calls.length, 1);
    assert.deepEqual(await getTenantAttendanceSessions(8452, identity, { retryAuthorization: true }), [{ id: 92 }]);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].params.college_id, 8452);
  } finally {
    api.defaults.adapter = previousAdapter;
  }
});

test("different user identities do not share a pending tenant response", async () => {
  const calls = [];
  const previousAdapter = api.defaults.adapter;
  api.defaults.adapter = async (config) => {
    calls.push(config);
    return ok(config, [{ id: calls.length }]);
  };
  try {
    const [first, second] = await Promise.all([
      getTenantAttendanceSessions(8453, "test-user-a-3"),
      getTenantAttendanceSessions(8453, "test-user-b-3"),
    ]);
    assert.equal(calls.length, 2);
    assert.notDeepEqual(first, second);
  } finally {
    api.defaults.adapter = previousAdapter;
  }
});

test("changing the active user or College clears prior 403 suppression", async () => {
  const calls = [];
  const previousAdapter = api.defaults.adapter;
  api.defaults.adapter = async (config) => {
    calls.push(config);
    if (calls.length === 1) {
      const error = new Error("forbidden");
      error.response = { status: 403, config };
      throw error;
    }
    return ok(config, [{ id: calls.length }]);
  };
  try {
    const identity = "test-user-scope-reset-4";
    await assert.rejects(getTenantAttendanceSessions(8454, identity), { message: "forbidden" });
    await getTenantAttendanceSessions(8455, identity);
    const backToPriorScope = await getTenantAttendanceSessions(8454, identity);
    assert.equal(calls.length, 3);
    assert.deepEqual(backToPriorScope, [{ id: 3 }]);
  } finally {
    api.defaults.adapter = previousAdapter;
  }
});
