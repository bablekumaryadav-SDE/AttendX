import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { acquireCameraStreamSafely } from "../src/utils/cameraLifecycle.js";
import { stopCameraStream } from "../src/utils/cameraAccess.js";

const componentPath = new URL("../src/components/FaceCamera.jsx", import.meta.url);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeStream(trackCount = 2) {
  const stopped = [];
  const tracks = Array.from({ length: trackCount }, (_, index) => ({
    stop() { stopped.push(index); },
  }));
  return { stream: { getTracks: () => tracks }, stopped };
}

test("deferred stream resolving after cancellation is stopped track-by-track", async () => {
  const pending = deferred();
  const { stream, stopped } = makeStream();
  let current = true;
  const request = acquireCameraStreamSafely({
    getUserMedia: () => pending.promise,
    constraints: {},
    isCurrent: () => current,
  });

  current = false;
  pending.resolve(stream);

  assert.equal(await request, null);
  assert.deepEqual(stopped, [0, 1]);
});

test("cancelled stream is rejected before component attachment or camera processing", async () => {
  const pending = deferred();
  const { stream, stopped } = makeStream();
  let current = true;
  let attached = null;
  let processingStarted = false;
  const request = acquireCameraStreamSafely({
    getUserMedia: () => pending.promise,
    constraints: {},
    isCurrent: () => current,
  }).then((result) => {
    if (!result) return;
    attached = result;
    processingStarted = true;
  });

  current = false;
  pending.resolve(stream);
  await request;

  assert.deepEqual(stopped, [0, 1]);
  assert.equal(attached, null);
  assert.equal(processingStarted, false);
});

test("mounted acquisition returns the stream for the existing video flow", async () => {
  const { stream } = makeStream();
  const result = await acquireCameraStreamSafely({
    getUserMedia: async () => stream,
    constraints: { video: true },
    isCurrent: () => true,
  });
  assert.equal(result, stream);

  const source = await readFile(componentPath, "utf8");
  assert.match(source, /streamRef\.current = stream;[\s\S]*?setActive\(true\);[\s\S]*?videoRef\.current\.srcObject = stream;/);
});

test("normal cleanup stops every track in an acquired stream", () => {
  const { stream, stopped } = makeStream(3);
  stopCameraStream(stream);
  assert.deepEqual(stopped, [0, 1, 2]);
});

test("rejected request after cancellation is rethrown without unguarded component state handling", async () => {
  const pending = deferred();
  let current = true;
  const request = acquireCameraStreamSafely({
    getUserMedia: () => pending.promise,
    constraints: {},
    isCurrent: () => current,
  });

  current = false;
  pending.reject(Object.assign(new Error("synthetic camera failure"), { name: "NotAllowedError" }));
  await assert.rejects(request, /synthetic camera failure/);

  const source = await readFile(componentPath, "utf8");
  assert.match(source, /catch \(cameraError\) \{\s*if \(!isCurrentRequest\(\)\) return;/);
  assert.match(source, /finally \{\s*if \(isCurrentRequest\(\)\) setStarting\(false\);/);
});

