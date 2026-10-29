import React, { useCallback, useEffect, useRef, useState } from "react";
import "./FaceCamera.css";

function FaceCamera({
  mode = "registration",
  onCapture,
  disabled = false,
  title,
  subtitle,
  captureLabel,
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState("");

  const isAttendance = mode === "attendance";

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setActive(false);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const startCamera = async () => {
    if (disabled || starting || active) {
      return;
    }

    setError("");
    setStarting(true);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "Camera access is not available in this browser. Please use a modern browser."
      );
      setStarting(false);
      return;
    }

    try {
      stopCamera();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: {
            ideal: 1280,
          },
          height: {
            ideal: 720,
          },
          frameRate: {
            ideal: 30,
            max: 30,
          },
        },
        audio: false,
      });

      streamRef.current = stream;

      setActive(true);

      await new Promise((resolve) => {
        requestAnimationFrame(resolve);
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;

        try {
          await videoRef.current.play();
        } catch {
          // Browser may already have started playback.
        }
      }
    } catch (cameraError) {
      console.error("Camera error:", cameraError);

      let message =
        "Unable to access the camera. Please allow camera permission.";

      if (cameraError?.name === "NotAllowedError") {
        message =
          "Camera permission was denied. Allow camera access and try again.";
      } else if (cameraError?.name === "NotFoundError") {
        message =
          "No camera was found on this device.";
      } else if (cameraError?.name === "NotReadableError") {
        message =
          "The camera is already being used by another application.";
      }

      setError(message);
      stopCamera();
    } finally {
      setStarting(false);
    }
  };

  const captureFrame = async () => {
    if (
      disabled ||
      capturing ||
      !videoRef.current ||
      !canvasRef.current
    ) {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video.videoWidth || !video.videoHeight) {
      setError("Camera is not ready yet. Please wait a moment.");
      return;
    }

    setCapturing(true);
    setError("");

    try {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const context = canvas.getContext("2d", {
        alpha: false,
      });

      if (!context) {
        throw new Error("Unable to create image canvas.");
      }

      /*
       * Mirror the saved image so it looks natural to the user.
       * The visual green detection frame is NOT part of this image.
       */
      context.save();
      context.translate(canvas.width, 0);
      context.scale(-1, 1);

      context.drawImage(
        video,
        0,
        0,
        canvas.width,
        canvas.height
      );

      context.restore();

      const blob = await new Promise((resolve) => {
        canvas.toBlob(
          resolve,
          "image/jpeg",
          0.92
        );
      });

      if (!blob) {
        throw new Error("Unable to create captured image.");
      }

      const timestamp = Date.now();

      const file = new File(
        [blob],
        `attendx-face-${timestamp}.jpg`,
        {
          type: "image/jpeg",
          lastModified: timestamp,
        }
      );

      if (onCapture) {
        await onCapture(file);
      }
    } catch (captureError) {
      console.error("Face capture error:", captureError);

      setError(
        captureError?.message ||
          "Unable to capture the face image. Please try again."
      );
    } finally {
      setCapturing(false);
    }
  };

  const handleRetake = () => {
    setError("");

    if (!active) {
      startCamera();
    }
  };

  return (
    <div className="attendx-face-camera">
      <div className="face-camera-header">
        <div>
          <div className="face-camera-eyebrow">
            ATTENDX BIOMETRIC
          </div>

          <h3>
            {title ||
              (isAttendance
                ? "Face Attendance"
                : "Face Registration")}
          </h3>

          <p>
            {subtitle ||
              (isAttendance
                ? "Position your face inside the frame for attendance verification."
                : "Capture a clear front-facing photo for student face registration.")}
          </p>
        </div>

        <div
          className={`face-camera-status ${
            active ? "online" : ""
          }`}
        >
          <span className="status-dot" />
          {active ? "CAMERA LIVE" : "CAMERA READY"}
        </div>
      </div>

      <div className="face-camera-stage">
        {active ? (
          <>
            <video
              ref={videoRef}
              className="face-camera-video"
              muted
              autoPlay
              playsInline
            />

            <div className="face-camera-dark-overlay" />

            <div className="face-detection-area">
              <span className="face-corner top-left" />
              <span className="face-corner top-right" />
              <span className="face-corner bottom-left" />
              <span className="face-corner bottom-right" />

              <span className="face-node node-one" />
              <span className="face-node node-two" />
              <span className="face-node node-three" />
              <span className="face-node node-four" />

              <div className="face-scan-line" />
            </div>

            <div className="face-live-message">
              <span className="live-check">
                ✓
              </span>

              <span>
                {isAttendance
                  ? "POSITION FACE FOR SCAN"
                  : "POSITION FACE INSIDE FRAME"}
              </span>
            </div>

            <div className="face-camera-instruction">
              <strong>
                Look straight at the camera
              </strong>

              <small>
                Keep your face centered • Remove sunglasses • Good lighting
              </small>
            </div>
          </>
        ) : (
          <div className="face-camera-placeholder">
            <div className="placeholder-icon">
              ◉
            </div>

            <strong>
              {starting
                ? "Starting camera..."
                : "Camera ready"}
            </strong>

            <span>
              Start the camera and position the
              student's face inside the green frame.
            </span>
          </div>
        )}
      </div>

      <canvas
        ref={canvasRef}
        className="face-capture-canvas"
      />

      {error && (
        <div className="face-camera-error">
          <span>!</span>
          {error}
        </div>
      )}

      <div className="face-camera-actions">
        {!active ? (
          <button
            type="button"
            className="face-camera-primary"
            onClick={startCamera}
            disabled={disabled || starting}
          >
            {starting
              ? "Starting Camera..."
              : "Start Camera"}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="face-camera-primary"
              onClick={captureFrame}
              disabled={disabled || capturing}
            >
              {capturing
                ? "Capturing..."
                : captureLabel ||
                  (isAttendance
                    ? "Scan Face"
                    : "Capture Face")}
            </button>

            <button
              type="button"
              className="face-camera-secondary"
              onClick={handleRetake}
              disabled={disabled || capturing}
            >
              Restart Camera
            </button>
          </>
        )}

        {active && (
          <button
            type="button"
            className="face-camera-stop"
            onClick={stopCamera}
            disabled={disabled || capturing}
          >
            Stop
          </button>
        )}
      </div>
    </div>
  );
}

export default FaceCamera;