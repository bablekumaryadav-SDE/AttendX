import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getFreshAttendanceLocation, validateFreshAttendanceFix } from "../src/utils/attendanceLocation.js";

function geolocationWith(result) {
  const calls = [];
  return {
    calls,
    getCurrentPosition(success, failure, options) {
      calls.push(options);
      if (result.error) failure({ code: result.error });
      else success({
        timestamp: result.timestamp ?? Date.now(),
        coords: { latitude: 20.5, longitude: 78.5, accuracy: result.accuracy },
      });
    },
  };
}

test("location acquisition requests one fresh high-accuracy position and accepts exactly 100m", async () => {
  const geo = geolocationWith({ accuracy: 100 });
  const coordinates = await getFreshAttendanceLocation(geo);
  assert.deepEqual({ latitude: coordinates.latitude, longitude: coordinates.longitude, accuracy: coordinates.accuracy }, { latitude: 20.5, longitude: 78.5, accuracy: 100 });
  assert.ok(Number.isFinite(coordinates.capturedAt));
  assert.deepEqual(geo.calls, [{ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }]);
});

test("107m accuracy is reported accurately and rejected under the default 100m College policy", async () => {
  const geo = geolocationWith({ accuracy: 107 });
  await assert.rejects(getFreshAttendanceLocation(geo), (error) => {
    assert.equal(error.code, "LOCATION_IMPRECISE");
    assert.match(error.message, /107\.0 m/);
    assert.match(error.message, /requires 100 m accuracy or better/i);
    return true;
  });
});

test("107m measured accuracy is accepted under a configured 150m College policy", async () => {
  const coordinates = await getFreshAttendanceLocation(geolocationWith({ accuracy: 107 }), 150);
  assert.deepEqual({ latitude: coordinates.latitude, longitude: coordinates.longitude, accuracy: coordinates.accuracy }, { latitude: 20.5, longitude: 78.5, accuracy: 107 });
});

test("configured 120m policy accepts 107m and rejects accuracy above 120m", async () => {
  const accepted = await getFreshAttendanceLocation(geolocationWith({ accuracy: 107 }), 120);
  assert.equal(accepted.accuracy, 107);
  await assert.rejects(getFreshAttendanceLocation(geolocationWith({ accuracy: 121 }), 120), (error) => {
    assert.equal(error.code, "LOCATION_IMPRECISE");
    assert.match(error.message, /requires 120 m accuracy or better/i);
    return true;
  });
});

test("College GPS policy rejects values outside the supported range", async () => {
  await assert.rejects(getFreshAttendanceLocation(geolocationWith({ accuracy: 10 }), 151), {
    code: "LOCATION_POLICY_UNAVAILABLE",
  });
});

test("Teacher lecture capture rejects stale browser fixes instead of submitting them", async () => {
  let onSuccess;
  let timeoutCallback;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (callback) => { timeoutCallback = callback; return 61; };
  globalThis.clearTimeout = () => {};
  const geo = {
    watchPosition(success) { onSuccess = success; return 62; },
    clearWatch() {},
  };
  try {
    const pending = getFreshAttendanceLocation(geo, 100, { requireStableFix: true });
    onSuccess({ timestamp: Date.now() - 60000, coords: { latitude: 20.5, longitude: 78.5, accuracy: 10 } });
    timeoutCallback();
    await assert.rejects(pending, (error) => {
      assert.equal(error.code, "LOCATION_STALE");
      assert.match(error.message, /stale location/i);
      return true;
    });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("tenant attendance loads the selected College policy and Admin setting is membership-authorized", async () => {
  const [attendance, dashboard, admin, service, routes] = await Promise.all([
    readFile(new URL("../src/pages/student/StudentAttendance.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/student/StudentDashboard.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/auth/admin/TenantAdminDashboard.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/tenant.js", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/AppRoutes.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(attendance, /getTenantCollegeProfile\(requestCollegeId\)/);
  assert.match(dashboard, /getTenantCollegeProfile\(requestCollegeId\)/);
  assert.match(admin, /membership\.membership_role === "college_admin"/);
  assert.match(admin, /value > 150/);
  assert.match(service, /\/tenant\/pilot\/college-profile/);
  assert.match(routes, /<Route index element=\{<TenantAdminDashboard \/>\} \/>/);
});

test("bounded location watch keeps a better fresh reading and clears the watcher", async () => {
  let success;
  const cleared = [];
  const geo = {
    watchPosition(onSuccess, _onError, options) {
      success = onSuccess;
      assert.deepEqual(options, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
      return 73;
    },
    clearWatch(id) { cleared.push(id); },
  };
  const pending = getFreshAttendanceLocation(geo);
  success({ timestamp: Date.now(), coords: { latitude: 20.5, longitude: 78.5, accuracy: 107 } });
  success({ timestamp: Date.now(), coords: { latitude: 20.50001, longitude: 78.50001, accuracy: 42.25 } });
  success({ timestamp: Date.now(), coords: { latitude: 20.50001, longitude: 78.50001, accuracy: 42.25 } });
  const result = await pending;
  assert.deepEqual({ latitude: result.latitude, longitude: result.longitude, accuracy: result.accuracy }, { latitude: 20.50001, longitude: 78.50001, accuracy: 42.25 });
  assert.deepEqual(cleared, [73]);
});

test("bounded watch reports its best measured fix when only an inaccurate reading arrives", async () => {
  let success;
  let failure;
  const cleared = [];
  const geo = {
    watchPosition(onSuccess, onError) { success = onSuccess; failure = onError; return 74; },
    clearWatch(id) { cleared.push(id); },
  };
  const pending = getFreshAttendanceLocation(geo);
  success({ timestamp: Date.now(), coords: { latitude: 20.5, longitude: 78.5, accuracy: 107 } });
  failure({ code: 3 });
  await assert.rejects(pending, (error) => {
    assert.equal(error.code, "LOCATION_IMPRECISE");
    assert.match(error.message, /107\.0 m/);
    return true;
  });
  assert.deepEqual(cleared, [74]);
});

test("consecutive readings hundreds of kilometres apart never produce a fix", async () => {
  let success;
  let timeoutCallback;
  const cleared = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (callback, delay) => {
    assert.equal(delay, 30000);
    timeoutCallback = callback;
    return 745;
  };
  globalThis.clearTimeout = () => {};
  const geo = {
    watchPosition(onSuccess, _onError, options) {
      success = onSuccess;
      assert.deepEqual(options, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
      return 75;
    },
    clearWatch(id) { cleared.push(id); },
  };
  try {
    const pending = getFreshAttendanceLocation(geo, 120, { requireStableFix: true });
    success({ timestamp: Date.now(), coords: { latitude: 26.91, longitude: 81.04, accuracy: 50 } });
    success({ timestamp: Date.now(), coords: { latitude: 25.40, longitude: 81.88, accuracy: 50 } });
    success({ timestamp: Date.now(), coords: { latitude: 26.91, longitude: 81.04, accuracy: 50 } });
    timeoutCallback();
    await assert.rejects(pending, (error) => {
      assert.equal(error.code, "LOCATION_INCONSISTENT");
      assert.match(error.message, /location readings are inconsistent/i);
      return true;
    });
    assert.deepEqual(cleared, [75]);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("Teacher capture can recover from one provider timeout within its bounded window", async () => {
  let success;
  let failure;
  const cleared = [];
  const geo = {
    watchPosition(onSuccess, onError, options) {
      success = onSuccess;
      failure = onError;
      assert.deepEqual(options, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
      return 77;
    },
    clearWatch(id) { cleared.push(id); },
  };
  const pending = getFreshAttendanceLocation(geo, 120, { requireStableFix: true });
  success({ timestamp: Date.now(), coords: { latitude: 26.91, longitude: 81.04, accuracy: 50 } });
  failure({ code: 3 });
  success({ timestamp: Date.now(), coords: { latitude: 26.91001, longitude: 81.04001, accuracy: 48 } });
  const result = await pending;
  assert.equal(result.accuracy, 48);
  assert.deepEqual(cleared, [77]);
});

test("Teacher capture distinguishes timeout after one valid fix from no-fix timeout", async () => {
  let success;
  let timeoutCallback;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (callback, delay) => { assert.equal(delay, 30000); timeoutCallback = callback; return 78; };
  globalThis.clearTimeout = () => {};
  const geo = { watchPosition(onSuccess) { success = onSuccess; return 79; }, clearWatch() {} };
  try {
    const pending = getFreshAttendanceLocation(geo, 120, { requireStableFix: true });
    success({ timestamp: Date.now(), coords: { latitude: 26.91, longitude: 81.04, accuracy: 50 } });
    timeoutCallback();
    await assert.rejects(pending, (error) => {
      assert.equal(error.code, "LOCATION_STABILITY_TIMEOUT");
      assert.match(error.message, /one acceptable fix \(50\.0 m accuracy\)/i);
      return true;
    });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("Teacher capture reports position-unavailable separately and clears the watch at its deadline", async () => {
  let failure;
  let timeoutCallback;
  const cleared = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (callback, delay) => { assert.equal(delay, 30000); timeoutCallback = callback; return 80; };
  globalThis.clearTimeout = () => {};
  const geo = {
    watchPosition(_success, onError) { failure = onError; return 81; },
    clearWatch(id) { cleared.push(id); },
  };
  try {
    const pending = getFreshAttendanceLocation(geo, 120, { requireStableFix: true });
    failure({ code: 2 });
    timeoutCallback();
    await assert.rejects(pending, (error) => {
      assert.equal(error.code, "LOCATION_UNAVAILABLE");
      assert.match(error.message, /position is unavailable/i);
      return true;
    });
    assert.deepEqual(cleared, [81]);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("stale watch callback is ignored and two consistent fresh fixes are required", async () => {
  let success;
  const cleared = [];
  const geo = {
    watchPosition(onSuccess) { success = onSuccess; return 76; },
    clearWatch(id) { cleared.push(id); },
  };
  const pending = getFreshAttendanceLocation(geo, 120, { requireStableFix: true });
  success({ timestamp: Date.now() - 60000, coords: { latitude: 20.5, longitude: 78.5, accuracy: 10 } });
  success({ timestamp: Date.now(), coords: { latitude: 26.91, longitude: 81.04, accuracy: 50 } });
  success({ timestamp: Date.now(), coords: { latitude: 25.40, longitude: 81.88, accuracy: 50 } });
  success({ timestamp: Date.now(), coords: { latitude: 25.40001, longitude: 81.88001, accuracy: 42 } });
  const result = await pending;
  assert.deepEqual({ latitude: result.latitude, longitude: result.longitude, accuracy: result.accuracy }, { latitude: 25.40001, longitude: 81.88001, accuracy: 42 });
  assert.deepEqual(cleared, [76]);
});

test("permission denial, unavailable position, and timeout have distinct actionable errors", async () => {
  const expected = [
    [1, "LOCATION_PERMISSION_DENIED", /enable location access/i],
    [2, "LOCATION_UNAVAILABLE", /could not determine/i],
    [3, "LOCATION_TIMEOUT", /timed out/i],
  ];
  for (const [code, expectedCode, message] of expected) {
    await assert.rejects(getFreshAttendanceLocation(geolocationWith({ error: code })), (error) => {
      assert.equal(error.code, expectedCode);
      assert.match(error.message, message);
      return true;
    });
  }
  await assert.rejects(getFreshAttendanceLocation(null), { code: "LOCATION_UNAVAILABLE" });
});

test("invalid coordinates and synchronous geolocation failures are rejected safely", async () => {
  const invalidCoordinates = {
    getCurrentPosition(success) {
      success({ timestamp: Date.now(), coords: { latitude: 91, longitude: 78.5, accuracy: 10 } });
    },
  };
  await assert.rejects(getFreshAttendanceLocation(invalidCoordinates), (error) => {
    assert.equal(error.code, "LOCATION_INVALID");
    assert.match(error.message, /invalid coordinates/i);
    return true;
  });

  const unavailable = {
    getCurrentPosition() { throw new Error("synthetic device failure"); },
  };
  await assert.rejects(getFreshAttendanceLocation(unavailable), (error) => {
    assert.equal(error.code, "LOCATION_UNAVAILABLE");
    assert.match(error.message, /could not start location capture/i);
    assert.doesNotMatch(error.message, /synthetic device failure/);
    return true;
  });
});

test("Teacher session preflight rejects stale, invalid, or over-policy coordinates immediately before submission", () => {
  const now = Date.now();
  assert.deepEqual(
    validateFreshAttendanceFix({ latitude: 26.9, longitude: 81.0, accuracy: 107, capturedAt: now }, 120, now),
    { latitude: 26.9, longitude: 81, accuracy: 107 },
  );
  assert.throws(
    () => validateFreshAttendanceFix({ latitude: 26.9, longitude: 81.0, accuracy: 107, capturedAt: now - 60000 }, 120, now),
    { code: "LOCATION_STALE" },
  );
  assert.throws(
    () => validateFreshAttendanceFix({ latitude: 91, longitude: 81.0, accuracy: 10, capturedAt: now }, 120, now),
    { code: "LOCATION_INVALID" },
  );
  assert.throws(
    () => validateFreshAttendanceFix({ latitude: 26.9, longitude: 81.0, accuracy: 121, capturedAt: now }, 120, now),
    { code: "LOCATION_IMPRECISE" },
  );
});

test("student attendance entry points synchronously lock repeated and concurrent QR/face submissions", async () => {
  const [attendance, dashboard] = await Promise.all([
    readFile(new URL("../src/pages/student/StudentAttendance.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/student/StudentDashboard.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(attendance, /const attendanceSubmissionRef = useRef\(false\)/);
  assert.match(attendance, /if \(attendanceSubmissionRef\.current\) return/);
  assert.match(attendance, /if \(attendanceSubmissionRef\.current \|\| faceSubmitting\) return/);
  assert.match(attendance, /disabled=\{faceSubmitting\}/);
  assert.match(attendance, /if \(locationRequestRef\.current\) return locationRequestRef\.current/);
  assert.match(attendance, /location\.accuracy\.toFixed\(1\)/);
  assert.match(dashboard, /if \(scanBusyRef\.current \|\| attendanceSubmissionRef\.current\) return/);
  assert.match(dashboard, /if \(attendanceSubmissionRef\.current \|\| faceSubmitting\) return/);
  assert.match(dashboard, /disabled=\{!selectedAttendanceSession \|\| selectedAttendanceSession\.already_attended \|\| faceSubmitting/);
});
