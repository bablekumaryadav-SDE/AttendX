import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { detectClassroomLocation, isValidCoordinatePair } from "../src/utils/classroomLocation.js";

test("classroom GPS detection returns the browser values and requests a fresh high-accuracy fix", async () => {
  let options;
  const position = { coords: { latitude: 26.9115, longitude: 81.037, accuracy: 18.4 } };
  const result = await detectClassroomLocation({
    getCurrentPosition(success, _failure, requestOptions) {
      options = requestOptions;
      success(position);
    },
  });
  assert.deepEqual(result, { latitude: 26.9115, longitude: 81.037, accuracy: 18.4 });
  assert.deepEqual(options, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
});

test("coordinate validation accepts legal bounds and rejects missing, blank, non-finite, or out-of-range values", () => {
  assert.equal(isValidCoordinatePair(-90, 180), true);
  assert.equal(isValidCoordinatePair(90, -180), true);
  assert.equal(isValidCoordinatePair("", 0), false);
  assert.equal(isValidCoordinatePair(" ", 0), false);
  assert.equal(isValidCoordinatePair(Number.NaN, 0), false);
  assert.equal(isValidCoordinatePair(90.0001, 0), false);
  assert.equal(isValidCoordinatePair(0, -180.0001), false);
});

test("invalid browser coordinates or accuracy are rejected instead of populated", async () => {
  for (const coords of [
    { latitude: 91, longitude: 10, accuracy: 2 },
    { latitude: 10, longitude: -181, accuracy: 2 },
    { latitude: 10, longitude: 20, accuracy: Number.NaN },
    { latitude: 10, longitude: 20, accuracy: -1 },
  ]) {
    await assert.rejects(detectClassroomLocation({
      getCurrentPosition(success) { success({ coords }); },
    }), { code: "GEOLOCATION_INVALID" });
  }
});

test("unsupported geolocation and permission, unavailable, and timeout errors are distinguishable", async () => {
  await assert.rejects(detectClassroomLocation(null), { code: "GEOLOCATION_UNSUPPORTED" });
  for (const [browserCode, expectedCode] of [[1, "GEOLOCATION_PERMISSION_DENIED"], [2, "GEOLOCATION_UNAVAILABLE"], [3, "GEOLOCATION_TIMEOUT"]]) {
    await assert.rejects(detectClassroomLocation({
      getCurrentPosition(_success, failure) { failure({ code: browserCode }); },
    }), { code: expectedCode });
  }
});

test("Add Class wires GPS, map/manual changes, confirmation gate, and unchanged API payload", async () => {
  const page = await readFile(new URL("../src/pages/auth/admin/Classes.jsx", import.meta.url), "utf8");
  const location = await readFile(new URL("../src/utils/classroomLocation.js", import.meta.url), "utf8");
  assert.match(page, /Detect My Location/);
  assert.match(page, /detectClassroomLocation\(\)/);
  assert.match(page, /setGpsAccuracy\(position\.accuracy\)/);
  assert.match(location, /enableHighAccuracy: true, timeout: 15000, maximumAge: 0/);
  assert.match(page, /Device-reported GPS accuracy/i);
  assert.match(page, /locationRequestRef\.current !== requestId/);
  assert.match(page, /locationRequestRef\.current \+= 1/);
  assert.match(page, /updateManualLocation\(\{ latitude: event\.target\.value \}\)/);
  assert.match(page, /updateManualLocation\(\{ longitude: event\.target\.value \}\)/);
  assert.match(page, /setGpsAccuracy\(null\)/);
  assert.match(page, /setLocationConfirmed\(false\)/);
  assert.match(page, /I confirm this pin represents the classroom location\./);
  assert.match(page, /if \(!isValidCoordinatePair\(form\.latitude, form\.longitude\)\)/);
  assert.match(page, /if \(!locationConfirmed\)/);
  assert.match(page, /createClass\(payload, activeCollegeId\)/);
  assert.match(page, /latitude: form\.latitude === "" \? null : Number\(form\.latitude\)/);
  assert.match(page, /longitude: form\.longitude === "" \? null : Number\(form\.longitude\)/);
  assert.match(page, /radius_m: Number\(form\.radius_m \|\| 100\)/);
  assert.match(page, /radius_m: "100"/);
});

test("LocationMap synchronizes validated coordinates, map clicks, draggable marker, radius, and cleanup", async () => {
  const map = await readFile(new URL("../src/components/LocationMap.jsx", import.meta.url), "utf8");
  assert.match(map, /isValidCoordinatePair\(latitude, longitude\)/);
  assert.match(map, /interactiveRef\.current/);
  assert.match(map, /map\.on\("click", onMapClick\)/);
  assert.match(map, /L\.marker\(point,\s*\{\s*draggable: interactiveRef\.current/s);
  assert.match(map, /markerRef\.current\.on\("dragend"/);
  assert.match(map, /selectRef\.current\?\.\(\{/);
  assert.match(map, /markerRef\.current\.setLatLng\(point\)/);
  assert.match(map, /circleRef\.current\.setLatLng\(point\)\.setRadius\(effectiveRadius\)/);
  assert.match(map, /invalidateSize\(\{ pan: false \}\)/);
  assert.match(map, /resizeObserver\?\.disconnect\(\)/);
  assert.match(map, /map\.off\("click", onMapClick\)/);
  assert.match(map, /map\.remove\(\)/);
  assert.match(map, /radiusM == null \? 100 : Number\(radiusM\)/);
});

test("location errors remain separated from radius and attendance acceptance rules", async () => {
  const page = await readFile(new URL("../src/pages/auth/admin/Classes.jsx", import.meta.url), "utf8");
  const map = await readFile(new URL("../src/components/LocationMap.jsx", import.meta.url), "utf8");
  assert.match(page, /This is an estimate, not the classroom geofence radius or an attendance acceptance rule/);
  assert.match(page, /Radius remains \{Number\(form\.radius_m\) \|\| 100\} m/);
  assert.match(map, /Geofence boundary: \{radiusM\} m/);
});
