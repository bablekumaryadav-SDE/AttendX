import React, { useState } from "react";
import FaceCamera from "../../components/FaceCamera";
import "./AttendanceFaceScanner.css";

function AttendanceFaceScanner({
  sessionId,
  onScanCaptured,
}) {
  const [captured, setCaptured] = useState(false);
  const [scanMessage, setScanMessage] = useState("");

  const handleCapture = async (file) => {
    setCaptured(false);
    setScanMessage("");

    /*
     * IMPORTANT:
     * At this stage this is a real camera capture.
     * We do NOT claim that the student is verified.
     *
     * Actual face recognition must happen in the backend
     * before attendance is marked.
     */

    if (!sessionId) {
      setScanMessage(
        "Start an attendance session before scanning a student."
      );
      return;
    }

    setCaptured(true);

    if (onScanCaptured) {
      await onScanCaptured({
        file,
        sessionId,
      });
    }

    setScanMessage(
      "Face image captured. Waiting for biometric verification."
    );
  };

  return (
    <div className="attendance-face-scanner">
      <FaceCamera
        mode="attendance"
        title="Face Attendance Scanner"
        subtitle="Position one student directly in front of the camera. Attendance is marked only after backend biometric verification."
        captureLabel="Scan Face"
        onCapture={handleCapture}
      />

      <div className="attendance-scan-info">
        <div className="attendance-scan-info-icon">
          {captured ? "✓" : "◎"}
        </div>

        <div>
          <strong>
            {captured
              ? "Face captured"
              : "Biometric scanner ready"}
          </strong>

          <span>
            {scanMessage ||
              "The camera capture will be sent to the biometric verification workflow."}
          </span>
        </div>
      </div>

      <div className="attendance-scan-warning">
        <span>i</span>

        <p>
          A green frame means the camera is ready for
          capture. It does not by itself mean that the
          student's identity has been verified.
        </p>
      </div>
    </div>
  );
}

export default AttendanceFaceScanner;