const EDUCATION_PLACE_TYPES = new Set([
  "college",
  "university",
  "school",
  "kindergarten",
  "academy",
]);

function clean(parts) {
  return parts.filter((part) => typeof part === "string" && part.trim()).map((part) => part.trim());
}

export function normalizePhotonFeature(feature) {
  const coordinates = feature?.geometry?.coordinates;
  const longitude = Number(coordinates?.[0]);
  const latitude = Number(coordinates?.[1]);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;

  const properties = feature.properties || {};
  const placeType = [properties.osm_key, properties.osm_value, properties.type]
    .filter(Boolean).join(" · ");
  const exactBuilding = properties.osm_key === "building"
    || (properties.osm_key === "amenity" && EDUCATION_PLACE_TYPES.has(String(properties.osm_value || "").toLowerCase()));
  const address = clean([
    properties.housenumber && properties.street ? `${properties.housenumber} ${properties.street}` : properties.street,
    properties.district,
    properties.city || properties.locality,
    properties.state,
    properties.postcode,
    properties.country,
  ]).join(", ");
  const name = String(properties.name || properties.street || properties.city || properties.locality || "Unnamed map result").trim();
  return {
    latitude,
    longitude,
    name,
    address,
    placeType: placeType || "map location",
    exactBuilding,
    label: [name, address].filter(Boolean).join(" — "),
  };
}

export function normalizePhotonResults(payload) {
  return (Array.isArray(payload?.features) ? payload.features : [])
    .map(normalizePhotonFeature)
    .filter(Boolean)
    .sort((left, right) => Number(right.exactBuilding) - Number(left.exactBuilding))
    .slice(0, 5);
}

export async function searchClassroomPlaces(query, { signal, fetchImpl = globalThis.fetch } = {}) {
  const normalizedQuery = String(query || "").trim();
  if (normalizedQuery.length < 3) return [];
  if (typeof fetchImpl !== "function") throw new Error("Place search is unavailable in this browser.");
  const params = new URLSearchParams({ q: normalizedQuery, limit: "5", lang: "en" });
  const response = await fetchImpl(`https://photon.komoot.io/api/?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error("Place search is temporarily unavailable. You can still choose the pin manually.");
  return normalizePhotonResults(await response.json());
}
