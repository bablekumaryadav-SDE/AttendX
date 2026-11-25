import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { createIsolatedViteServer } from "./helpers/viteIsolated.js";

let vite;
let FaceCamera;
const activeHarnesses = new Set();

before(async () => {
  vite = await createIsolatedViteServer({
    root: process.cwd(),
    configFile: false,
    envFile: false,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ default: FaceCamera } = await vite.ssrLoadModule("/src/components/FaceCamera.jsx"));
});

after(async () => {
  await vite?.close();
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function mockStream(trackCount = 2) {
  const stopped = [];
  const tracks = Array.from({ length: trackCount }, (_, index) => ({
    stop() { stopped.push(index); },
  }));
  return { stream: { getTracks: () => tracks }, stopped };
}

function preserveGlobal(name) {
  return [name, Object.getOwnPropertyDescriptor(globalThis, name)];
}

function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

async function mountCamera({ getUserMedia }) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://attendx.test/",
    pretendToBeVisual: true,
  });
  const originals = [
    "window", "document", "navigator", "HTMLElement", "HTMLVideoElement",
    "Node", "MutationObserver", "requestAnimationFrame", "IS_REACT_ACT_ENVIRONMENT",
  ].map(preserveGlobal);
  const frameCallbacks = [];
  const nonNullAttachments = [];
  const consoleErrors = [];
  const unhandledRejections = [];
  const onUnhandledRejection = (reason) => unhandledRejections.push(reason);
  const nativeConsoleError = console.error;

  setGlobal("window", dom.window);
  setGlobal("document", dom.window.document);
  setGlobal("navigator", dom.window.navigator);
  setGlobal("HTMLElement", dom.window.HTMLElement);
  setGlobal("HTMLVideoElement", dom.window.HTMLVideoElement);
  setGlobal("Node", dom.window.Node);
  setGlobal("MutationObserver", dom.window.MutationObserver);
  setGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const requestAnimationFrame = (callback) => {
    frameCallbacks.push(callback);
    return frameCallbacks.length;
  };
  dom.window.requestAnimationFrame = requestAnimationFrame;
  setGlobal("requestAnimationFrame", requestAnimationFrame);
  Object.defineProperty(dom.window.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  Object.defineProperty(dom.window.HTMLMediaElement.prototype, "srcObject", {
    configurable: true,
    get() { return this.__mockSrcObject ?? null; },
    set(value) {
      this.__mockSrcObject = value;
      if (value) nonNullAttachments.push({ element: this, stream: value });
    },
  });
  dom.window.HTMLMediaElement.prototype.play = async function play() {
    this.__playCalls = (this.__playCalls || 0) + 1;
  };
  console.error = (...args) => consoleErrors.push(args);
  process.on("unhandledRejection", onUnhandledRejection);

  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(FaceCamera));
  });

  const harness = {
    dom,
    root,
    container,
    frameCallbacks,
    nonNullAttachments,
    consoleErrors,
    unhandledRejections,
    async start() {
      const button = [...container.querySelectorAll("button")]
        .find((item) => item.textContent.trim() === "Start Camera");
      assert.ok(button, "Start Camera button is rendered");
      await act(async () => { button.click(); });
    },
    async flushFrame() {
      assert.ok(frameCallbacks.length, "camera animation-frame callback was queued");
      const callback = frameCallbacks.shift();
      await act(async () => {
        callback(0);
        await Promise.resolve();
      });
    },
    async unmount() {
      await act(async () => { root.unmount(); });
    },
    dispose() {
      process.removeListener("unhandledRejection", onUnhandledRejection);
      console.error = nativeConsoleError;
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
      dom.window.close();
      activeHarnesses.delete(harness);
    },
  };
  activeHarnesses.add(harness);
  return harness;
}

afterEach(() => {
  for (const harness of [...activeHarnesses]) harness.dispose();
});

test("late resolving stream after unmount stops tracks and is never attached or processed", async () => {
  const pending = deferred();
  let calls = 0;
  const harness = await mountCamera({ getUserMedia: () => { calls += 1; return pending.promise; } });
  const { stream, stopped } = mockStream();

  await harness.start();
  assert.equal(calls, 1);
  await harness.unmount();
  pending.resolve(stream);
  await pending.promise;
  await act(async () => { await Promise.resolve(); });

  assert.deepEqual(stopped, [0, 1]);
  assert.deepEqual(harness.nonNullAttachments, []);
  assert.equal(harness.frameCallbacks.length, 0, "late result did not start video processing");
  assert.equal(harness.container.querySelector("video"), null);
  assert.deepEqual(harness.consoleErrors, []);
  assert.deepEqual(harness.unhandledRejections, []);
});

test("mounted acquisition attaches the stream and starts normal video playback", async () => {
  const { stream, stopped } = mockStream();
  const harness = await mountCamera({ getUserMedia: async () => stream });

  await harness.start();
  assert.equal(harness.nonNullAttachments.length, 0, "video attaches after the animation frame");
  await harness.flushFrame();

  const video = harness.container.querySelector("video");
  assert.ok(video);
  assert.equal(video.srcObject, stream);
  assert.equal(video.__playCalls, 1);
  assert.equal(harness.container.textContent.includes("CAMERA LIVE"), true);
  assert.deepEqual(stopped, []);

  await harness.unmount();
  assert.deepEqual(stopped, [0, 1]);
  assert.equal(video.srcObject, null);
});

test("unmount after successful acquisition stops every acquired track", async () => {
  const { stream, stopped } = mockStream(3);
  const harness = await mountCamera({ getUserMedia: async () => stream });

  await harness.start();
  await harness.flushFrame();
  assert.equal(harness.nonNullAttachments[0]?.stream, stream);

  await harness.unmount();
  assert.deepEqual(stopped, [0, 1, 2]);
});

test("rejection after unmount is handled without component errors or unhandled rejection", async () => {
  const pending = deferred();
  const harness = await mountCamera({ getUserMedia: () => pending.promise });

  await harness.start();
  await harness.unmount();
  pending.reject(Object.assign(new Error("synthetic permission rejection"), { name: "NotAllowedError" }));
  await pending.promise.catch(() => {});
  await act(async () => { await Promise.resolve(); });

  assert.deepEqual(harness.nonNullAttachments, []);
  assert.equal(harness.container.querySelector(".face-camera-error"), null);
  assert.deepEqual(harness.consoleErrors, []);
  assert.deepEqual(harness.unhandledRejections, []);
});

test("repeated mounted acquisition and unmount cycles stop every stream", async () => {
  const streams = Array.from({ length: 3 }, () => mockStream());
  let next = 0;
  for (const current of streams) {
    const harness = await mountCamera({ getUserMedia: async () => current.stream });
    await harness.start();
    await harness.flushFrame();
    await harness.unmount();
    assert.deepEqual(current.stopped, [0, 1]);
    assert.equal(harness.nonNullAttachments.length, 1);
    harness.dispose();
    next += 1;
  }
  assert.equal(next, 3);
});

