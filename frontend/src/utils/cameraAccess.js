export function getCameraConstraints(facingMode = "user") {
  return {
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    },
    audio: false,
  };
}

export function canStartFaceCamera({
  studentId,
  consentAccepted,
  saving = false,
  faceSaving = false,
  cameraStarting = false,
}) {
  return Boolean(
    studentId &&
    consentAccepted &&
    !saving &&
    !faceSaving &&
    !cameraStarting
  );
}

export async function requestCameraStream({
  mediaDevices,
  secureContext,
  facingMode = "user",
}) {
  if (!secureContext) {
    const error = new Error("Camera access requires HTTPS or localhost.");
    error.code = "insecure-context";
    throw error;
  }

  if (typeof mediaDevices?.getUserMedia !== "function") {
    const error = new Error("This browser does not support camera access.");
    error.code = "unsupported-browser";
    throw error;
  }

  try {
    return await mediaDevices.getUserMedia(getCameraConstraints(facingMode));
  } catch (error) {
    if (error?.name !== "OverconstrainedError") {
      throw error;
    }

    // Retry with browser-selected resolution when the device cannot meet ideals.
    return mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facingMode } },
      audio: false,
    });
  }
}

export function getCameraErrorMessage(error) {
  if (error?.code === "insecure-context") {
    return "Camera access requires a secure page. Open AttendX over HTTPS or localhost.";
  }
  if (error?.code === "unsupported-browser") {
    return "This browser does not support camera access. Use a current browser over HTTPS or localhost.";
  }

  switch (error?.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "Camera permission was denied or blocked. Allow camera access for AttendX in your browser settings, then retry.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera was found. Connect or enable a camera, then retry.";
    case "NotReadableError":
    case "TrackStartError":
      return "The camera could not start. It may be in use by another application; close that application and retry.";
    case "OverconstrainedError":
      return "The camera cannot provide a supported video mode. Try another camera or browser.";
    default:
      return "Unable to start the camera. Check browser permission and camera availability, then retry.";
  }
}

export function stopCameraStream(stream) {
  if (!stream || typeof stream.getTracks !== "function") return;

  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Continue stopping the other tracks if one device track has already ended.
    }
  }
}
