import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  normalizePhotonFeature,
  normalizePhotonResults,
  photonFailureMessage,
  searchClassroomPlaces,
} from "../src/utils/classroomGeocoding.js";

const photonFeature = (overrides = {}) => ({
  type: "Feature",
  id: "way/123",
  geometry: { type: "Point", coordinates: [81.037, 26.9115] },
  properties: {
    name: "Example College",
    osm_type: "W",
    osm_id: 123,
    osm_key: "amenity",
    osm_value: "college",
    street: "Campus Road",
    city: "Lucknow",
    state: "Uttar Pradesh",
    country: "India",
    ...overrides,
  },
});

test("Photon GeoJSON is parsed with GeoJSON longitude/latitude order and real OSM identity", () => {
  const result = normalizePhotonFeature(photonFeature());
  assert.equal(result.id, "way/123");
  assert.equal(result.name, "Example College");
  assert.equal(result.latitude, 26.9115);
  assert.equal(result.longitude, 81.037);
  assert.equal(result.address, "Campus Road, Lucknow, Uttar Pradesh, India");
  assert.equal(result.osmId, "123");
  assert.equal(result.likelyEstablishment, true);
  assert.equal(result.approximate, true);
  assert.equal(normalizePhotonFeature(photonFeature({ name: "", street: "", city: "", state: "", country: "" })).name, "amenity college");
});

test("Photon normalization skips invalid coordinates, deduplicates, and preserves ranked alternatives", () => {
  assert.equal(normalizePhotonFeature(photonFeature({ name: "", street: "", city: "", state: "", country: "", osm_key: "", osm_value: "" })), null);
  assert.equal(normalizePhotonFeature({ ...photonFeature(), geometry: { type: "Point", coordinates: [null, 26] } }), null);
  assert.equal(normalizePhotonFeature({ ...photonFeature(), geometry: { type: "Point", coordinates: [181, 26] } }), null);
  assert.equal(normalizePhotonFeature({ ...photonFeature(), geometry: { type: "Point", coordinates: [81, 91] } }), null);
  assert.throws(() => normalizePhotonResults({}), { code: "PHOTON_MALFORMED_RESPONSE" });
  assert.equal(normalizePhotonResults({ features: Array.from({ length: 8 }, (_, index) => ({
    ...photonFeature({ name: `Place ${index}`, osm_id: index + 100 }),
    id: `way/${index + 100}`,
  })) }).length, 8);
  assert.equal(normalizePhotonResults({ features: [photonFeature(), photonFeature()] }).length, 1);
  assert.deepEqual(normalizePhotonResults({ features: [] }), []);
});

test("Photon request encodes the query, sends a bounded GET, and passes abort signal", async () => {
  let requestedUrl;
  let requestOptions;
  const signal = new AbortController().signal;
  const results = await searchClassroomPlaces("GCRG Group & Institutions", {
    signal,
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      requestOptions = options;
      return { ok: true, json: async () => ({ features: [photonFeature({ name: "GCRG Example College" })] }) };
    },
  });
  const parsedUrl = new URL(requestedUrl);
  assert.equal(parsedUrl.origin + parsedUrl.pathname, "https://photon.komoot.io/api/");
  assert.equal(parsedUrl.searchParams.get("q"), "GCRG Group & Institutions");
  assert.equal(parsedUrl.searchParams.get("limit"), "10");
  assert.equal(parsedUrl.searchParams.get("lang"), "en");
  assert.equal(requestOptions.method, "GET");
  assert.equal(requestOptions.signal, signal);
  assert.match(requestOptions.headers.Accept, /application\/geo\+json/);
  assert.equal(results[0].name, "GCRG Example College");
});

test("Photon results rank full name, locality, and education type above unrelated GCRG matches", () => {
  const result = (id, name, address, osmKey, osmValue) => ({
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates: [81, 27] },
    properties: { name, city: address, country: "India", osm_key: osmKey, osm_value: osmValue },
  });
  const places = normalizePhotonResults({ features: [
    result("hospital", "GCRG Memorial Hospital & Charitable Blood Bank", "Lucknow", "amenity", "blood_bank"),
    result("gcc", "GCC-Gopalan College of Commerce", "Karnataka", "amenity", "college"),
    result("rr", "RR Group of institutions", "Bakshi Ka Talab, Uttar Pradesh", "amenity", "college"),
    result("target", "G.C.R.G. Group of Institutions", "Bakshi Ka Talab, Lucknow, Uttar Pradesh", "amenity", "college"),
  ] }, "G.C.R.G. Group of Institutions Bakshi Ka Talab Lucknow");

  assert.equal(places[0].id, "target");
  assert.equal(places[0].queryMatch, true);
  assert.equal(places.find((place) => place.id === "hospital").queryMatch, false);
  assert.ok(places.some((place) => place.id === "rr"), "related, non-exact alternatives remain visible");
  assert.ok(places.findIndex((place) => place.id === "rr") < places.findIndex((place) => place.id === "hospital"));
  assert.equal(places.find((place) => place.id === "hospital").osmValue, "blood_bank");
});

test("short queries are ignored; empty results, rate limits, network and malformed responses are handled", async () => {
  let calls = 0;
  assert.deepEqual(await searchClassroomPlaces("ab", { fetchImpl: async () => { calls += 1; } }), []);
  assert.equal(calls, 0);
  assert.deepEqual(await searchClassroomPlaces("no result", { fetchImpl: async () => ({ ok: true, json: async () => ({ features: [] }) }) }), []);
  const fuzzyGcrgResults = await searchClassroomPlaces("GCRG", { fetchImpl: async () => ({ ok: true, json: async () => ({ features: [photonFeature({ name: "Gorg" })] }) }) });
  assert.equal(fuzzyGcrgResults.length, 1);
  assert.equal(fuzzyGcrgResults[0].queryMatch, false);
  const fuzzyCollegeResults = await searchClassroomPlaces("GCRG College", { fetchImpl: async () => ({ ok: true, json: async () => ({ features: [photonFeature({ name: "Government College for Girls" })] }) }) });
  assert.equal(fuzzyCollegeResults.length, 1);
  assert.equal(fuzzyCollegeResults[0].queryMatch, false);
  const hospital = await searchClassroomPlaces("GCRG College Lucknow", { fetchImpl: async () => ({ ok: true, json: async () => ({ features: [photonFeature({ name: "GCRG Memorial Hospital", osm_value: "hospital" })] }) }) });
  assert.equal(hospital.length, 1);
  assert.equal(hospital[0].queryMatch, false, "a hospital is not presented as a College match");
  const institution = await searchClassroomPlaces("G.C.R.G. Group of Institutions", { fetchImpl: async () => ({ ok: true, json: async () => ({ features: [photonFeature({ name: "GCRG Group of Institutions" })] }) }) });
  assert.equal(institution.length, 1);
  assert.equal(institution[0].queryMatch, true);

  const requested = [];
  const punctuated = await searchClassroomPlaces("G.C.R.G. Group of Institutions", {
    fetchImpl: async (url) => {
      const requestUrl = new URL(url);
      requested.push(requestUrl.searchParams.get("q"));
      return { ok: true, json: async () => ({ features: requested.length === 1 ? [] : [photonFeature({ name: "GCRG Group of Institutions" })] }) };
    },
  });
  assert.deepEqual(requested, ["G.C.R.G. Group of Institutions", "GCRG Group of Institutions"]);
  assert.equal(punctuated[0].queryMatch, true);
  let requests = 0;
  const primarySurvivesFallbackLimit = await searchClassroomPlaces("G.C.R.G. Group of Institutions", {
    fetchImpl: async () => {
      requests += 1;
      if (requests === 1) return { ok: true, json: async () => ({ features: [photonFeature({ name: "Nearby College", osm_id: 234 })] }) };
      return { ok: false, status: 429 };
    },
  });
  assert.equal(primarySurvivesFallbackLimit.length, 1, "a failed optional normalized retry preserves primary results");
  await assert.rejects(searchClassroomPlaces("place", { fetchImpl: async () => ({ ok: false, status: 429 }) }), { code: "PHOTON_RATE_LIMITED" });
  await assert.rejects(searchClassroomPlaces("place", { fetchImpl: async () => { throw new TypeError("offline"); } }), { code: "PHOTON_NETWORK_ERROR" });
  await assert.rejects(searchClassroomPlaces("place", { fetchImpl: async () => ({ ok: true, json: async () => ({ bad: true }) }) }), { code: "PHOTON_MALFORMED_RESPONSE" });
  await assert.rejects(searchClassroomPlaces("place", { fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError("bad json"); } }) }), { code: "PHOTON_INVALID_JSON" });
  assert.match(photonFailureMessage({ code: "PHOTON_RATE_LIMITED" }), /rate limiting/);
});

test("class editor debounces Photon, cancels stale requests, clears old coordinates, and moves the Leaflet marker", async () => {
  const [page, map] = await Promise.all([
    readFile(new URL("../src/pages/auth/admin/Classes.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/LocationMap.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /searchClassroomPlaces\(query, \{ signal: controller\.signal \}\)/);
  assert.match(page, /\}, 500\)/);
  assert.match(page, /controller\.abort\(\)/);
  assert.match(page, /placeRequestRef\.current === requestId/);
  assert.doesNotMatch(page, /GoogleClassroomMap|Google Maps|VITE_GOOGLE_MAPS_API_KEY|createGooglePlacesSession|resolveGooglePlace/);
  assert.match(page, /location_name: "",\s*latitude: "",\s*longitude: ""/);
  assert.match(page, /latitude: String\(place\.latitude\)/);
  assert.match(page, /longitude: String\(place\.longitude\)/);
  assert.match(page, /setLocationQuery\(place\.label\)/);
  assert.match(page, /if \(selectedPlace\) event\.currentTarget\.select\(\)/);
  assert.match(page, /no direct name, area, and place-type match/i);
  assert.match(page, /focusZoom=\{selectedPlace\?\.likelyEstablishment \? 18 : 16\}/);
  assert.match(page, /initialZoom=\{6\}/);
  assert.match(page, /I confirm this pin represents the classroom location\./);
  assert.match(page, /Search by Photon/);
  assert.match(page, /class-place-input-wrap/);
  assert.match(page, /Retry search/);
  assert.match(page, /Partial or nearby Photon match/);
  assert.match(map, /map\.setView\(point, focusZoom\)/);
  assert.match(map, /L\.map\(containerRef\.current, \{ scrollWheelZoom: false \}\)\.setView\(DEFAULT_CENTER, initialZoom\)/);
  assert.match(map, /markerRef\.current\.setLatLng\(point\)/);
  assert.match(map, /map\.on\("click", onMapClick\)/);
  assert.match(map, /dragend/);
  const css = await readFile(new URL("../src/pages/auth/admin/Classes.css", import.meta.url), "utf8");
  assert.match(css, /\.classes-card-with-location-search\s*\{[\s\S]*?overflow:\s*visible/);
  assert.match(css, /\.class-place-input-wrap\s*\{\s*position:\s*relative/);
  assert.match(css, /\.class-place-results\s*\{[\s\S]*?z-index:\s*1000/);
});

test("class Add/Edit keeps persisted location fields, confirmation, radius validation and attendance protections", async () => {
  const [page, teacher, student, sessions, face] = await Promise.all([
    readFile(new URL("../src/pages/auth/admin/Classes.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/teacher/TeacherAttendance.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/student/StudentAttendance.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../backend/app/api/tenant_attendance_sessions.py", import.meta.url), "utf8"),
    readFile(new URL("../../backend/app/api/tenant_face.py", import.meta.url), "utf8"),
  ]);
  assert.match(page, /latitude: item\.latitude \?\? ""/);
  assert.match(page, /longitude: item\.longitude \?\? ""/);
  assert.match(page, /radius_m: item\.radius_m \?\? 100/);
  assert.match(page, /isValidCoordinatePair\(form\.latitude, form\.longitude\)/);
  assert.match(page, /!locationConfirmed/);
  assert.match(page, /min="10" max="5000"/);
  assert.match(teacher, /requireStableFix: true/);
  assert.match(teacher, /teacher_latitude: teacherFix\.latitude/);
  assert.match(sessions, /haversine_m\(class_row\.latitude, class_row\.longitude, body\.teacher_latitude, body\.teacher_longitude\)/);
  assert.match(sessions, /latitude=class_row\.latitude/);
  assert.match(sessions, /longitude=class_row\.longitude/);
  assert.match(student, /coordinates = await getCurrentLocation\(\)/);
  assert.match(student, /submitStudentQrAttendance\(/);
  assert.match(student, /submitStudentFaceAttendance\(sessionId, capture, null/);
  assert.match(face, /if method == "qr":/);
  assert.match(face, /validate_geofence_fix\(latitude, longitude, accuracy, session\.radius_m, accuracy_limit\)/);
  assert.match(face, /else:\s+# Face attendance relies on registered face verification, not student GPS\./);
});
