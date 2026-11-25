import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import api from "../src/services/api.js";
import { getCurrentUser } from "../src/services/auth.js";

const source = async (path) => readFile(new URL(path, import.meta.url), "utf8");

test("login service contract uses a single POST with normalized email and password fields", async () => {
  const auth = await source("../src/services/auth.js");
  assert.match(auth, /api\.post\("\/auth\/login",\s*\{\s*email:\s*normalizedEmail,\s*password,?\s*\}\)/s);
  assert.match(auth, /\.trim\(\)\s*\.toLowerCase\(\)/);
  assert.doesNotMatch(auth, /retry|axios-retry/i);
});

test("session restoration validates the saved token through /auth/me, not /auth/login", async () => {
  const context = await source("../src/context/AuthContext.jsx");
  const restore = context.match(/async function restoreSession\(\) \{([\s\S]*?)\n    \}/)?.[1];
  assert.ok(restore, "restoreSession implementation is present");
  assert.match(restore, /getCurrentUser\(token\)/);
  assert.doesNotMatch(restore, /loginUser|\blogin\(/);
  assert.match(restore, /localStorage\.removeItem\(TOKEN_KEY\)/);
});

test("concurrent session restoration coalesces /auth/me for the same token without caching", async () => {
  const calls = [];
  const oldAdapter = api.defaults.adapter;
  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null };
  api.defaults.adapter = async (config) => {
    calls.push({ url: config.url, authorization: config.headers.Authorization });
    return { data: { user_id: 73 }, status: 200, statusText: "OK", headers: {}, config };
  };
  try {
    const restored = await Promise.all([
      getCurrentUser("synthetic-session-token"),
      getCurrentUser("synthetic-session-token"),
    ]);
    assert.deepEqual(restored, [{ user_id: 73 }, { user_id: 73 }]);
    assert.deepEqual(calls, [{ url: "/auth/me", authorization: "Bearer synthetic-session-token" }]);

    await getCurrentUser("synthetic-session-token");
    assert.equal(calls.length, 2, "completed /auth/me results are not cached");
  } finally {
    api.defaults.adapter = oldAdapter;
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldStorage;
  }
});

test("concurrent /auth/me calls for different tokens are not shared", async () => {
  const calls = [];
  const oldAdapter = api.defaults.adapter;
  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => "different-local-storage-token" };
  api.defaults.adapter = async (config) => {
    calls.push(config.headers.Authorization);
    return { data: { user_id: calls.length }, status: 200, statusText: "OK", headers: {}, config };
  };
  try {
    await Promise.all([getCurrentUser("synthetic-token-a"), getCurrentUser("synthetic-token-b")]);
    assert.deepEqual(calls.sort(), ["Bearer synthetic-token-a", "Bearer synthetic-token-b"]);
    assert.ok(!calls.includes("Bearer different-local-storage-token"));
  } finally {
    api.defaults.adapter = oldAdapter;
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldStorage;
  }
});

test("login UI only initiates login from explicit form submission", async () => {
  const login = await source("../src/pages/auth/Login.jsx");
  assert.match(login, /onSubmit=\{handleSubmit\}/);
  assert.match(login, /login\(email,\s*password\)/);
});
