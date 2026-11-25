import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { normalizePhotonResults, searchClassroomPlaces } from "../src/utils/classroomGeocoding.js";

const feature = (name, coords, properties = {}) => ({
  geometry: { coordinates: coords },
  properties: { name, city: "Lucknow", state: "Uttar Pradesh", country: "India", ...properties },
});

test("Photon results prioritize building and institution matches and retain address/type/coordinates", () => {
  const results = normalizePhotonResults({ features: [
    feature("Bakshi Ka Talab", [81.04, 26.91], { osm_key: "place", osm_value: "suburb" }),
    feature("GCRG Group of Institutions", [81.037, 26.9115], { osm_key: "amenity", osm_value: "college", street: "Chandrika Devi Road", postcode: "226201" }),
    feature("Library Building", [81.038, 26.912], { osm_key: "building", osm_value: "yes" }),
  ] });
  assert.equal(results.length, 3);
  assert.equal(results[0].name, "GCRG Group of Institutions");
  assert.equal(results[0].exactBuilding, true);
  assert.match(results[0].address, /Chandrika Devi Road.*Lucknow.*India/);
  assert.equal(results[0].latitude, 26.9115);
  assert.equal(results[0].longitude, 81.037);
  assert.equal(results[2].exactBuilding, false);
});

test("place search is debounced by the UI, bounded to five and does not auto-select", async () => {
  let requestedUrl;
  let requestOptions;
  const result = await searchClassroomPlaces("GCRG Lucknow", {
    signal: new AbortController().signal,
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      requestOptions = options;
      return { ok: true, json: async () => ({ features: [feature("GCRG", [81.037, 26.9115], { osm_key: "building" })] }) };
    },
  });
  assert.ok(requestedUrl.startsWith("https://photon.komoot.io/api/?"));
  assert.match(requestedUrl, /limit=5/);
  assert.equal(requestOptions.method, "GET");
  assert.equal(result[0].name, "GCRG");

  const page = await readFile(new URL("../src/pages/auth/admin/Classes.jsx", import.meta.url), "utf8");
  assert.match(page, /}, 700\)/);
  assert.match(page, /onClick=\{\(\) => selectPlace\(place\)\}/);
  assert.match(page, /© OpenStreetMap contributors/);
  assert.match(page, /location_name: place\.label\.slice\(0, 120\)/);
  assert.match(page, /latitude: String\(place\.latitude\)/);
  assert.match(page, /longitude: String\(place\.longitude\)/);
  assert.match(page, /latitude: "",\s*longitude: ""/);
  assert.match(page, /focusZoom=\{selectedPlace \? 18 : 16\}/);
  assert.match(page, /if \(!locationConfirmed\)/);
  assert.match(page, /locationRequestRef\.current \+= 1/);
});

test("provider failures surface safely and invalid coordinates are excluded", async () => {
  const results = normalizePhotonResults({ features: [
    feature("Invalid", [181, 200]),
    feature("Valid approximate", [81.1, 26.9]),
  ] });
  assert.deepEqual(results.map((row) => row.name), ["Valid approximate"]);
  await assert.rejects(searchClassroomPlaces("GCRG Lucknow", {
    fetchImpl: async () => ({ ok: false, status: 429 }),
  }), /temporarily unavailable/);
});

test("Teacher location verification stays fresh and server authoritative; Student QR acquires GPS at submit", async () => {
  const teacher = await readFile(new URL("../src/pages/teacher/TeacherAttendance.jsx", import.meta.url), "utf8");
  const student = await readFile(new URL("../src/pages/student/StudentAttendance.jsx", import.meta.url), "utf8");
  const sessions = await readFile(new URL("../../backend/app/api/tenant_attendance_sessions.py", import.meta.url), "utf8");
  assert.match(teacher, /requireStableFix: true/);
  assert.match(teacher, /teacher_latitude: teacherFix\.latitude/);
  assert.match(teacher, /teacher_longitude: teacherFix\.longitude/);
  assert.match(teacher, /Fresh Teacher device fix:/);
  assert.match(teacher, /haversineDistanceMeters\(/);
  assert.match(sessions, /haversine_m\(class_row\.latitude, class_row\.longitude, body\.teacher_latitude, body\.teacher_longitude\)/);
  assert.match(sessions, /latitude=class_row\.latitude/);
  assert.match(sessions, /longitude=class_row\.longitude/);
  assert.match(student, /coordinates = await getCurrentLocation\(\)/);
  assert.match(student, /submitStudentQrAttendance\(/);
  assert.match(student, /submitStudentFaceAttendance\(sessionId, capture, null/);
});
