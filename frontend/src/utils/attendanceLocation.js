const DEFAULT_OPTIONS = Object.freeze({
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 0,
});
const MAX_FIX_AGE_MS = 15000;
const MAX_FUTURE_FIX_SKEW_MS = 5000;
const STABLE_FIX_CAPTURE_TIMEOUT_MS = 30000;

export function haversineDistanceMeters(latitudeA, longitudeA, latitudeB, longitudeB) {
  const values = [latitudeA, longitudeA, latitudeB, longitudeB].map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  const [latA, lonA, latB, lonB] = values;
  if (Math.abs(latA) > 90 || Math.abs(latB) > 90 || Math.abs(lonA) > 180 || Math.abs(lonB) > 180) return null;
  const earthRadiusM = 6371000;
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const latitude1 = toRadians(latA);
  const latitude2 = toRadians(latB);
  const latitudeDelta = toRadians(latB - latA);
  const longitudeDelta = toRadians(lonB - lonA);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceBetweenFixesMeters(first, second) {
  return haversineDistanceMeters(first.latitude, first.longitude, second.latitude, second.longitude);
}

export function validateFreshAttendanceFix(fix, accuracyLimitM, now = Date.now()) {
  const latitude = Number(fix?.latitude);
  const longitude = Number(fix?.longitude);
  const accuracy = Number(fix?.accuracy);
  const capturedAt = Number(fix?.capturedAt);
  const limit = Number(accuracyLimitM);
  if (
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    || !Number.isFinite(accuracy) || accuracy < 0
    || !Number.isInteger(limit) || limit < 1 || limit > 150
  ) {
    throw Object.assign(new Error("The captured location or College GPS accuracy policy is invalid. Retry location capture."), { code: "LOCATION_INVALID" });
  }
  const age = Number(now) - capturedAt;
  if (!Number.isFinite(capturedAt) || age > MAX_FIX_AGE_MS || age < -MAX_FUTURE_FIX_SKEW_MS) {
    throw Object.assign(new Error("The captured location is no longer fresh. Retry location capture before starting the lecture."), { code: "LOCATION_STALE" });
  }
  if (accuracy > limit) {
    throw Object.assign(new Error(`Your device reported location accuracy of ${accuracy.toFixed(1)} m. Your College requires ${limit} m accuracy or better. Retry with a more precise location.`), { code: "LOCATION_IMPRECISE", accuracy });
  }
  return { latitude, longitude, accuracy };
}

export function getFreshAttendanceLocation(geolocation = globalThis.navigator?.geolocation, accuracyLimitM = 100, options = {}) {
  const limit = Number(accuracyLimitM);
  const requireStableFix = options?.requireStableFix === true;
  const captureTimeoutMs = requireStableFix ? STABLE_FIX_CAPTURE_TIMEOUT_MS : DEFAULT_OPTIONS.timeout;
  if (!Number.isInteger(limit) || limit < 1 || limit > 150) {
    return Promise.reject(Object.assign(
      new Error("The College GPS accuracy setting is unavailable or invalid. Contact your College Admin."),
      { code: "LOCATION_POLICY_UNAVAILABLE" },
    ));
  }
  const canWatch = typeof geolocation?.watchPosition === "function";
  const canGetCurrent = typeof geolocation?.getCurrentPosition === "function";
  if (!canWatch && !canGetCurrent) {
    return Promise.reject(Object.assign(
      new Error("This browser does not provide location access. Use a supported browser or device."),
      { code: "LOCATION_UNAVAILABLE" },
    ));
  }
  if (requireStableFix && !canWatch) {
    return Promise.reject(Object.assign(
      new Error("This browser cannot provide consecutive location readings needed to verify a stable Teacher position. Use a supported browser or GPS-capable device."),
      { code: "LOCATION_STABILITY_UNAVAILABLE" },
    ));
  }
  if (requireStableFix && typeof geolocation?.clearWatch !== "function") {
    return Promise.reject(Object.assign(
      new Error("This browser cannot safely stop location capture. Use a supported browser or GPS-capable device."),
      { code: "LOCATION_CLEANUP_UNAVAILABLE" },
    ));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let watchId = null;
    let best = null;
    let previousAcceptedFix = null;
    let sawStaleFix = false;
    let sawInconsistentFixes = false;
    let sawProviderTimeout = false;
    let sawPositionUnavailable = false;
    const clearWatch = () => {
      if (watchId !== null && typeof geolocation.clearWatch === "function") {
        geolocation.clearWatch(watchId);
        watchId = null;
      }
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timerId);
      try {
        clearWatch();
      } catch {
        reject(Object.assign(new Error("Location capture could not be cleaned up safely. Please retry."), { code: "LOCATION_UNAVAILABLE" }));
        return;
      }
      callback(value);
    };
    const impreciseError = (accuracy) => Object.assign(
      new Error(`Your device reported location accuracy of ${accuracy.toFixed(1)} m. Your College requires ${limit} m accuracy or better. Try again with Location enabled or use a supported mobile device.`),
      { code: "LOCATION_IMPRECISE", accuracy },
    );
    const staleError = () => Object.assign(
      new Error("The device returned a stale location. Keep Location enabled and retry to request a fresh position."),
      { code: "LOCATION_STALE" },
    );
    const inconsistentError = () => Object.assign(
      new Error("Consecutive device location readings are inconsistent. Windows or browser location may be estimating from network data. Enable Windows Location, allow browser location access, then retry near a window or on a supported GPS device."),
      { code: "LOCATION_INCONSISTENT" },
    );
    const noFixError = () => Object.assign(
      new Error(requireStableFix
        ? `${sawProviderTimeout ? "The browser timed out while searching; no fresh device location was received" : "No fresh device location was received"} within ${Math.round(captureTimeoutMs / 1000)} seconds. Check Windows Location and browser permission, move near a window or use a GPS-capable device, then retry.`
        : "Location capture timed out. Move to an area with a clearer GPS signal and retry."),
      { code: "LOCATION_TIMEOUT" },
    );
    const stabilityTimeoutError = () => Object.assign(
      new Error(`The device supplied one acceptable fix (${previousAcceptedFix.accuracy.toFixed(1)} m accuracy) but no second consistent reading within 30 seconds. Keep Location enabled and retry; if it repeats, use a GPS-capable device.`),
      { code: "LOCATION_STABILITY_TIMEOUT", accuracy: previousAcceptedFix.accuracy },
    );
    const onPosition = (position) => {
        if (settled) return;
        if (requireStableFix) {
          const timestamp = Number(position?.timestamp);
          const age = Date.now() - timestamp;
          if (
            !Number.isFinite(timestamp)
            || age > MAX_FIX_AGE_MS
            || age < -MAX_FUTURE_FIX_SKEW_MS
          ) {
            sawStaleFix = true;
            previousAcceptedFix = null;
            return;
          }
          sawStaleFix = false;
        }
        const coords = position?.coords;
        const latitude = Number(coords?.latitude);
        const longitude = Number(coords?.longitude);
        if (
          coords?.latitude == null
          || coords?.longitude == null
          || !Number.isFinite(latitude)
          || !Number.isFinite(longitude)
          || latitude < -90
          || latitude > 90
          || longitude < -180
          || longitude > 180
        ) {
          finish(reject, Object.assign(new Error("The device returned invalid coordinates. Check device Location settings and retry."), { code: "LOCATION_INVALID" }));
          return;
        }
        const accuracy = Number(coords?.accuracy);
        if (!Number.isFinite(accuracy) || accuracy < 0) {
          finish(reject, Object.assign(new Error("The device returned an invalid location accuracy. Please retry."), { code: "LOCATION_INVALID" }));
          return;
        }
        if (!best || accuracy < best.accuracy) {
          best = { latitude, longitude, accuracy };
        }
        if (accuracy > limit) {
          // Keep watching within the bounded capture window; a later fresh fix
          // may be more precise. Never alter or submit this measured value.
          previousAcceptedFix = null;
          if (!canWatch) finish(reject, impreciseError(accuracy));
          return;
        }

        const currentFix = {
          latitude,
          longitude,
          accuracy,
          capturedAt: Number(position?.timestamp),
        };
        if (requireStableFix && canWatch) {
          if (!previousAcceptedFix) {
            previousAcceptedFix = currentFix;
            return;
          }
          const separationM = distanceBetweenFixesMeters(previousAcceptedFix, currentFix);
          // The two provider-reported uncertainty radii should at least overlap.
          // A larger jump is treated as inconsistent, never averaged or rewritten.
          if (separationM > previousAcceptedFix.accuracy + currentFix.accuracy) {
            sawInconsistentFixes = true;
            previousAcceptedFix = currentFix;
            return;
          }
        }
        finish(resolve, currentFix);
    };
    const onError = (error) => {
        const code = error?.code === 1
          ? "LOCATION_PERMISSION_DENIED"
          : error?.code === 3
            ? "LOCATION_TIMEOUT"
            : "LOCATION_UNAVAILABLE";
        if (requireStableFix && code === "LOCATION_TIMEOUT") {
          sawProviderTimeout = true;
          return;
        }
        if (requireStableFix && code === "LOCATION_UNAVAILABLE") {
          sawPositionUnavailable = true;
          return;
        }
        if (code !== "LOCATION_PERMISSION_DENIED" && best?.accuracy > limit) {
          finish(reject, impreciseError(best.accuracy));
          return;
        }
        if (code !== "LOCATION_PERMISSION_DENIED" && sawInconsistentFixes) {
          finish(reject, inconsistentError());
          return;
        }
        if (code !== "LOCATION_PERMISSION_DENIED" && sawStaleFix) {
          finish(reject, staleError());
          return;
        }
        const message = code === "LOCATION_PERMISSION_DENIED"
          ? "Location permission was denied. Enable location access for AttendX in your browser settings, then retry."
          : code === "LOCATION_TIMEOUT"
            ? "The browser timed out before providing a fresh location. Enable Windows and browser Location, move near a window or use a GPS-capable device, then retry."
            : "Your browser could not determine the current location. Check device Location settings and retry.";
        finish(reject, Object.assign(new Error(message), { code }));
    };
    const timerId = globalThis.setTimeout(() => {
      if (best?.accuracy > limit) finish(reject, impreciseError(best.accuracy));
      else if (sawInconsistentFixes) finish(reject, inconsistentError());
      else if (sawStaleFix) finish(reject, staleError());
      else if (requireStableFix && previousAcceptedFix) finish(reject, stabilityTimeoutError());
      else if (requireStableFix && sawPositionUnavailable) finish(reject, Object.assign(
        new Error("Windows/browser location reported that the current position is unavailable. Check Windows Location and browser permission, then retry or use a GPS-capable device."),
        { code: "LOCATION_UNAVAILABLE" },
      ));
      else finish(reject, noFixError());
    }, captureTimeoutMs);
    if (canWatch) {
      try {
        watchId = geolocation.watchPosition(onPosition, onError, DEFAULT_OPTIONS);
        if (settled) clearWatch();
      } catch (error) {
        finish(reject, Object.assign(new Error("Your browser could not start location capture. Check device Location settings and retry."), { code: "LOCATION_UNAVAILABLE", cause: error }));
      }
    } else {
      try {
        geolocation.getCurrentPosition(onPosition, onError, DEFAULT_OPTIONS);
      } catch (error) {
        finish(reject, Object.assign(
          new Error("Your browser could not start location capture. Check device Location settings and retry."),
          { code: "LOCATION_UNAVAILABLE", cause: error },
        ));
      }
    }
  });
}
