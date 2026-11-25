import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { createIsolatedViteServer } from "./helpers/viteIsolated.js";
import path from "node:path";

let vite;
let LandingPage;
let AuthProvider;
let MemoryRouter;
let createRoot;
let dom;
let root;
let container;
const originalGlobals = new Map();

function setGlobal(name, value) {
  if (!originalGlobals.has(name)) originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

before(async () => {
  vite = await createIsolatedViteServer({ root: process.cwd(), configFile: false, envFile: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true }, resolve: { preserveSymlinks: true, alias: [{ find: "react-router-dom", replacement: path.resolve("tests/fixtures/router-mock.jsx") }] }, optimizeDeps: { noDiscovery: true, include: [] } });
  ({ default: LandingPage } = await vite.ssrLoadModule("/src/pages/LandingPage.jsx"));
  ({ AuthProvider } = await vite.ssrLoadModule("/src/context/AuthContext.jsx"));
  ({ MemoryRouter } = await vite.ssrLoadModule("/tests/fixtures/router-mock.jsx"));
  ({ createRoot } = await import("react-dom/client"));
});

after(async () => { await vite?.close(); });

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  dom?.window.close();
  dom = null;
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  originalGlobals.clear();
});

async function mountLanding() {
  dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://attendx.test/", pretendToBeVisual: true });
  for (const name of ["window", "document", "navigator", "HTMLElement", "Node", "CustomEvent", "localStorage", "IS_REACT_ACT_ENVIRONMENT"]) {
    setGlobal(name, name === "IS_REACT_ACT_ENVIRONMENT" ? true : name === "localStorage" ? dom.window.localStorage : dom.window[name]);
  }
  container = dom.window.document.getElementById("root");
  root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(MemoryRouter, null,
      React.createElement(AuthProvider, null, React.createElement(LandingPage))));
  });
  return container;
}

test("public landing page exposes the required sections, truthful CTAs and existing login route", async () => {
  const page = await mountLanding();
  for (const id of ["home", "features", "how-it-works", "benefits", "about", "pricing", "contact", "faq"]) {
    assert.ok(page.querySelector(`#${id}`), `missing section #${id}`);
  }
  assert.match(page.querySelector("h1").textContent, /Smart Attendance\.\s*Smarter Campus Management\./);
  assert.equal(page.querySelectorAll('a[href="/login"]').length >= 1, true);
  assert.equal(page.querySelectorAll('a[href="/register-college"]').length >= 1, true);
  assert.equal(page.querySelector("form"), null, "no fake registration/contact form is rendered");
  assert.match(page.textContent, /migration is not applied/i);
  assert.match(page.textContent, /Contact Us for Pricing/);
  assert.match(page.textContent, /not a live dashboard/i);
  for (const link of page.querySelectorAll('a[href^="#"]')) {
    assert.ok(page.querySelector(link.getAttribute("href")), `broken in-page link ${link.getAttribute("href")}`);
  }
});

test("public registration CTA maps to the real form route and login remains available", async () => {
  const routes = await readFile("src/routes/AppRoutes.jsx", "utf8");
  assert.match(routes, /path="\/login"/);
  assert.match(routes, /path="\/register-college"/);
  const page = await mountLanding();
  assert.equal(page.querySelectorAll('a[href="/login"]').length >= 1, true);
  assert.equal(page.querySelector('a[href="/register-college"]').tagName, "A");
  assert.equal(page.querySelector("form"), null);
});

test("mobile navigation opens, closes after choosing a section, and FAQ uses native disclosure", async () => {
  const page = await mountLanding();
  const toggle = page.querySelector(".site-menu-toggle");
  const nav = page.querySelector("#public-navigation");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  await act(async () => toggle.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.ok(nav.classList.contains("site-nav-open"));
  await act(async () => nav.querySelector('a[href="/about"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true })));
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  const firstFaq = page.querySelector(".site-faq-list details");
  assert.ok(firstFaq);
  const summary = firstFaq.querySelector("summary");
  assert.equal(summary.tagName, "SUMMARY");
  await act(async () => summary.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.equal(firstFaq.open, true);
  await act(async () => summary.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.equal(firstFaq.open, false);
});

test("feature cards expose implementation status and all four role previews are clearly illustrative", async () => {
  const page = await mountLanding();
  assert.equal(page.querySelectorAll(".site-feature-card").length, 10);
  assert.ok(page.querySelector('.site-feature-card[data-status="partial"]'));
  assert.ok(page.querySelector('.site-feature-card[data-status="in-development"]'));
  assert.ok(page.querySelector('.site-feature-card[data-status="unavailable"]'));
  assert.equal(page.querySelectorAll(".site-dashboard-card").length, 4);
  assert.equal(page.querySelectorAll(".site-dashboard-card small").length >= 4, true);
  assert.match(page.querySelector(".site-security-caveat").textContent, /migration remains a draft/i);
});





