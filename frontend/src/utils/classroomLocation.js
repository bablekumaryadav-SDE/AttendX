export function isValidCoordinatePair(latitude, longitude) {
  if (latitude === "" || latitude == null || longitude === "" || longitude == null) return false;
  if ((typeof latitude === "string" && !latitude.trim()) || (typeof longitude === "string" && !longitude.trim())) return false;
  const lat = Number(latitude);
  const lon = Number(longitude);
  return Number.isFinite(lat) && lat >= -90 && lat <= 90
    && Number.isFinite(lon) && lon >= -180 && lon <= 180;
}

export function detectClassroomLocation(geolocation = globalThis.navigator?.geolocation) {
  if (!geolocation || typeof geolocation.getCurrentPosition !== "function") {
    return Promise.reject(Object.assign(new Error("This browser does not support location detection."), { code: "GEOLOCATION_UNSUPPORTED" }));
  }

  return new Promise((resolve, reject) => {
    try {
      geolocation.getCurrentPosition((position) => {
        const latitude = Number(position?.coords?.latitude);
        const longitude = Number(position?.coords?.longitude);
        const accuracy = Number(position?.coords?.accuracy);
        if (!isValidCoordinatePair(latitude, longitude) || !Number.isFinite(accuracy) || accuracy < 0) {
          reject(Object.assign(new Error("The browser returned invalid location coordinates or accuracy."), { code: "GEOLOCATION_INVALID" }));
          return;
        }
        resolve({ latitude, longitude, accuracy });
      }, (error) => {
        const code = error?.code === 1
          ? "GEOLOCATION_PERMISSION_DENIED"
          : error?.code === 2
            ? "GEOLOCATION_UNAVAILABLE"
            : error?.code === 3
              ? "GEOLOCATION_TIMEOUT"
              : "GEOLOCATION_FAILED";
        reject(Object.assign(new Error("Unable to detect the classroom location."), { code }));
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    } catch {
      reject(Object.assign(new Error("Unable to start browser location detection."), { code: "GEOLOCATION_FAILED" }));
    }
  });
}
