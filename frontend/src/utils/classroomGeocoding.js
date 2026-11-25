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
  const normalized = String(value || "").replace(/\b(?:[a-z]\.){2,}[a-z]?\.?/gi, (abbreviation) => abbreviation.replace(/\./g, ""));
  return normalized.toLowerCase().match(/[a-z0-9]+/g) || [];
}

function normalizedSearchQuery(query) {
  return String(query || "").trim().replace(/\b(?:[a-z]\.){2,}[a-z]?\.?/gi, (abbreviation) => abbreviation.replace(/\./g, ""));
}

const EDUCATION_QUERY_TERMS = new Set(["college", "colleges", "university", "universities", "school", "schools", "institute", "institutes", "institution", "institutions"]);
const EDUCATIONAL_OSM_VALUES = new Set(["college", "university", "school", "education", "educational_institution", "university_campus"]);
const EDUCATION_RESULT_KEYS = new Set(["amenity", "building", "office", "landuse"]);
const GENERIC_QUERY_TERMS = new Set(["the", "and", "of", "near", "in", "at", "building", "address", "place", "group", "groups", ...EDUCATION_QUERY_TERMS]);

function educationalFeature(place) {
  return EDUCATION_RESULT_KEYS.has(place.osmKey) && EDUCATIONAL_OSM_VALUES.has(place.osmValue);
}

function rankResult(place, query) {
  const queryWords = [...new Set(searchableWords(query))];
  const nameWords = new Set(searchableWords(place.name));
  const addressWords = new Set(searchableWords(place.address));
  const educationIntent = queryWords.some((word) => EDUCATION_QUERY_TERMS.has(word));
  const informativeWords = queryWords.filter((word) => word.length > 2 && !GENERIC_QUERY_TERMS.has(word));
  const matchedWords = informativeWords.filter((word) => nameWords.has(word) || addressWords.has(word));
  let score = 0;

  for (const word of informativeWords) {
    if (nameWords.has(word)) score += 8;
    else if (addressWords.has(word)) score += 4;
  }

  // Match organizational words in the name even though they are generic in
  // ordinary searches. These help distinguish institution names from nearby
  // addresses when the user explicitly searches for a College or institute.
  if (educationIntent) {
    for (const word of queryWords.filter((term) => EDUCATION_QUERY_TERMS.has(term) || ["group", "groups"].includes(term))) {
      if (nameWords.has(word)) score += 3;
    }
    score += educationalFeature(place) ? 10 : -12;
  }

  const allInformativeTermsMatch = informativeWords.length > 0 && matchedWords.length === informativeWords.length;
  const categoryMatches = !educationIntent || educationalFeature(place);
  return {
    score,
    queryMatch: allInformativeTermsMatch && categoryMatches,
  };
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
    osmKey: key,
    osmValue: value,
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
    if (!place) continue;
    const existing = unique.get(place.id);
    if (!existing) unique.set(place.id, place);
  }
  return Array.from(unique.values())
    .map((place, index) => ({ ...place, ...rankResult(place, query), providerOrder: index }))
    .sort((left, right) => right.score - left.score || left.providerOrder - right.providerOrder)
    .slice(0, 20)
    .map(({ score, providerOrder, ...place }) => place);
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

  const requestPhoton = async (searchQuery) => {
    const url = new URL(PHOTON_API_URL);
    url.searchParams.set("q", searchQuery);
    url.searchParams.set("limit", "10");
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

    try {
      return await response.json();
    } catch {
      const error = new Error("Photon returned invalid location data. Retry or place the classroom pin manually.");
      error.code = "PHOTON_INVALID_JSON";
      throw error;
    }
  };

  const firstPayload = await requestPhoton(normalizedQuery);
  const firstResults = normalizePhotonResults(firstPayload, normalizedQuery);
  const normalizedVariation = normalizedSearchQuery(normalizedQuery);
  if (normalizedVariation === normalizedQuery || firstResults.some((place) => place.queryMatch)) return firstResults;

  // One punctuation-only retry helps names written with dotted initials
  // without changing the visible query or issuing a fan-out of searches.
  try {
    const variationPayload = await requestPhoton(normalizedVariation);
    return normalizePhotonResults({
      features: [...(firstPayload.features || []), ...(variationPayload.features || [])],
    }, normalizedQuery);
  } catch (error) {
    if (error?.name === "AbortError" || firstResults.length === 0) throw error;
    // A throttled optional normalization retry must not discard usable results
    // from the successful exact user query.
    return firstResults;
  }
}

export function photonFailureMessage(error) {
  if (error?.code === "PHOTON_RATE_LIMITED") return "Photon is rate limiting location searches. Wait a moment and retry, or place the classroom pin manually.";
  if (error?.code === "PHOTON_MALFORMED_RESPONSE" || error?.code === "PHOTON_INVALID_JSON") return "Photon returned invalid location data. Retry or place the classroom pin manually.";
  if (error?.code === "PHOTON_NETWORK_ERROR") return "Location search could not reach Photon. Check your internet connection, retry, or place the classroom pin manually.";
  return error?.message || "Photon location search is temporarily unavailable. Retry or place the classroom pin manually.";
}
