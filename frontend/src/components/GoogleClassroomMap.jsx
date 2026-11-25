import React, { useEffect, useRef, useState } from "react";
import { isValidCoordinatePair } from "../utils/classroomLocation";
import { loadGoogleMaps, navigateGoogleMapToLocation, syncGoogleMarker } from "../utils/classroomGeocoding";
import "./GoogleClassroomMap.css";

const DEFAULT_CENTER = { lat: 20.5937, lng: 78.9629 };

function coordinate(position, name) {
  const value = position?.[name];
  return typeof value === "function" ? value() : value;
}

export default function GoogleClassroomMap({
  latitude,
  longitude,
  radiusM = 100,
  locationName = "Classroom",
  interactive = false,
  viewport = null,
  onLocationSelect,
  onMapState,
  className = "",
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const markerLibraryRef = useRef(null);
  const circleRef = useRef(null);
  const listenersRef = useRef([]);
  const selectRef = useRef(onLocationSelect);
  const interactiveRef = useRef(interactive);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const hasCoordinates = isValidCoordinatePair(latitude, longitude);
  const effectiveRadius = Number(radiusM);
  const hasValidRadius = radiusM !== "" && Number.isFinite(effectiveRadius) && effectiveRadius > 0;

  useEffect(() => {
    selectRef.current = onLocationSelect;
    interactiveRef.current = interactive;
  }, [onLocationSelect, interactive]);

  useEffect(() => {
    let cancelled = false;
    const onAuthError = () => {
      const message = "Google Maps rejected the API key or website restriction. Check enabled APIs, billing, and allowed referrers. Manual pin selection remains available.";
      setMapError(message);
      onMapState?.({ status: "error", message });
    };
    globalThis.window?.addEventListener?.("attendx:google-maps-auth-error", onAuthError);
    onMapState?.({ status: "loading", message: "Loading Google Maps…" });
    const initialize = async () => {
      try {
        const maps = await loadGoogleMaps();
        const [mapLibrary, marker] = await Promise.all([
          maps.importLibrary("maps"),
          maps.importLibrary("marker"),
        ]);
        if (cancelled || !containerRef.current) return;
        markerLibraryRef.current = marker;
        const initialCenter = hasCoordinates
          ? { lat: Number(latitude), lng: Number(longitude) }
          : DEFAULT_CENTER;
        const map = new mapLibrary.Map(containerRef.current, {
          center: initialCenter,
          zoom: hasCoordinates ? 16 : 5,
          mapId: import.meta.env?.VITE_GOOGLE_MAP_ID || "DEMO_MAP_ID",
          mapTypeControl: true,
          mapTypeControlOptions: { mapTypeIds: ["roadmap", "satellite"] },
          zoomControl: true,
          streetViewControl: false,
          fullscreenControl: true,
          maxZoom: 21,
          gestureHandling: "cooperative",
        });
        mapRef.current = map;
        const mapClick = map.addListener("click", (event) => {
          if (!interactiveRef.current || !event.latLng) return;
          selectRef.current?.({
            latitude: Number(event.latLng.lat().toFixed(7)),
            longitude: Number(event.latLng.lng().toFixed(7)),
          });
        });
        listenersRef.current.push(mapClick);
        setReady(true);
        onMapState?.({ status: "ready", message: "Google Maps loaded." });
      } catch (error) {
        if (cancelled) return;
        const message = error?.message || "Google Maps could not load. Manual pin selection remains available.";
        setMapError(message);
        onMapState?.({ status: "error", message });
      }
    };
    void initialize();
    return () => {
      cancelled = true;
      globalThis.window?.removeEventListener?.("attendx:google-maps-auth-error", onAuthError);
      listenersRef.current.forEach((listener) => listener.remove?.());
      listenersRef.current = [];
      if (markerRef.current) markerRef.current.map = null;
      if (circleRef.current) circleRef.current.setMap(null);
      markerRef.current = null;
      circleRef.current = null;
      mapRef.current = null;
      markerLibraryRef.current = null;
    };
    // Google Maps is initialized once for this component instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || mapError) return;
    if (!hasCoordinates) {
      if (markerRef.current) markerRef.current.map = null;
      if (circleRef.current) circleRef.current.setMap(null);
      markerRef.current = null;
      circleRef.current = null;
      return;
    }
    const point = { lat: Number(latitude), lng: Number(longitude) };
    if (!markerRef.current) {
      const AdvancedMarkerElement = markerLibraryRef.current?.AdvancedMarkerElement;
      if (!AdvancedMarkerElement) return;
      const marker = new AdvancedMarkerElement({
        map,
        position: point,
        title: locationName || "Classroom location",
        gmpDraggable: interactiveRef.current,
      });
      const onDragEnd = () => {
        if (!interactiveRef.current || !marker.position) return;
        selectRef.current?.({
          latitude: Number(Number(coordinate(marker.position, "lat")).toFixed(7)),
          longitude: Number(Number(coordinate(marker.position, "lng")).toFixed(7)),
        });
      };
      marker.addEventListener("gmp-dragend", onDragEnd);
      listenersRef.current.push({ remove: () => marker.removeEventListener("gmp-dragend", onDragEnd) });
      markerRef.current = marker;
    } else {
      syncGoogleMarker(markerRef.current, map, {
        latitude,
        longitude,
        title: locationName,
        draggable: interactiveRef.current,
      });
    }
    if (!hasValidRadius) {
      if (circleRef.current) circleRef.current.setMap(null);
      circleRef.current = null;
    } else if (!circleRef.current) {
      const maps = globalThis.window?.google?.maps;
      if (!maps?.Circle) return;
      circleRef.current = new maps.Circle({
        map,
        center: point,
        radius: effectiveRadius,
        strokeColor: "#4f46e5",
        strokeOpacity: 0.9,
        strokeWeight: 2,
        fillColor: "#818cf8",
        fillOpacity: 0.16,
        clickable: false,
      });
    } else {
      circleRef.current.setCenter(point);
      circleRef.current.setRadius(effectiveRadius);
      circleRef.current.setMap(map);
    }

    const camera = navigateGoogleMapToLocation(map, { latitude, longitude, viewport });
    if (camera.usedViewport) {
      globalThis.window?.google?.maps?.event?.addListenerOnce?.(map, "idle", () => {
        if (map.getZoom?.() > 21) map.setZoom(21);
      });
    }
  }, [ready, mapError, latitude, longitude, radiusM, locationName, hasCoordinates, hasValidRadius, effectiveRadius, viewport]);

  return (
    <div className={`google-classroom-map-shell ${className}`}>
      <div ref={containerRef} className="google-classroom-map" role="application" aria-label={`${locationName || "Classroom"} Google Map with classroom geofence`} />
      {mapError && <div className="google-classroom-map-error" role="alert">{mapError}</div>}
      {!mapError && !ready && <div className="google-classroom-map-loading" role="status">Loading Google Maps…</div>}
      {ready && hasCoordinates && hasValidRadius && <p className="google-classroom-map-hint">Classroom geofence radius: {radiusM} m. Verify the pin marks the classroom; a Google place point may mark an entrance or campus area.</p>}
      {ready && !hasCoordinates && <p className="google-classroom-map-hint">Click the map to choose a classroom point. The map does not identify an exact room location.</p>}
      {ready && hasCoordinates && !hasValidRadius && <p className="google-classroom-map-error" role="alert">Enter a valid positive geofence radius.</p>}
    </div>
  );
}
