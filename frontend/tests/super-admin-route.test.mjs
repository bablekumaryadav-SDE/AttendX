import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = async (path) => readFile(new URL(path, import.meta.url), "utf8");

test("platform URL is wired to the role-tested Super Admin guard", async () => {
  const routes = await source("../src/routes/AppRoutes.jsx");
  assert.match(routes, /path="\/platform"[\s\S]*?allowedRoles=\{\["super_admin"\]\}/);
  assert.match(routes, /path="\/platform\/colleges"[\s\S]*?allowedRoles=\{\["super_admin"\]\}[\s\S]*?SuperAdminColleges/);
});

test("common login keeps existing role destinations and adds Super Admin", async () => {
  const login = await source("../src/pages/auth/Login.jsx");
  assert.match(login, /role === "super_admin"[\s\S]*?navigate\("\/platform"/);
  assert.match(login, /role === "admin"[\s\S]*?navigate\("\/admin"/);
  assert.match(login, /role === "teacher"[\s\S]*?navigate\("\/teacher"/);
  assert.match(login, /role === "student"[\s\S]*?navigate\("\/student"/);
});

test("session restore revalidates the token and sign-out clears the session", async () => {
  const auth = await source("../src/context/AuthContext.jsx");
  const page = await source("../src/pages/auth/SuperAdminHome.jsx");
  assert.match(auth, /const profile = await getCurrentUser\(token\)/);
  assert.match(auth, /catch \(error\)[\s\S]*?localStorage\.removeItem\(TOKEN_KEY\)[\s\S]*?setUser\(null\)/);
  assert.match(page, /logout\(\)/);
  assert.match(page, /navigate\("\/login"/);
  assert.match(page, /listCollegeApplications/);
  assert.match(page, /approveCollegeApplication/);
  assert.match(page, /rejectCollegeApplication/);
  assert.match(page, /awaiting secure admin activation/i);
  assert.match(page, /No invitation email was sent/i);
});
