import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createGooglePlacesSession,
  loadGoogleMaps,
  resolveGooglePlace,
  resetGoogleMapsLoaderForTests,
  searchClassroomPlaces,
} from "../src/utils/classroomGeocoding.js";

function createPlacesApi({ suggestions = [], details = {} } = {}) {
  const calls = { request: null, fields: null, tokenCount: 0 };
  class AutocompleteSessionToken {
    constructor() { calls.tokenCount += 1; }
  }
  const googleMaps = {
    importLibrary: async (name) => {
      assert.equal(name, "places");
      return {
        AutocompleteSessionToken,
        AutocompleteSuggestion: {
          fetchAutocompleteSuggestions: async (request) => {
            calls.request = request;
            if (suggestions instanceof Error) throw suggestions;
            return { suggestions };
          },
        },
      };
    },
  };
  const place = {};
  const prediction = {
    placeId: "google-place-1",
    mainText: { toString: () => "GCRG Group of Institutions" },
    secondaryText: { toString: () => "Parvatpur, Lucknow, Uttar Pradesh, India" },
    types: ["university", "point_of_interest"],
    toPlace: () => Object.assign(place, {
      id: "google-place-1",
      fetchFields: async ({ fields }) => {
        calls.fields = fields;
        Object.assign(place, details);
      },
    }),
  };
  return { googleMaps, calls, prediction, place };
}

test("Google Places Autocomplete requests any query and prioritizes establishment predictions", async () => {
  const establishment = {
    placePrediction: {
      placeId: "school-1",
      mainText: { toString: () => "GCRG Group of Institutions" },
      secondaryText: { toString: () => "Parvatpur, Lucknow, India" },
      types: ["university", "point_of_interest"],
    },
  };
  const address = {
    placePrediction: {
      placeId: "street-1",
      mainText: { toString: () => "Chandrika Devi Road" },
      secondaryText: { toString: () => "Bakshi Ka Talab, Lucknow, India" },
      types: ["route"],
    },
  };
  let request;
  const token = { id: "session-token" };
  const googleMaps = { importLibrary: async () => ({
    AutocompleteSuggestion: { fetchAutocompleteSuggestions: async (value) => { request = value; return { suggestions: [address, establishment] }; } },
  }) };
  const results = await searchClassroomPlaces("GCRG Group of Institutions, Parvatpur, Chandrika Devi Road, Bakshi Ka Talab, Lucknow, Uttar Pradesh, India", { googleMaps, sessionToken: token });
  assert.equal(request.input.startsWith("GCRG Group"), true);
  assert.equal(request.sessionToken, token);
  assert.equal(results.length, 2);
  assert.equal(results[0].name, "GCRG Group of Institutions");
  assert.equal(results[0].likelyEstablishment, true);
  assert.equal(results[0].address, "Parvatpur, Lucknow, India");
  assert.equal(results[1].placeType, "route");
  assert.deepEqual(await searchClassroomPlaces("ab", { googleMaps }), []);
});

test("Places session token is created once and selected details request only required fields", async () => {
  const fake = createPlacesApi({ details: {
    displayName: { toString: () => "GCRG Group of Institutions" },
    formattedAddress: "Parvatpur, Chandrika Devi Road, Lucknow, India",
    location: { lat: () => 26.9115, lng: () => 81.037 },
    viewport: { south: 26.9, west: 81.02, north: 26.92, east: 81.05 },
    types: ["university"],
  } });
  const token = await createGooglePlacesSession({ googleMaps: fake.googleMaps });
  assert.equal(fake.calls.tokenCount, 1);
  const result = await resolveGooglePlace(fake.prediction, { googleMaps: fake.googleMaps, sessionToken: token });
  assert.deepEqual(fake.calls.fields, ["displayName", "formattedAddress", "location", "viewport", "types"]);
  assert.equal(result.latitude, 26.9115);
  assert.equal(result.longitude, 81.037);
  assert.equal(result.viewport.south, 26.9);
  assert.equal(result.exactBuilding, false);
  assert.match(result.label, /Parvatpur/);
});

test("missing key, provider failures, and missing place geometry fail safely", async () => {
  await assert.rejects(loadGoogleMaps({ apiKey: "", windowRef: {}, documentRef: {} }), {
    code: "GOOGLE_MAPS_KEY_MISSING",
  });
  const failedPlaces = { importLibrary: async () => ({
    AutocompleteSessionToken: class AutocompleteSessionToken {},
    AutocompleteSuggestion: { fetchAutocompleteSuggestions: async () => { throw new Error("Places request failed"); } },
  }) };
  await assert.rejects(searchClassroomPlaces("GCRG Lucknow", { googleMaps: failedPlaces }), /Places request failed/);
  await assert.rejects(resolveGooglePlace({ toPlace: () => ({ fetchFields: async () => {}, location: null }) }), {
    code: "GOOGLE_PLACE_NO_GEOMETRY",
  });
});

test("Maps loader uses the configured browser key and async weekly Maps JavaScript API", async () => {
  resetGoogleMapsLoaderForTests();
  const scripts = [];
  const loadedWindow = {};
  const loadedDocument = { createElement: () => ({ dataset: {} }), head: { appendChild: (script) => {
    scripts.push(script);
    loadedWindow.google.maps.importLibrary = async () => ({});
    loadedWindow.google.maps.__attendxGoogleMapsReady();
  } } };
  await loadGoogleMaps({ apiKey: "synthetic-browser-key", windowRef: loadedWindow, documentRef: loadedDocument });
  const script = scripts.at(-1);
  assert.match(script.src, /maps\.googleapis\.com\/maps\/api\/js/);
  assert.match(script.src, /loading=async/);
  assert.match(script.src, /v=weekly/);
  assert.match(script.src, /callback=google\.maps/);
  assert.equal(script.async, true);
});

test("class editor clears old coordinates, uses Google Maps with a labeled manual fallback, and retains confirmation", async () => {
  const [page, map, mapCss] = await Promise.all([
    readFile(new URL("../src/pages/auth/admin/Classes.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/GoogleClassroomMap.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/GoogleClassroomMap.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /VITE_GOOGLE_MAPS_API_KEY/);
  assert.match(page, /resolveGooglePlace\(candidate\.prediction\)/);
  assert.match(page, /latitude: "",\s*longitude: ""/);
  assert.match(page, /setMapViewport\(place\.viewport \|\| null\)/);
  assert.match(page, /OpenStreetMap fallback below/);
  assert.match(page, /I confirm this pin represents the classroom location\./);
  assert.match(page, /Powered by Google Maps/);
  assert.match(page, /This result|Google returned this place point/);
  assert.match(map, /mapTypeIds: \["roadmap", "satellite"\]/);
  assert.match(map, /gmpDraggable/);
  assert.match(map, /gmp-dragend/);
  assert.match(map, /map\.addListener\("click"/);
  assert.match(map, /new maps\.Circle/);
  assert.match(map, /fitBounds\(viewport/);
  assert.match(mapCss, /height: clamp/);
});

test("Teacher geofence remains server authoritative and Student QR captures GPS at submit", async () => {
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
