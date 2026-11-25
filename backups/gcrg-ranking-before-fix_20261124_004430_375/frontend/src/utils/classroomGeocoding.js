const PHOTON_API_URL = "https://photon.komoot.io/api/";

function coordinate(value, minimum, maximum) {
  if (value == null || (typeof value === "string" && value.trim() === "")) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function joinAddress(properties) {
  const street = [properties.housenumber, properties.street].filter(Boolean).join(" ");
  return [
    street,
    properties.postcode,
    properties.city || properties.town || properties.village || properties.municipality,
    properties.district || properties.county,
    properties.state,
    properties.country,
  ].filter((part, index, values) => part && values.indexOf(part) === index).join(", ");
}

function searchableWords(value) {
  const normalized = String(value || "").replace(/\b(?:[a-z]\.){2,}[a-z]?/gi, (abbreviation) => abbreviation.replace(/\./g, ""));
  return normalized.toLowerCase().match(/[a-z0-9]+/g) || [];
}

function matchesQueryText(place, query) {
  const queryWords = searchableWords(query);
  const resultWords = new Set(searchableWords(`${place.name} ${place.address}`));
  if (queryWords.includes("gcrg")) return resultWords.has("gcrg");
  const generic = new Set(["the", "and", "of", "near", "in", "at", "building", "address", "place", "institution", "institutions", "group", "college", "university"]);
  const meaningful = queryWords.filter((word) => word.length >= 3 && !generic.has(word));
  return meaningful.length === 0 || meaningful.some((word) => resultWords.has(word));
}

export function normalizePhotonFeature(feature) {
  const properties = feature?.properties;
  const coordinates = feature?.geometry?.coordinates;
  if (!properties || feature?.geometry?.type !== "Point" || !Array.isArray(coordinates) || coordinates.length < 2) return null;

  // GeoJSON uses [longitude, latitude]. Keep this conversion explicit so the
  // class form and Leaflet receive latitude/longitude in their own fields.
  const longitude = coordinate(coordinates[0], -180, 180);
  const latitude = coordinate(coordinates[1], -90, 90);
  if (latitude == null || longitude == null) return null;

  const name = String(properties.name || properties.street || properties.locality || "").trim();
  const address = joinAddress(properties);
  const fallbackName = [properties.osm_key, properties.osm_value].filter(Boolean).join(" ");
  const displayName = name || fallbackName || address;
  if (!displayName) return null;

  const osmType = String(properties.osm_type || "").trim();
  const osmId = properties.osm_id == null ? "" : String(properties.osm_id);
  const id = feature.id != null
    ? String(feature.id)
    : (osmType && osmId ? `${osmType}/${osmId}` : `${latitude},${longitude}`);
  const key = String(properties.osm_key || "").toLowerCase();
  const value = String(properties.osm_value || properties.type || "").toLowerCase();
  const likelyEstablishment = key === "building"
    || (key === "amenity" && ["college", "university", "school", "hospital", "clinic", "library"].includes(value))
    || (key === "office" && value === "educational_institution");

  return {
    id,
    name: displayName,
    address,
    label: address && address !== displayName ? `${displayName}, ${address}` : displayName,
    latitude,
    longitude,
    osmType,
    osmId,
    placeType: [properties.osm_key, properties.osm_value || properties.type].filter(Boolean).join(" · ") || "OpenStreetMap result",
    likelyEstablishment,
    approximate: true,
  };
}

export function normalizePhotonResults(payload, query = "") {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.features)) {
    const error = new Error("The location search service returned an unreadable response. Try again or place the classroom pin manually.");
    error.code = "PHOTON_MALFORMED_RESPONSE";
    throw error;
  }

  const unique = new Map();
  for (const feature of payload.features) {
    const place = normalizePhotonFeature(feature);
    if (place && !unique.has(place.id)) {
      unique.set(place.id, { ...place, queryMatch: matchesQueryText(place, query) });
    }
  }
  return Array.from(unique.values()).slice(0, 5);
}

export async function searchClassroomPlaces(query, {
  signal,
  fetchImpl = globalThis.fetch,
} = {}) {
  const normalizedQuery = String(query || "").trim();
  if (normalizedQuery.length < 3) return [];
  if (typeof fetchImpl !== "function") {
    const error = new Error("Location search is unavailable in this browser. You can still place the classroom pin manually.");
    error.code = "PHOTON_UNAVAILABLE";
    throw error;
  }

  const url = new URL(PHOTON_API_URL);
  url.searchParams.set("q", normalizedQuery);
  url.searchParams.set("limit", "5");
  url.searchParams.set("lang", "en");

  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: { Accept: "application/geo+json, application/json" },
      signal,
    });
  } catch (cause) {
    if (cause?.name === "AbortError") throw cause;
    const error = new Error("Location search could not reach Photon. Check your internet connection, retry, or place the classroom pin manually.");
    error.code = "PHOTON_NETWORK_ERROR";
    throw error;
  }

  if (!response?.ok) {
    const error = response?.status === 429
      ? new Error("Photon is rate limiting location searches. Wait a moment and retry, or place the classroom pin manually.")
      : new Error("Photon location search is temporarily unavailable. Retry shortly or place the classroom pin manually.");
    error.code = response?.status === 429 ? "PHOTON_RATE_LIMITED" : "PHOTON_HTTP_ERROR";
    error.status = response?.status;
    throw error;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    const error = new Error("Photon returned invalid location data. Retry or place the classroom pin manually.");
    error.code = "PHOTON_INVALID_JSON";
    throw error;
  }

  return normalizePhotonResults(payload, normalizedQuery);
}

export function photonFailureMessage(error) {
  if (error?.code === "PHOTON_RATE_LIMITED") return "Photon is rate limiting location searches. Wait a moment and retry, or place the classroom pin manually.";
  if (error?.code === "PHOTON_MALFORMED_RESPONSE" || error?.code === "PHOTON_INVALID_JSON") return "Photon returned invalid location data. Retry or place the classroom pin manually.";
  if (error?.code === "PHOTON_NETWORK_ERROR") return "Location search could not reach Photon. Check your internet connection, retry, or place the classroom pin manually.";
  return error?.message || "Photon location search is temporarily unavailable. Retry or place the classroom pin manually.";
}
