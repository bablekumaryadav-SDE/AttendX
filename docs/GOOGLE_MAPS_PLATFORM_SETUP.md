# Class location search and map

The active College Admin class-location workflow uses the free Photon search endpoint, OpenStreetMap map tiles, and Leaflet interactions. It does not require Google Maps, Google Places, a browser API key, or a paid map service.

## Search and map behavior

- Search requests are sent to `https://photon.komoot.io/api/` after a 500 ms typing debounce and only for queries of at least three characters. Obvious fuzzy mismatches are filtered against the query, and duplicate OSM features are removed.
- Photon GeoJSON results provide the coordinates directly. The application reads the GeoJSON coordinate order as `[longitude, latitude]`, then writes the correct latitude and longitude fields.
- Results identify OpenStreetMap objects (for example, an OSM type and ID), not Google Place IDs. The selected feature's point is approximate and may represent a campus or entrance rather than a classroom.
- The Leaflet map uses OpenStreetMap tiles and attribution. A College Admin can move the pin by dragging it or clicking the map, then must explicitly confirm the classroom pin before saving.
- Add Class starts without a saved classroom marker. Edit Class loads the class's persisted location and radius through the existing College-scoped API.
- Browser geolocation remains an explicit “Detect My Location” action. Its result is only a suggested pin and is not assigned automatically.

## Public service use

Photon is a public search service and may return no result, unrelated fuzzy matches, rate limits, or temporary network errors. Search is debounced and limited to five results per request. Do not issue bulk or high-frequency requests. If search is unavailable, use the map's manual pin controls. OpenStreetMap attribution is shown with the map.

The existing `GoogleClassroomMap` component and Google-specific helper source are preserved in the repository for user-work safety, but are not imported by the active class editor. They are not part of the active location runtime.

## Attendance location protection

This class-location interface stores only the existing class location name, latitude, longitude, and radius fields. Teacher lecture creation continues to use the authorized class's saved location and radius and the backend snapshots those values into the session. Student QR GPS checks remain server validated. Face attendance continues without adding a student GPS requirement. No database schema or migration is required by the search/map conversion.
