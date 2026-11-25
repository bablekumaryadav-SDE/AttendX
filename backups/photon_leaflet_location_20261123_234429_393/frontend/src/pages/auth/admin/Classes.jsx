import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import { createClass, deactivateClass, getClass, getClasses, updateClass } from "../../../services/academic";
import { classLoadMessage, createLatestRequestGuard } from "../../../services/tenantSelection";
import { getApiErrorMessage } from "../../../utils/errors";
import LocationMap from "../../../components/LocationMap";
import GoogleClassroomMap from "../../../components/GoogleClassroomMap";
import { detectClassroomLocation, isValidCoordinatePair } from "../../../utils/classroomLocation";
import { createGooglePlacesSession, getGoogleMapsApiKey, googleMapsFailureMessage, resolveGooglePlace, searchClassroomPlaces } from "../../../utils/classroomGeocoding";
import "./Classes.css";

function requestMessage(error) {
  return getApiErrorMessage(error, classLoadMessage(error.response?.status));
}

function placeProviderMessage(error, action) {
  return googleMapsFailureMessage(error, action);
}

function locationFailureMessage(error) {
  switch (error?.code) {
    case "GEOLOCATION_UNSUPPORTED": return "Location detection is not supported by this browser. Enter coordinates manually or select the map pin.";
    case "GEOLOCATION_PERMISSION_DENIED": return "Location permission was denied. Allow location access for this site, then try again.";
    case "GEOLOCATION_UNAVAILABLE": return "The device could not determine a location. Check device location services or select the pin manually.";
    case "GEOLOCATION_TIMEOUT": return "Location detection timed out after 15 seconds. Move to a clearer signal area or select the pin manually.";
    case "GEOLOCATION_INVALID": return "The browser returned invalid coordinates or accuracy. Try again or select the pin manually.";
    default: return "Location detection failed. Check browser location permission and try again.";
  }
}

export default function Classes() {
  const { activeCollegeId, collegeMemberships } = useAuth();
  const canManage = collegeMemberships.some((membership) => String(membership.college_id) === String(activeCollegeId) && membership.membership_role === "college_admin");
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedClassId, setSelectedClassId] = useState(null);
  const [classDetail, setClassDetail] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingClassId, setEditingClassId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [detectingLocation, setDetectingLocation] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [gpsAccuracy, setGpsAccuracy] = useState(null);
  const [locationConfirmed, setLocationConfirmed] = useState(false);
  const [locationQuery, setLocationQuery] = useState("");
  const [placeResults, setPlaceResults] = useState([]);
  const [placeLoading, setPlaceLoading] = useState(false);
  const [placeError, setPlaceError] = useState("");
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [locationSearchEnabled, setLocationSearchEnabled] = useState(false);
  const [googleMapState, setGoogleMapState] = useState({ status: "loading", message: "Loading Google Maps…" });
  const [mapViewport, setMapViewport] = useState(null);
  const [form, setForm] = useState({ name: "", section: "", department: "", semester: "", academic_year: "", location_name: "", latitude: "", longitude: "", radius_m: "100" });
  const listGuard = useRef(null);
  const detailGuard = useRef(null);
  const mountedRef = useRef(false);
  const selectedPlaceRef = useRef(selectedPlace);
  selectedPlaceRef.current = selectedPlace;
  const locationRequestRef = useRef(0);
  const placeRequestRef = useRef(0);
  const placeSessionRef = useRef(null);
  if (!listGuard.current) listGuard.current = createLatestRequestGuard();
  if (!detailGuard.current) detailGuard.current = createLatestRequestGuard();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      locationRequestRef.current += 1;
      placeRequestRef.current += 1;
      placeSessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    const query = locationQuery.trim();
    if (!locationSearchEnabled || selectedPlace?.label === query || query.length < 3) {
      setPlaceResults([]);
      setPlaceLoading(false);
      if (query.length < 3) setPlaceError("");
      return undefined;
    }
    const requestId = ++placeRequestRef.current;
    setPlaceResults([]);
    setPlaceLoading(true);
    const timer = window.setTimeout(async () => {
      setPlaceError("");
      try {
        if (!getGoogleMapsApiKey()) {
          throw new Error("Google Maps place search needs VITE_GOOGLE_MAPS_API_KEY. Add it to the frontend environment and restart Vite. You can still place the pin manually.");
        }
        if (googleMapState.status === "error") {
          throw new Error("Google Maps could not load. Check the API key, enabled APIs, billing, and website restrictions. You can still place the pin manually.");
        }
        if (!placeSessionRef.current) placeSessionRef.current = await createGooglePlacesSession();
        const results = await searchClassroomPlaces(query, { sessionToken: placeSessionRef.current });
        if (placeRequestRef.current === requestId) setPlaceResults(results);
      } catch (searchError) {
        if (placeRequestRef.current === requestId) {
          setPlaceResults([]);
          setPlaceError(placeProviderMessage(searchError, "place search"));
        }
      } finally {
        if (placeRequestRef.current === requestId) setPlaceLoading(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [locationQuery, selectedPlace, locationSearchEnabled, googleMapState.status]);

  const loadClasses = useCallback(async () => {
    const version = listGuard.current.begin();
    detailGuard.current.invalidate();
    setLoading(true);
    setError("");
    setClasses([]);
    setSelectedClassId(null);
    setClassDetail(null);
    setDetailError("");
    try {
      const rows = await getClasses(activeCollegeId);
      if (!listGuard.current.isCurrent(version)) return;
      setClasses(Array.isArray(rows) ? rows : []);
    } catch (requestError) {
      if (!listGuard.current.isCurrent(version)) return;
      setError(requestMessage(requestError));
    } finally {
      if (listGuard.current.isCurrent(version)) setLoading(false);
    }
  }, [activeCollegeId]);

  useEffect(() => {
    void loadClasses();
    return () => {
      listGuard.current.invalidate();
      detailGuard.current.invalidate();
    };
  }, [loadClasses]);

  const visibleClasses = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return classes;
    return classes.filter((item) => [
      item.name, item.section, item.department, item.academic_year, item.semester,
    ].some((value) => String(value ?? "").toLowerCase().includes(query)));
  }, [classes, search]);

  const showClass = async (classId) => {
    const version = detailGuard.current.begin();
    setSelectedClassId(classId);
    setClassDetail(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      const result = await getClass(classId, activeCollegeId);
      if (detailGuard.current.isCurrent(version)) setClassDetail(result);
    } catch (requestError) {
      if (detailGuard.current.isCurrent(version)) setDetailError(requestMessage(requestError));
    } finally {
      if (detailGuard.current.isCurrent(version)) setDetailLoading(false);
    }
  };

  const openCreate = () => {
    locationRequestRef.current += 1;
    setDetectingLocation(false);
    setLocationError("");
    setGpsAccuracy(null);
    setLocationConfirmed(false);
    setLocationQuery("");
    setPlaceResults([]);
    setPlaceError("");
    setSelectedPlace(null);
    setMapViewport(null);
    setLocationSearchEnabled(false);
    placeSessionRef.current = null;
    setGoogleMapState({ status: "loading", message: "Loading Google Maps…" });
    setEditingClassId(null);
    setForm({ name: "", section: "", department: "", semester: "", academic_year: "", location_name: "", latitude: "", longitude: "", radius_m: "100" });
    setFormError("");
    setFormOpen(true);
  };

  const openEdit = (item) => {
    locationRequestRef.current += 1;
    setDetectingLocation(false);
    setLocationError("");
    setGpsAccuracy(null);
    setLocationConfirmed(false);
    setLocationQuery(item.location_name || "");
    setPlaceResults([]);
    setPlaceError("");
    setSelectedPlace(null);
    setMapViewport(null);
    setLocationSearchEnabled(false);
    placeSessionRef.current = null;
    setGoogleMapState({ status: "loading", message: "Loading Google Maps…" });
    setEditingClassId(item.id);
    setForm({ name: item.name || "", section: item.section || "", department: item.department || "", semester: item.semester ?? "", academic_year: item.academic_year || "", location_name: item.location_name || "", latitude: item.latitude ?? "", longitude: item.longitude ?? "", radius_m: item.radius_m ?? 100 });
    setFormError("");
    setFormOpen(true);
  };

  const saveClass = async (event) => {
    event.preventDefault();
    if (!activeCollegeId || saving) return;
    if (!isValidCoordinatePair(form.latitude, form.longitude)) {
      setFormError("Enter valid classroom latitude and longitude before saving.");
      return;
    }
    if (!locationConfirmed) {
      setFormError("Confirm that the selected pin represents the classroom before saving.");
      return;
    }
    setSaving(true);
    setFormError("");
    const payload = {
      ...form,
      semester: form.semester === "" ? null : Number(form.semester),
      latitude: form.latitude === "" ? null : Number(form.latitude),
      longitude: form.longitude === "" ? null : Number(form.longitude),
      radius_m: Number(form.radius_m || 100),
    };
    for (const key of ["section", "department", "academic_year", "location_name"]) payload[key] = payload[key].trim() || null;
    try {
      if (editingClassId == null) await createClass(payload, activeCollegeId);
      else await updateClass(editingClassId, payload, activeCollegeId);
      setFormOpen(false);
      await loadClasses();
    } catch (requestError) {
      setFormError(requestMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const updateManualLocation = (changes) => {
    locationRequestRef.current += 1;
    setDetectingLocation(false);
    setGpsAccuracy(null);
    setLocationError("");
    setLocationConfirmed(false);
    setSelectedPlace(null);
    setMapViewport(null);
    setFormError("");
    setForm((current) => ({ ...current, ...changes }));
  };

  const handleGoogleMapState = (state) => {
    setGoogleMapState(state);
    // Never render a Google Places point on the Leaflet fallback if the Google map fails.
    if (state.status === "error" && selectedPlaceRef.current) {
      updateManualLocation({ latitude: "", longitude: "" });
    }
  };

  const selectResolvedPlace = (place) => {
    updateManualLocation({
      location_name: place.label.slice(0, 120),
      latitude: String(place.latitude),
      longitude: String(place.longitude),
    });
    setSelectedPlace(place);
    setMapViewport(place.viewport || null);
    setLocationQuery(place.label);
    setLocationSearchEnabled(false);
    setPlaceResults([]);
    setPlaceError("");
    placeSessionRef.current = null;
  };

  const selectPlace = async (candidate) => {
    const requestId = ++placeRequestRef.current;
    setPlaceLoading(true);
    setPlaceError("");
    setPlaceResults([]);
    try {
      const place = await resolveGooglePlace(candidate.prediction);
      if (mountedRef.current && placeRequestRef.current === requestId) selectResolvedPlace(place);
    } catch (resolveError) {
      if (mountedRef.current && placeRequestRef.current === requestId) {
        setPlaceError(placeProviderMessage(resolveError, "place details"));
      }
    } finally {
      if (mountedRef.current && placeRequestRef.current === requestId) setPlaceLoading(false);
    }
  };

  const detectLocation = async () => {
    const requestId = ++locationRequestRef.current;
    setSelectedPlace(null);
    setLocationSearchEnabled(false);
    setDetectingLocation(true);
    setLocationError("");
    setGpsAccuracy(null);
    setLocationConfirmed(false);
    setFormError("");
    try {
      const position = await detectClassroomLocation();
      if (!mountedRef.current || locationRequestRef.current !== requestId) return;
      setForm((current) => ({
        ...current,
        latitude: String(position.latitude),
        longitude: String(position.longitude),
      }));
      setGpsAccuracy(position.accuracy);
    } catch (requestError) {
      if (mountedRef.current && locationRequestRef.current === requestId) {
        setLocationError(locationFailureMessage(requestError));
      }
    } finally {
      if (mountedRef.current && locationRequestRef.current === requestId) setDetectingLocation(false);
    }
  };

  const closeForm = () => {
    locationRequestRef.current += 1;
    setDetectingLocation(false);
    setFormOpen(false);
  };

  const deactivate = async (classId) => {
    if (!activeCollegeId || saving) return;
    setSaving(true);
    setError("");
    try {
      await deactivateClass(classId, activeCollegeId);
      await loadClasses();
    } catch (requestError) {
      setError(requestMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="classes-page">
      <div className="classes-container">
        <header className="classes-header">
          <div>
            <div className="classes-eyebrow">COLLEGE ACADEMIC STRUCTURE</div>
            <h1>Classes</h1>
            <p>Classes for the selected College. Historical records are retained when a Class is deactivated.</p>
          </div>
          {canManage && <button type="button" onClick={openCreate}>Add Class</button>}
          <button className="classes-refresh" type="button" onClick={loadClasses} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </header>

        {error && <div className="classes-error" role="alert">{error}</div>}

        {formOpen && canManage && (
          <section className="classes-card" aria-labelledby="class-form-title">
            <div className="classes-card-header"><div><div className="classes-card-kicker">COLLEGE ADMIN</div><h2 id="class-form-title">{editingClassId == null ? "Add Class" : "Edit Class"}</h2></div><button type="button" className="classes-refresh" disabled={saving} onClick={closeForm}>Cancel</button></div>
            {formError && <div className="classes-error" role="alert">{formError}</div>}
            <form className="class-edit-grid" onSubmit={saveClass}>
              <label>Class name<input required minLength={2} maxLength={100} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
              <label>Section<input maxLength={50} value={form.section} onChange={(event) => setForm((current) => ({ ...current, section: event.target.value }))} /></label>
              <label>Department<input maxLength={100} value={form.department} onChange={(event) => setForm((current) => ({ ...current, department: event.target.value }))} /></label>
              <label>Semester<input type="number" min="1" max="24" value={form.semester} onChange={(event) => setForm((current) => ({ ...current, semester: event.target.value }))} /></label>
              <label>Academic year<input maxLength={20} value={form.academic_year} onChange={(event) => setForm((current) => ({ ...current, academic_year: event.target.value }))} /></label>
              <div className="class-place-search">
                <label htmlFor="class-location-search">Search building or address</label>
                <input
                  id="class-location-search"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={placeResults.length > 0}
                  aria-controls="class-location-results"
                  autoComplete="off"
                  maxLength={200}
                  value={locationQuery}
                  placeholder="Building, institution, street, city…"
                  onChange={(event) => {
                    const value = event.target.value;
                    setLocationQuery(value);
                    setSelectedPlace(null);
                    setLocationSearchEnabled(true);
                    updateManualLocation({
                      location_name: "",
                      latitude: "",
                      longitude: "",
                    });
                  }}
                />
                {placeLoading && <span className="class-place-status" role="status">Searching locations…</span>}
                {placeError && <span className="class-place-error" role="alert">{placeError}</span>}
                {!placeLoading && !placeError && locationSearchEnabled && locationQuery.trim().length >= 3 && !selectedPlace && placeResults.length === 0
                  && <span className="class-place-status" role="status">No Google Maps results for this query. You can place the pin manually on the map.</span>}
                {placeResults.length > 0 && <ul className="class-place-results" id="class-location-results" role="listbox" aria-label="Location search results">
                  {placeResults.map((place, index) => (
                    <li key={`${place.id}:${index}`} role="option" aria-selected="false">
                      <button type="button" onClick={() => selectPlace(place)} disabled={placeLoading}>
                        <strong>{place.name}</strong>
                        <span>{place.address}</span>
                        <small>{place.likelyEstablishment ? "Establishment result — verify the classroom pin" : "Place/address result — verify or move the classroom pin"} · {place.placeType}</small>
                      </button>
                    </li>
                  ))}
                </ul>}
                <span className="class-place-attribution">Powered by Google Maps. Place points can identify an entrance or campus area, not an exact classroom; verify the pin.</span>
              </div>
              {selectedPlace && <div className="class-place-warning approximate" role="status">
                <strong>{selectedPlace.name}</strong>
                <span>{selectedPlace.address || "Google did not return a formatted address for this place."}</span>
                <span>Google returned this place point, which may be an entrance or campus point. Move the pin to the classroom building and confirm its location.</span>
              </div>}
              <div className="class-location-detect">
                <button type="button" onClick={detectLocation} disabled={detectingLocation || saving} aria-busy={detectingLocation}>
                  {detectingLocation ? "Detecting location..." : "Detect My Location"}
                </button>
                <span>Uses a fresh browser location to suggest the pin. Verify the classroom location on the map.</span>
              </div>
              {locationError && <div className="classes-error class-location-error" role="alert">{locationError}</div>}
              {gpsAccuracy != null && <div className="class-location-accuracy" role="status">
                <strong>Device-reported GPS accuracy: ±{gpsAccuracy.toFixed(1)} m</strong>
                <span>This is an estimate, not the classroom geofence radius or an attendance acceptance rule. Verify the pin before confirming.</span>
              </div>}
              <label>Latitude<input type="number" min="-90" max="90" step="any" value={form.latitude} onChange={(event) => updateManualLocation({ latitude: event.target.value })} /></label>
              <label>Longitude<input type="number" min="-180" max="180" step="any" value={form.longitude} onChange={(event) => updateManualLocation({ longitude: event.target.value })} /></label>
              <label>Geofence radius (m)<input type="number" min="10" max="5000" value={form.radius_m} onChange={(event) => setForm((current) => ({ ...current, radius_m: event.target.value }))} /></label>
              <div className="class-location-editor" aria-label="Classroom location selection">
                <p>Use the map to select the authoritative classroom pin. Confirm it represents the classroom before saving.</p>
                {googleMapState.status === "error" && <div className="class-google-map-fallback" role="status">
                  Google Maps is unavailable. Place search cannot be used, but manual pin selection is available on the OpenStreetMap fallback below.
                </div>}
                {googleMapState.status === "error" ? <LocationMap
                  latitude={form.latitude}
                  longitude={form.longitude}
                  radiusM={form.radius_m}
                  locationName={form.location_name || form.name || "Classroom"}
                  focusZoom={selectedPlace ? 18 : 16}
                  interactive
                  onLocationSelect={({ latitude, longitude }) => updateManualLocation({ latitude: String(latitude), longitude: String(longitude) })}
                /> : <GoogleClassroomMap
                  latitude={form.latitude}
                  longitude={form.longitude}
                  radiusM={form.radius_m}
                  locationName={form.location_name || form.name || "Classroom"}
                  viewport={mapViewport}
                  interactive
                  onMapState={handleGoogleMapState}
                  onLocationSelect={({ latitude, longitude }) => updateManualLocation({ latitude: String(latitude), longitude: String(longitude) })}
                />}
                <label className="class-location-confirm">
                  <input type="checkbox" checked={locationConfirmed} onChange={(event) => { setLocationConfirmed(event.target.checked); setFormError(""); }} />
                  <span>I confirm this pin represents the classroom location.</span>
                </label>
                {!locationConfirmed && <p className="class-location-confirm-hint">Confirm the pin after GPS detection, manual entry, map selection, or marker adjustment.</p>}
                <p className="class-location-review" role="status">
                  Selected classroom coordinates: {form.latitude !== "" && form.longitude !== ""
                    ? `${Number(form.latitude).toFixed(7)}, ${Number(form.longitude).toFixed(7)}`
                    : "not configured"}. Radius remains {Number(form.radius_m) || 100} m.
                </p>
              </div>
              <button type="submit" disabled={saving || !activeCollegeId}>{saving ? "Saving…" : "Save Class"}</button>
            </form>
          </section>
        )}

        <section className="classes-card">
          <div className="classes-card-header">
            <div>
              <div className="classes-card-kicker">DIRECTORY</div>
              <h2>Registered Classes</h2>
              <p>{visibleClasses.length} records</p>
            </div>
            <input aria-label="Search classes" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Classes…" />
          </div>
          {loading ? <div className="classes-empty" role="status">Loading Classes…</div> : (
            <div className="classes-table-wrap">
              <table className="classes-table">
                <thead><tr><th>Class</th><th>Section</th><th>Department</th><th>Semester</th><th>Academic year</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {visibleClasses.map((item) => (
                    <tr key={item.id}>
                      <td><strong>{item.name || `Class #${item.id}`}</strong></td>
                      <td>{item.section || "—"}</td>
                      <td>{item.department || "—"}</td>
                      <td>{item.semester ?? "—"}</td>
                      <td>{item.academic_year || "—"}</td>
                      <td><span className={`class-status ${item.is_active ? "active" : "inactive"}`}>{item.is_active ? "Active" : "Inactive"}</span></td>
                      <td><button type="button" onClick={() => showClass(item.id)} disabled={detailLoading && selectedClassId === item.id}>View</button>{canManage && <><button type="button" onClick={() => openEdit(item)} disabled={saving}>Edit</button>{item.is_active && <button type="button" onClick={() => deactivate(item.id)} disabled={saving}>Deactivate</button>}</>}</td>
                    </tr>
                  ))}
                  {!loading && !error && visibleClasses.length === 0 && (
                    <tr><td className="classes-empty" colSpan={7}>No Classes found for this College.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {selectedClassId != null && (
          <section className="classes-card" aria-labelledby="class-detail-heading" aria-live="polite">
            <div className="classes-card-header">
              <div><div className="classes-card-kicker">CLASS DETAILS</div><h2 id="class-detail-heading">Details</h2></div>
              <button type="button" className="classes-refresh" onClick={() => { setSelectedClassId(null); setClassDetail(null); setDetailError(""); detailGuard.current.invalidate(); }}>Close</button>
            </div>
            {detailLoading && <div className="classes-empty" role="status">Loading Class details…</div>}
            {detailError && <div className="classes-error" role="alert">{detailError}</div>}
            {classDetail && (
              <dl className="class-detail-grid">
                <div><dt>Name</dt><dd>{classDetail.name}</dd></div>
                <div><dt>Section</dt><dd>{classDetail.section || "—"}</dd></div>
                <div><dt>Department</dt><dd>{classDetail.department || "—"}</dd></div>
                <div><dt>Semester</dt><dd>{classDetail.semester ?? "—"}</dd></div>
                <div><dt>Academic year</dt><dd>{classDetail.academic_year || "—"}</dd></div>
                <div><dt>Location</dt><dd>{classDetail.location_name || "—"}</dd></div>
                <div><dt>Classroom coordinates</dt><dd>{classDetail.latitude != null && classDetail.longitude != null
                  ? `${Number(classDetail.latitude).toFixed(7)}, ${Number(classDetail.longitude).toFixed(7)}`
                  : "Not configured"}</dd></div>
                <div><dt>Geofence radius</dt><dd>{Number(classDetail.radius_m ?? 100)} m</dd></div>
                <div><dt>Status</dt><dd>{classDetail.is_active ? "Active" : "Inactive"}</dd></div>
              </dl>
            )}
            {classDetail && <LocationMap
              latitude={classDetail.latitude}
              longitude={classDetail.longitude}
              radiusM={classDetail.radius_m}
              locationName={classDetail.location_name || classDetail.name || "Classroom"}
              className="class-detail-map"
            />}
          </section>
        )}
      </div>
    </main>
  );
}
