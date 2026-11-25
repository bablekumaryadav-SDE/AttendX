import { stopCameraStream } from "./cameraAccess.js";

export async function acquireCameraStreamSafely({ getUserMedia, constraints, isCurrent }) {
  const stream = await getUserMedia(constraints);
  if (!isCurrent()) {
    stopCameraStream(stream);
    return null;
  }
  return stream;
}

