import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { isValidCoordinatePair } from "../utils/classroomLocation";
import "./LocationMap.css";

const DEFAULT_CENTER = [20.5937, 78.9629];

export default function LocationMap({
  latitude,
  longitude,
  radiusM = 100,
  locationName = "Classroom",
  interactive = false,
  onLocationSelect,
  className = "",
  focusZoom = 16,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const circleRef = useRef(null);
  const selectRef = useRef(onLocationSelect);
  const interactiveRef = useRef(interactive);
  const hasCoordinates = isValidCoordinatePair(latitude, longitude);
  const effectiveRadius = radiusM == null ? 100 : Number(radiusM);
  const hasValidRadius = radiusM !== "" && Number.isFinite(effectiveRadius) && effectiveRadius > 0;

  useEffect(() => {
    selectRef.current = onLocationSelect;
    interactiveRef.current = interactive;
  }, [onLocationSelect, interactive]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView(DEFAULT_CENTER, 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const onMapClick = (event) => {
      if (!interactiveRef.current) return;
      selectRef.current?.({
        latitude: Number(event.latlng.lat.toFixed(7)),
        longitude: Number(event.latlng.lng.toFixed(7)),
      });
    };
    map.on("click", onMapClick);
    mapRef.current = map;
    let frameId = null;
    const invalidateSize = () => map.invalidateSize({ pan: false });
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      frameId = window.requestAnimationFrame(invalidateSize);
    } else {
      invalidateSize();
    }
    const resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(invalidateSize)
      : null;
    resizeObserver?.observe(containerRef.current);
    return () => {
      if (frameId != null && typeof window !== "undefined") window.cancelAnimationFrame?.(frameId);
      resizeObserver?.disconnect();
      map.off("click", onMapClick);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
  }, []);

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker?.dragging) return;
    if (interactive) marker.dragging.enable();
    else marker.dragging.disable();
  }, [interactive, latitude, longitude]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!hasCoordinates) {
      if (markerRef.current) map.removeLayer(markerRef.current);
      if (circleRef.current) map.removeLayer(circleRef.current);
      markerRef.current = null;
      circleRef.current = null;
      return;
    }

    const point = [Number(latitude), Number(longitude)];
    if (!markerRef.current) {
      markerRef.current = L.marker(point, {
        draggable: interactiveRef.current,
        icon: L.divIcon({ className: "location-map-marker", html: "", iconSize: [22, 22], iconAnchor: [11, 11] }),
      }).addTo(map);
      markerRef.current.on("dragend", (event) => {
        if (!interactiveRef.current) return;
        const position = event.target.getLatLng();
        selectRef.current?.({
          latitude: Number(position.lat.toFixed(7)),
          longitude: Number(position.lng.toFixed(7)),
        });
      });
    } else markerRef.current.setLatLng(point);
    if (markerRef.current.dragging) {
      if (interactiveRef.current) markerRef.current.dragging.enable();
      else markerRef.current.dragging.disable();
    }
    markerRef.current.bindTooltip(locationName || "Classroom location");

    if (!hasValidRadius) {
      if (circleRef.current) map.removeLayer(circleRef.current);
      circleRef.current = null;
    } else if (!circleRef.current) {
      circleRef.current = L.circle(point, {
        radius: effectiveRadius,
        color: "#175cd3",
        weight: 2,
        fillColor: "#84caff",
        fillOpacity: 0.18,
      }).addTo(map);
    } else circleRef.current.setLatLng(point).setRadius(effectiveRadius);
    map.setView(point, focusZoom);
  }, [latitude, longitude, radiusM, locationName, hasCoordinates, hasValidRadius, focusZoom]);

  return (
    <div className={`location-map-shell ${className}`}>
      <div ref={containerRef} className="location-map" role="img" aria-label={`${locationName || "Classroom"} location map and ${radiusM} metre geofence`} />
      {!hasCoordinates && <span className="location-map-hint">{interactive ? "Click the map to choose the classroom location." : "Classroom coordinates are not configured."}</span>}
      {hasCoordinates && !hasValidRadius && <span className="location-map-hint" role="alert">Enter a valid positive geofence radius.</span>}
      {hasCoordinates && hasValidRadius && <span className="location-map-hint">Geofence boundary: {radiusM} m — map display is informational.</span>}
    </div>
  );
}
