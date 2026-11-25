import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

test("login UI only initiates login from explicit form submission", async () => {
  const login = await source("../src/pages/auth/Login.jsx");
  assert.match(login, /onSubmit=\{handleSubmit\}/);
  assert.match(login, /login\(email,\s*password\)/);
});
