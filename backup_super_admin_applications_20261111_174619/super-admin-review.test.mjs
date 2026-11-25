import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import path from "node:path";
import { createServer } from "vite";

let vite;
let createRoot;
let Home;
let AuthContext;
let dom;
let root;
const globals = new Map();

function setGlobal(name, value) {
  if (!globals.has(name)) globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

before(async () => {
  vite = await createServer({
    root: process.cwd(), configFile: false, envFile: false, appType: "custom", logLevel: "silent",
    server: { middlewareMode: true },
    resolve: { preserveSymlinks: true, alias: [
      { find: "react-router-dom", replacement: path.resolve("tests/fixtures/router-mock.jsx") },
      { find: /^\.\.\/\.\.\/services\/collegeRegistration$/, replacement: path.resolve("tests/fixtures/college-registration-service-mock.js") },
    ] },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  Home = (await vite.ssrLoadModule("/src/pages/auth/SuperAdminHome.jsx")).default;
  AuthContext = (await vite.ssrLoadModule("/src/context/AuthContext.jsx")).default;
  ({ createRoot } = await import("react-dom/client"));
});

after(async () => { await vite?.close(); });

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  dom?.window.close();
  dom = null;
  for (const [name, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  globals.clear();
});

function makeApplication(status = "pending") {
  return {
    id: 22, application_reference: "AXR-synthetic-reference", college_name: "Synthetic College",
    college_type: "University", official_email: "office@example.test", city: "Test City", state: "Test State",
    address: "100 Example Road", postal_code: "12345", country: "Exampleland", contact_number: "+14155550123",
    website: null, admin_name: "Test Applicant", admin_email: "applicant@example.test",
    admin_contact_number: "+14155550124", status, provisioning_status: status === "approved" ? "pending_activation" : "not_started",
    submitted_at: "2026-11-10T10:00:00Z", reviewed_at: null, reviewed_by_user_id: null,
    review_reason: null, college_id: null, admin_user_id: null,
  };
}

async function mount(mock) {
  dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://attendx.test/platform", pretendToBeVisual: true });
  for (const name of ["window", "document", "navigator", "HTMLElement", "Node", "CustomEvent", "IS_REACT_ACT_ENVIRONMENT"]) {
    setGlobal(name, name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[name]);
  }
  setGlobal("__collegeRegistrationMock", mock);
  root = createRoot(dom.window.document.getElementById("root"));
  const value = { user: { name: "Synthetic Platform Admin", email: "platform@example.test" }, logout: async () => {} };
  await act(async () => root.render(React.createElement(AuthContext.Provider, { value }, React.createElement(Home))));
  return dom.window.document;
}

test("Super Admin review UI loads real service data and confirms pending activation without claiming email delivery", async () => {
  let state = "pending";
  const calls = [];
  const doc = await mount({
    list: async (filter) => { calls.push(["list", filter]); return state === filter ? [makeApplication(state)] : []; },
    get: async () => makeApplication(state),
    history: async () => [{ id: 1, reviewer_user_id: 9101, decision: state === "approved" ? "approved" : "under_review", reason: "Synthetic review", created_at: "2026-11-10T10:05:00Z" }],
    start: async (_id, reason) => { calls.push(["start", reason]); state = "under_review"; return {}; },
    approve: async (_id, reason) => { calls.push(["approve", reason]); state = "approved"; return {}; },
    reject: async (_id, reason) => { calls.push(["reject", reason]); return {}; },
    submit: async () => ({}), checkStatus: async () => ({}),
  });
  assert.match(doc.body.textContent, /Synthetic College/);
  const appButton = [...doc.querySelectorAll(".platform-application-list button")].find((button) => button.textContent.includes("AXR-synthetic-reference"));
  await act(async () => appButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.match(doc.body.textContent, /Test Applicant/);
  const approve = [...doc.querySelectorAll("button")].find((button) => button.textContent === "Approve");
  await act(async () => approve.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.ok(calls.some(([name]) => name === "approve"));
  assert.match(doc.body.textContent, /awaiting secure admin activation/i);
  assert.match(doc.body.textContent, /No invitation email was sent/i);
  assert.equal(doc.querySelectorAll(".platform-review-actions button").length, 0);
});

test("Super Admin review UI shows loading then an accurate empty state", async () => {
  let resolveList;
  const pendingList = new Promise((resolve) => { resolveList = resolve; });
  const doc = await mount({
    list: async () => pendingList,
    get: async () => ({}), history: async () => [], start: async () => ({}), approve: async () => ({}), reject: async () => ({}),
    submit: async () => ({}), checkStatus: async () => ({}),
  });
  assert.match(doc.querySelector('[role="status"]').textContent, /loading applications/i);
  await act(async () => resolveList([]));
  assert.match(doc.querySelector(".platform-application-list").textContent, /no applications in this status/i);
  assert.equal(doc.querySelector('[role="alert"]'), null);
});

test("Super Admin review errors are shown without fabricating application data", async () => {
  const doc = await mount({
    list: async () => { throw { response: { status: 503, data: { detail: "College application service is unavailable." } } }; },
    get: async () => ({}), history: async () => [], start: async () => ({}), approve: async () => ({}), reject: async () => ({}),
    submit: async () => ({}), checkStatus: async () => ({}),
  });
  assert.match(doc.querySelector('[role="alert"]').textContent, /unavailable/i);
  assert.match(doc.querySelector('[role="alert"]').textContent, /retry later/i);
  assert.match(doc.querySelector('[role="alert"]').textContent, /platform administrator/i);
  assert.equal(doc.querySelector(".platform-application-list li"), null);
});
