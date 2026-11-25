let googleMapsPromise;
const AUTH_FAILURE_HANDLER = "__attendxGoogleMapsAuthHandlerInstalled";
const MAPS_READY_CALLBACK = "__attendxGoogleMapsReady";

export function getGoogleMapsApiKey() {
  return String(import.meta.env?.VITE_GOOGLE_MAPS_API_KEY || "").trim();
}

export function createGoogleMapsError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function googleMapsFailureMessage(error, action = "place search") {
  if (error?.code === "GOOGLE_MAPS_KEY_MISSING" || error?.code === "GOOGLE_MAPS_LOAD_FAILED"
    || error?.code === "GOOGLE_PLACE_NO_GEOMETRY" || error?.code === "GOOGLE_PLACE_INVALID") {
    return error.message;
  }
  const diagnostic = [error?.code, error?.status, error?.message].filter(Boolean).join(" ").toLowerCase();
  if (/referer|referrer|apitargetblocked|referernotallowed/.test(diagnostic)) {
    return "Google Maps rejected this website referrer. Add the current localhost/domain origin to the key's website restrictions. Manual pin selection is available.";
  }
  if (/billing|billingnotenabled/.test(diagnostic)) {
    return "Google Maps Platform billing is not enabled for this project. Enable billing, then retry. Manual pin selection is available.";
  }
  if (/places.*(not enabled|not activated|unauthorized)|api_not_activated|request_denied/.test(diagnostic)) {
    return "Places API (New) is disabled or not authorized for this key. Enable Places API (New), check API restrictions, and retry. Manual pin selection is available.";
  }
  if (/quota|over_query_limit|resource_exhausted/.test(diagnostic)) {
    return "Google Places quota or rate limit was reached. Check the project's Places API quota and retry later. Manual pin selection is available.";
  }
  return `Google Maps ${action} failed. Verify Maps JavaScript API and Places API (New) are enabled, billing is active, the website referrer is allowed, and the network is available. Manual pin selection is available.`;
}

export function navigateGoogleMapToLocation(map, { latitude, longitude, viewport = null }) {
  const point = { lat: Number(latitude), lng: Number(longitude) };
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    throw createGoogleMapsError("GOOGLE_PLACE_NO_GEOMETRY", "The selected place has no valid map coordinates.");
  }
  if (viewport && typeof map?.fitBounds === "function") {
    map.fitBounds(viewport, 40);
    return { point, usedViewport: true };
  }
  map?.setCenter?.(point);
  map?.setZoom?.(18);
  return { point, usedViewport: false };
}

export function syncGoogleMarker(marker, map, { latitude, longitude, title = "Classroom location", draggable = true }) {
  const position = { lat: Number(latitude), lng: Number(longitude) };
  if (!Number.isFinite(position.lat) || !Number.isFinite(position.lng)) {
    throw createGoogleMapsError("GOOGLE_PLACE_NO_GEOMETRY", "The selected place has no valid marker coordinates.");
  }
  marker.position = position;
  marker.title = title || "Classroom location";
  marker.gmpDraggable = Boolean(draggable);
  marker.map = map;
  return position;
}

/** Load the supported Maps JavaScript API entry point and its requested libraries. */
export function loadGoogleMaps({
  apiKey = getGoogleMapsApiKey(),
  windowRef = globalThis.window,
  documentRef = globalThis.document,
} = {}) {
  if (!apiKey) {
    return Promise.reject(createGoogleMapsError(
      "GOOGLE_MAPS_KEY_MISSING",
      "Google Maps is not configured. Add VITE_GOOGLE_MAPS_API_KEY to the frontend environment and restart Vite. Manual pin selection remains available.",
    ));
  }
  if (!windowRef || !documentRef) {
    return Promise.reject(createGoogleMapsError("GOOGLE_MAPS_UNAVAILABLE", "Google Maps is unavailable in this browser."));
  }
  if (windowRef.google?.maps?.importLibrary) return Promise.resolve(windowRef.google.maps);
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise((resolve, reject) => {
    const script = documentRef.createElement("script");
    script.async = true;
    script.dataset.attendxGoogleMaps = "true";
    const params = new URLSearchParams({ key: apiKey, v: "weekly", loading: "async", callback: `google.maps.${MAPS_READY_CALLBACK}` });
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    const loadTimeout = globalThis.setTimeout(() => {
      delete windowRef.google?.maps?.[MAPS_READY_CALLBACK];
      googleMapsPromise = null;
      reject(createGoogleMapsError(
        "GOOGLE_MAPS_LOAD_FAILED",
        "Google Maps did not finish loading. Check the API key, enabled APIs, billing, referrer restrictions, and network connection. Manual pin selection remains available.",
      ));
    }, 15000);
    windowRef.google ||= {};
    windowRef.google.maps ||= {};
    windowRef.google.maps[MAPS_READY_CALLBACK] = () => {
      globalThis.clearTimeout(loadTimeout);
      const maps = windowRef.google?.maps;
      if (maps?.importLibrary) resolve(maps);
      else {
        googleMapsPromise = null;
        reject(createGoogleMapsError("GOOGLE_MAPS_LOAD_FAILED", "Google Maps did not initialize. Check the API key and Maps JavaScript API setup."));
      }
    };
    if (!windowRef[AUTH_FAILURE_HANDLER]) {
      const existingHandler = windowRef.gm_authFailure;
      windowRef.gm_authFailure = () => {
        windowRef.dispatchEvent?.(new Event("attendx:google-maps-auth-error"));
        if (typeof existingHandler === "function") existingHandler();
      };
      windowRef[AUTH_FAILURE_HANDLER] = true;
    }
    script.onerror = () => {
      globalThis.clearTimeout(loadTimeout);
      delete windowRef.google?.maps?.[MAPS_READY_CALLBACK];
      googleMapsPromise = null;
      reject(createGoogleMapsError(
        "GOOGLE_MAPS_LOAD_FAILED",
        "Google Maps could not load. Check the API key restrictions, enabled Maps JavaScript API, billing, and network connection. Manual pin selection remains available.",
      ));
    };
    documentRef.head.appendChild(script);
  });
  return googleMapsPromise;
}

export async function createGooglePlacesSession({ googleMaps } = {}) {
  const maps = googleMaps || await loadGoogleMaps();
  const places = await maps.importLibrary("places");
  return new places.AutocompleteSessionToken();
}

function predictionTypeLabel(prediction) {
  const types = Array.isArray(prediction?.types) ? prediction.types : [];
  return types.length ? types.slice(0, 3).join(" · ") : "Google Maps place result";
}

/** Query Places API (New); the caller reuses one token until the user selects a prediction. */
export async function searchClassroomPlaces(query, { sessionToken, googleMaps } = {}) {
  const input = String(query || "").trim();
  if (input.length < 3) return [];
  const maps = googleMaps || await loadGoogleMaps();
  const places = await maps.importLibrary("places");
  const token = sessionToken || new places.AutocompleteSessionToken();
  const { suggestions = [] } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input,
    sessionToken: token,
  });

  return suggestions
    .map((suggestion) => {
      const prediction = suggestion.placePrediction;
      if (!prediction?.placeId) return null;
      const name = prediction.mainText?.toString?.()
        || prediction.structuredFormat?.mainText?.text
        || prediction.text?.toString?.()
        || "Place result";
      const address = prediction.secondaryText?.toString?.()
        || prediction.structuredFormat?.secondaryText?.text
        || "Address details are available after selection";
      const types = Array.isArray(prediction.types) ? prediction.types : [];
      return {
        id: prediction.placeId,
        name,
        address,
        placeType: predictionTypeLabel(prediction),
        likelyEstablishment: types.some((type) => ["establishment", "premise", "subpremise", "point_of_interest", "school", "university", "hospital", "shopping_mall"].includes(type)),
        prediction,
      };
    })
    .filter(Boolean)
    // Keep Google's relevance order within each group, while surfacing establishments first.
    .map((place, index) => ({ ...place, index }))
    .sort((left, right) => Number(right.likelyEstablishment) - Number(left.likelyEstablishment) || left.index - right.index)
    .map(({ index, ...place }) => place)
    .slice(0, 5);
}

/** Resolve only the fields needed to position and label the selected place. */
export async function resolveGooglePlace(prediction, { googleMaps } = {}) {
  if (!prediction?.toPlace) {
    throw createGoogleMapsError("GOOGLE_PLACE_INVALID", "That place result is no longer available. Search again or place the pin manually.");
  }
  const predictionPlaceId = String(prediction.placeId || "").trim();
  if (!predictionPlaceId) {
    throw createGoogleMapsError("GOOGLE_PLACE_INVALID", "Google did not provide a valid Place ID for that result. Search again.");
  }
  const place = prediction.toPlace();
  await place.fetchFields({
    fields: ["id", "displayName", "formattedAddress", "location", "viewport", "types"],
  });
  const placeId = String(place.id || "").trim();
  if (!placeId || placeId !== predictionPlaceId) {
    throw createGoogleMapsError("GOOGLE_PLACE_INVALID", "Google Place Details did not confirm the selected Place ID. Search again before choosing a location.");
  }
  const location = place.location;
  const latitude = typeof location?.lat === "function" ? location.lat() : location?.lat;
  const longitude = typeof location?.lng === "function" ? location.lng() : location?.lng;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw createGoogleMapsError("GOOGLE_PLACE_NO_GEOMETRY", "Google Maps did not return coordinates for this result. Choose another result or place the pin manually.");
  }
  const name = place.displayName?.toString?.() || String(place.displayName || "Selected place");
  const address = String(place.formattedAddress || "");
  const types = Array.isArray(place.types) ? place.types : [];
  return {
    id: placeId,
    placeId,
    name,
    address,
    label: [name, address].filter(Boolean).join(", "),
    latitude,
    longitude,
    viewport: place.viewport || null,
    placeType: types.slice(0, 3).join(" · ") || "Google Maps place result",
    likelyEstablishment: types.some((type) => ["establishment", "premise", "subpremise", "point_of_interest", "school", "university", "hospital", "shopping_mall"].includes(type)),
    // A Places point may be an entrance or campus centroid, never a room-level location.
    exactBuilding: false,
  };
}

export function resetGoogleMapsLoaderForTests() {
  googleMapsPromise = undefined;
}
