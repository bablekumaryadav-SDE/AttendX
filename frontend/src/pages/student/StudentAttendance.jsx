import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import jsQR from "jsqr";
import { useLocation as useRouterLocation } from "react-router-dom";

import {
  getMyFaceStatus,
  registerMyFace,
  getActiveStudentSessions,
  getMyAttendance,
  submitStudentFaceAttendance,
  submitStudentQrAttendance,
} from "../../services/attendance";

import "./StudentAttendance.css";
import { getApiErrorMessage } from "../../utils/errors";


function getErrorMessage(error, fallback) {
  return getApiErrorMessage(error, fallback);
}


function formatDate(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString(
    undefined,
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }
  );
}


function formatTime(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleTimeString(
    undefined,
    {
      hour: "2-digit",
      minute: "2-digit",
    }
  );
}


export default function StudentAttendance() {
  const routeLocation = useRouterLocation();
  const [sessions, setSessions] = useState([]);
  const [records, setRecords] = useState([]);
  const [faceStatus, setFaceStatus] = useState(null);

  const [selectedSession, setSelectedSession] =
    useState(null);

  const [token, setToken] = useState("");

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [submitting, setSubmitting] =
    useState(false);

  const [scannerActive, setScannerActive] =
    useState(false);

  const [faceCameraActive, setFaceCameraActive] = useState(false);
  const [faceRegistrationMode, setFaceRegistrationMode] = useState(false);
  const [faceSubmitting, setFaceSubmitting] = useState(false);

  const [scannerSupported, setScannerSupported] =
    useState(false);

  const [location, setLocation] =
    useState(null);

  const [locationLoading, setLocationLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  const [notice, setNotice] =
    useState("");

  const [filter, setFilter] =
    useState("all");

  const videoRef = useRef(null);
  const faceVideoRef = useRef(null);
  const faceCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const faceStreamRef = useRef(null);
  const scannerTimerRef = useRef(null);
  const appliedRouteSelectionRef = useRef(null);


  const loadData = useCallback(
    async (silent = false) => {
      try {
        if (silent) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        setError("");

        const [
          activeSessions,
          attendanceRecords,
          registrationStatus,
        ] = await Promise.all([
          getActiveStudentSessions(),
          getMyAttendance(),
          getMyFaceStatus(),
        ]);

        setSessions(
          Array.isArray(activeSessions)
            ? activeSessions
            : []
        );

        setRecords(
          Array.isArray(attendanceRecords)
            ? attendanceRecords
            : []
        );
        setFaceStatus(registrationStatus || null);
      } catch (error) {
        setError(
          getErrorMessage(
            error,
            "Unable to load attendance data."
          )
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );


  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const requested = routeLocation.state;
    if (loading) return;
    if (requested?.method === "register-face") {
      setFaceRegistrationMode(true);
      window.requestAnimationFrame(() => document.getElementById("student-face-registration")?.scrollIntoView({ behavior: "smooth", block: "center" }));
      return;
    }
    if (!requested?.sessionId && ["qr", "face"].includes(requested?.method)) {
      const marker = `${routeLocation.key}:${requested.method}:choose-session`;
      if (appliedRouteSelectionRef.current === marker) return;
      appliedRouteSelectionRef.current = marker;
      setNotice(`Choose an active session below, then open the ${requested.method === "qr" ? "QR scanner" : "face camera"}.`);
      window.requestAnimationFrame(() => document.getElementById("student-live-session-list")?.scrollIntoView({ behavior: "smooth", block: "start" }));
      return;
    }
    if (!requested?.sessionId) return;

    const marker = `${routeLocation.key}:${requested.sessionId}:${requested.method || ""}`;
    if (appliedRouteSelectionRef.current === marker) return;

    const session = sessions.find(
      (item) => String(item.id) === String(requested.sessionId)
    );
    if (!session) return;

    appliedRouteSelectionRef.current = marker;
    setSelectedSession(session);
    setToken("");
    setError("");
    setNotice(
      requested.method === "face"
        ? "Session selected. Open the face camera below to verify attendance."
        : "Session selected. Open the scanner below to scan your teacher's current QR code."
    );

    window.requestAnimationFrame(() => {
      const targetId = requested.method === "face"
        ? "student-face-attendance"
        : "student-qr-attendance";
      document.getElementById(targetId)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }, [loading, routeLocation.key, routeLocation.state, sessions]);

  // Refresh open sessions and attendance history while this page is visible.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        loadData(true);
      }
    }, 15000);

    return () => window.clearInterval(timer);
  }, [loadData]);


  useEffect(() => {
    setScannerSupported(true);
  }, []);


  useEffect(() => {
    return () => {
      stopScanner();
      faceStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!faceCameraActive || !faceVideoRef.current || !faceStreamRef.current) return undefined;
    const video = faceVideoRef.current;
    video.srcObject = faceStreamRef.current;
    video.muted = true;
    video.playsInline = true;
    video.play().catch(() => setError("Camera preview could not start. Check browser camera permissions."));
    return () => { video.srcObject = null; };
  }, [faceCameraActive]);


  const stats = useMemo(() => {
    const present = records.filter(
      (record) =>
        record.status === "present"
    ).length;

    const late = records.filter(
      (record) =>
        record.status === "late"
    ).length;

    const absent = records.filter(
      (record) =>
        record.status === "absent"
    ).length;

    const attended =
      present + late;

    const total =
      records.length;

    const percentage =
      total > 0
        ? (attended / total) * 100
        : 0;

    return {
      total,
      present,
      late,
      absent,
      attended,
      percentage,
    };
  }, [records]);


  const filteredRecords =
    useMemo(() => {
      if (filter === "all") {
        return records;
      }

      return records.filter(
        (record) =>
          record.status === filter
      );
    }, [records, filter]);


  function selectSession(session) {
    if (faceCameraActive) stopFaceCamera();
    if (scannerActive) void stopScanner();
    setSelectedSession(session);
    setToken("");
    setError("");
    setNotice("");
  }


  function getCurrentLocation() {
    return new Promise(
      (resolve, reject) => {
        if (!navigator.geolocation) {
          reject(
            new Error(
              "Geolocation is not supported by this browser."
            )
          );

          return;
        }

        navigator.geolocation.getCurrentPosition(
          (position) => {
            const coordinates = {
              latitude:
                position.coords.latitude,

              longitude:
                position.coords.longitude,

              accuracy:
                position.coords.accuracy,
            };

            setLocation(coordinates);

            resolve(coordinates);
          },

          (geoError) => {
            reject(
              new Error(
                geoError.code === 1
                  ? "Location permission was denied."
                  : "Unable to get your current location."
              )
            );
          },

          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
          }
        );
      }
    );
  }


  async function captureLocation() {
    try {
      setLocationLoading(true);
      setError("");

      await getCurrentLocation();

      setNotice(
        "Current location captured."
      );
    } catch (error) {
      setError(
        error.message ||
          "Unable to capture location."
      );
    } finally {
      setLocationLoading(false);
    }
  }


  async function submitAttendance(
    scannedToken = token
  ) {
    if (!selectedSession) {
      setError(
        "Select an active attendance session first."
      );

      return;
    }

    const cleanToken =
      String(scannedToken || "").trim();

    if (!cleanToken) {
      setError(
        "QR token is empty. Scan the teacher's QR code."
      );

      return;
    }

    try {
      setSubmitting(true);
      setError("");
      setNotice("");

      let coordinates = location;

      if (!coordinates) {
        coordinates =
          await getCurrentLocation();

        setLocation(coordinates);
      }

      const result =
        await submitStudentQrAttendance(
          selectedSession.id,
          {
            token: cleanToken,
            latitude:
              coordinates?.latitude ?? null,
            longitude:
              coordinates?.longitude ?? null,
          }
        );

      setNotice(
        result?.message ||
          "Attendance recorded successfully."
      );

      setToken("");

      await stopScanner();

      await loadData(true);

      const updatedSession =
        sessions.find(
          (item) =>
            item.id ===
            selectedSession.id
        );

      if (updatedSession) {
        setSelectedSession({
          ...updatedSession,
          already_attended: true,
        });
      }
    } catch (error) {
      setError(
        getErrorMessage(
          error,
          "Attendance could not be recorded."
        )
      );
    } finally {
      setSubmitting(false);
    }
  }


  async function startScanner() {
    setError("");
    setNotice("");

    if (!selectedSession) {
      setError(
        "Select an active session before opening the scanner."
      );

      return;
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access requires HTTPS or localhost in a supported browser.");
      }
      const permissionStream =
        await navigator.mediaDevices.getUserMedia(
          {
            video: {
              facingMode: {
                ideal: "environment",
              },
            },
            audio: false,
          }
        );

      streamRef.current =
        permissionStream;

      if (videoRef.current) {
        videoRef.current.srcObject =
          permissionStream;

        await videoRef.current.play();
      }

      setScannerActive(true);

      const detector = "BarcodeDetector" in window
        ? new window.BarcodeDetector({
          formats: ["qr_code"],
        })
        : null;
      const scanCanvas = document.createElement("canvas");
      const scanContext = scanCanvas.getContext("2d", { willReadFrequently: true });
      let scanInFlight = false;

      scannerTimerRef.current =
        window.setInterval(
          async () => {
            if (scanInFlight) return;
            if (!videoRef.current) {
              return;
            }

            if (
              videoRef.current.readyState <
              2
            ) {
              return;
            }

            try {
              scanInFlight = true;
              let scannedValue = "";
              if (detector) {
                const barcodes = await detector.detect(videoRef.current);
                scannedValue = barcodes[0]?.rawValue || "";
              } else if (scanContext) {
                const video = videoRef.current;
                scanCanvas.width = video.videoWidth;
                scanCanvas.height = video.videoHeight;
                scanContext.drawImage(video, 0, 0, scanCanvas.width, scanCanvas.height);
                const pixels = scanContext.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
                scannedValue = jsQR(pixels.data, pixels.width, pixels.height, {
                  inversionAttempts: "dontInvert",
                })?.data || "";
              }

              if (scannedValue) {
                const scanned = scannedValue.trim();

                setToken(scanned);

                await stopScanner();

                await submitAttendance(
                  scanned
                );
              }
            } catch (scanError) {
              console.error(
                "QR detection error:",
                scanError
              );
            } finally {
              scanInFlight = false;
            }
          },
          500
        );
    } catch (error) {
      console.error(
        "Camera start failed:",
        error
      );

      setScannerActive(false);

      setError(
        error?.name ===
          "NotAllowedError"
          ? "Camera permission was denied."
          : error?.message || "Unable to access the camera."
      );
    }
  }


  async function stopScanner() {
    if (scannerTimerRef.current) {
      window.clearInterval(
        scannerTimerRef.current
      );

      scannerTimerRef.current =
        null;
    }

    if (streamRef.current) {
      streamRef.current
        .getTracks()
        .forEach(
          (track) =>
            track.stop()
        );

      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject =
        null;
    }

    setScannerActive(false);
  }


  async function startFaceCamera(registering = false) {
    const registeringFace = registering || faceRegistrationMode;
    setError("");
    setNotice("");
    if (!registeringFace && (!selectedSession || selectedSession.already_attended)) return;
    if (!registeringFace && !faceStatus?.face_registered) {
      setError("Your face is not registered. Please register your face first.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera access is unavailable. Use HTTPS or localhost and check browser support.");
      return;
    }
    try {
      await stopScanner();
      faceStreamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "user" }, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      setFaceCameraActive(true);
    } catch (cameraError) {
      setFaceCameraActive(false);
      setError(cameraError?.name === "NotAllowedError"
        ? "Camera permission was denied. Allow camera access and try again."
        : cameraError?.name === "NotFoundError"
          ? "No camera was found on this device."
          : "Unable to open the camera. Close other apps using it and retry.");
    }
  }


  function stopFaceCamera() {
    faceStreamRef.current?.getTracks().forEach((track) => track.stop());
    faceStreamRef.current = null;
    if (faceVideoRef.current) faceVideoRef.current.srcObject = null;
    setFaceCameraActive(false);
  }


  async function captureFaceAttendance() {
    const video = faceVideoRef.current;
    const canvas = faceCanvasRef.current;
    if ((!faceRegistrationMode && !selectedSession) || !video?.videoWidth || !canvas) {
      setError("Wait for the live camera preview before capturing your face.");
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setError("Camera capture is unavailable in this browser. Please retry or use QR attendance.");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) {
      setError("The camera frame could not be captured. Please retry.");
      return;
    }

    setFaceSubmitting(true);
    setError("");
    setNotice("");
    try {
      const capture = new File([blob], faceRegistrationMode ? "my-face.jpg" : "attendance-face.jpg", { type: "image/jpeg" });
      if (faceRegistrationMode) {
        const result = await registerMyFace(capture);
        setFaceStatus(result);
        stopFaceCamera();
        setFaceRegistrationMode(false);
        setNotice("Face registered successfully. You can now mark attendance with face recognition.");
        await loadData(true);
        return;
      }
      let coordinates = null;
      if (selectedSession.latitude != null && selectedSession.longitude != null) {
        coordinates = await getCurrentLocation();
      }
      const sessionId = selectedSession.id;
      const result = await submitStudentFaceAttendance(sessionId, capture, coordinates);
      stopFaceCamera();
      setNotice(result?.message || "Face attendance recorded successfully.");
      await loadData(true);
      setSelectedSession((current) => current && current.id === sessionId
        ? { ...current, already_attended: true }
        : current);
    } catch (captureError) {
      setError(getErrorMessage(captureError, "Face attendance could not be recorded."));
    } finally {
      setFaceSubmitting(false);
    }
  }


  return (
    <div className="student-attendance-page">

      <div className="student-attendance-container">

        <header className="student-attendance-header">

          <div>
            <div className="student-attendance-eyebrow">
              STUDENT PORTAL
            </div>

            <h1>
              My Attendance
            </h1>

            <p>
              Join an active classroom session,
              verify the dynamic QR and record
              attendance with location validation.
            </p>
          </div>

          <button
            type="button"
            className="student-attendance-refresh"
            onClick={() =>
              loadData(true)
            }
            disabled={refreshing}
          >
            {refreshing
              ? "Refreshing..."
              : "Refresh"}
          </button>

        </header>


        {error && (
          <div className="student-attendance-alert error">
            <strong>
              Attendance issue
            </strong>

            <span>
              {error}
            </span>
          </div>
        )}


        {notice && (
          <div className="student-attendance-alert success">
            <strong>
              AttendX
            </strong>

            <span>
              {notice}
            </span>
          </div>
        )}


        {!faceStatus?.face_registered && (
          <section id="student-face-registration" className="student-face-attendance-card" aria-label="Register face">
            <div className="student-face-attendance-heading">
              <div>
                <strong>Face registration</strong>
                <p>Your face is not registered. Please register your face first.</p>
              </div>
              {faceCameraActive && faceRegistrationMode && <button type="button" className="student-secondary-button" onClick={() => { stopFaceCamera(); setFaceRegistrationMode(false); }} disabled={faceSubmitting}>Close camera</button>}
            </div>
            {faceCameraActive && faceRegistrationMode ? (
              <div className="student-face-camera-layout">
                <video ref={faceVideoRef} autoPlay muted playsInline />
                <canvas ref={faceCanvasRef} hidden />
                <button type="button" className="student-submit-button" onClick={captureFaceAttendance} disabled={faceSubmitting}>
                  {faceSubmitting ? "Registering face..." : "Capture and Register Face"}
                </button>
              </div>
            ) : (
              <button type="button" className="student-primary-button" onClick={() => { setFaceRegistrationMode(true); startFaceCamera(true); }} disabled={faceSubmitting || loading}>Register My Face</button>
            )}
          </section>
        )}

        <section className="student-attendance-stats">

          <div className="student-attendance-stat highlight">
            <span>
              ATTENDANCE RATE
            </span>

            <strong>
              {stats.percentage.toFixed(2)}%
            </strong>

            <small>
              Present + late
            </small>
          </div>


          <div className="student-attendance-stat">
            <span>
              ACTIVE SESSIONS
            </span>

            <strong>
              {sessions.length}
            </strong>

            <small>
              Sessions currently open
            </small>
          </div>


          <div className="student-attendance-stat">
            <span>
              PRESENT
            </span>

            <strong>
              {stats.present}
            </strong>

            <small>
              Verified present
            </small>
          </div>


          <div className="student-attendance-stat">
            <span>
              ABSENT
            </span>

            <strong>
              {stats.absent}
            </strong>

            <small>
              Recorded absent
            </small>
          </div>

        </section>


        <section id="student-live-session-list" className="student-live-attendance">

          <div className="student-section-heading">

            <div>
              <div className="student-section-kicker">
                LIVE CLASSROOM
              </div>

              <h2>
                Join Attendance
              </h2>

              <p>
                Select the class session created
                by your teacher.
              </p>
            </div>

            <div className="student-verification-chain">
              <span>QR</span>
              <b>+</b>
              <span>GPS</span>
              <b>+</b>
              <span>SESSION</span>
            </div>

          </div>


          {loading ? (
            <div className="student-attendance-empty">
              Loading active sessions...
            </div>
          ) : sessions.length === 0 ? (
            <div className="student-no-session">
              <div className="student-no-session-icon">
                ◌
              </div>

              <div>
                <strong>
                  No active attendance session
                </strong>

                <p>
                  Ask your teacher to create and
                  open an attendance session.
                </p>
              </div>
            </div>
          ) : (
            <div className="student-session-grid">

              {sessions.map(
                (session) => (
                  <button
                    type="button"
                    key={session.id}
                    className={`student-session-card ${
                      selectedSession?.id ===
                      session.id
                        ? "selected"
                        : ""
                    }`}
                    onClick={() =>
                      selectSession(session)
                    }
                  >

                    <div className="student-session-top">

                      <span className="student-session-live">
                        LIVE
                      </span>

                      {session.already_attended && (
                        <span className="student-session-done">
                          RECORDED
                        </span>
                      )}

                    </div>

                    <strong>
                      {session.title}
                    </strong>

                    <span>
                      {session.subject_name ||
                        "Subject"}
                      {session.subject_code
                        ? ` • ${session.subject_code}`
                        : ""}
                    </span>

                    <small>
                      {session.class_name ||
                        "Class"}
                      {session.section
                        ? ` • Section ${session.section}`
                        : ""}
                    </small>

                    <small>
                      Teacher:{" "}
                      {session.teacher_name ||
                        "Assigned teacher"}
                    </small>

                    <div className="student-session-time">
                      {formatTime(
                        session.starts_at
                      )}
                      {" — "}
                      {formatTime(
                        session.ends_at
                      )}
                    </div>

                  </button>
                )
              )}

            </div>
          )}


          {selectedSession && (
            <div className="student-verification-panel">

              <div className="student-verification-header">

                <div>
                  <div className="student-section-kicker">
                    VERIFICATION
                  </div>

                  <h3>
                    {selectedSession.title}
                  </h3>

                  <p>
                    {selectedSession.subject_name ||
                      "Subject"}
                    {" · "}
                    {selectedSession.class_name ||
                      "Class"}
                  </p>
                </div>

                {selectedSession.already_attended ? (
                  <span className="student-recorded-badge">
                    Attendance Recorded
                  </span>
                ) : (
                  <span className="student-ready-badge">
                    Ready
                  </span>
                )}

              </div>


              {selectedSession.already_attended ? (

                <div className="student-already-recorded">

                  <div className="student-success-icon">
                    ✓
                  </div>

                  <div>
                    <strong>
                      Attendance already marked for this session.
                    </strong>

                    <span>
                      You cannot submit another
                      attendance event for this
                      session.
                    </span>
                  </div>

                </div>

              ) : (
                <>
                <div className="student-verification-grid">

                  <div className="student-scanner-card" id="student-qr-attendance">

                    <div className="student-scanner-title">
                      <strong>
                        Scan Teacher QR
                      </strong>

                      <span>
                        Use your device camera
                      </span>
                    </div>


                    <div className="student-camera">

                      {scannerActive ? (
                        <>
                          <video
                            ref={videoRef}
                            autoPlay
                            muted
                            playsInline
                          />

                          <div className="student-scan-frame">
                            <span />
                          </div>
                        </>
                      ) : (
                        <div className="student-camera-idle">
                          <div>
                            QR
                          </div>

                          <span>
                            Camera scanner
                          </span>
                        </div>
                      )}

                    </div>


                    <div className="student-scanner-actions">

                      {!scannerActive ? (
                        <button
                          type="button"
                          className="student-primary-button"
                          onClick={startScanner}
                          disabled={
                            submitting
                          }
                        >
                          Open QR Scanner
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="student-secondary-button"
                          onClick={
                            stopScanner
                          }
                        >
                          Stop Scanner
                        </button>
                      )}

                    </div>


                    {!scannerSupported && (
                      <div className="student-scanner-warning">
                        This browser does not expose
                        native QR detection. Use the
                        token field on the right.
                      </div>
                    )}

                  </div>


                  <div className="student-submit-card">

                    <div className="student-scanner-title">
                      <strong>
                        Verification
                      </strong>

                      <span>
                        QR + current location
                      </span>
                    </div>


                    <label className="student-token-label">
                      QR token

                      <textarea
                        value={token}
                        onChange={(event) =>
                          setToken(
                            event.target.value
                          )
                        }
                        placeholder="Scan QR or paste the dynamic QR token here..."
                        rows={5}
                      />
                    </label>


                    <div className="student-location-box">

                      <div>
                        <strong>
                          Location
                        </strong>

                        <span>
                          {location
                            ? `${location.latitude.toFixed(
                                5
                              )}, ${location.longitude.toFixed(
                                5
                              )}`
                            : "Not captured"}
                        </span>
                      </div>

                      <button
                        type="button"
                        className="student-location-button"
                        onClick={
                          captureLocation
                        }
                        disabled={
                          locationLoading
                        }
                      >
                        {locationLoading
                          ? "Locating..."
                          : location
                            ? "Update"
                            : "Capture"}
                      </button>

                    </div>


                    {selectedSession.latitude != null &&
                      selectedSession.longitude != null && (
                        <div className="student-geofence-info">
                          <span>
                            Geo-fence enabled
                          </span>

                          <strong>
                            Radius{" "}
                            {selectedSession.radius_m}m
                          </strong>
                        </div>
                      )}


                    <button
                      type="button"
                      className="student-submit-button"
                      onClick={() =>
                        submitAttendance()
                      }
                      disabled={
                        submitting ||
                        !token.trim()
                      }
                    >
                      {submitting
                        ? "Verifying attendance..."
                        : "Verify & Mark Attendance"}
                    </button>


                    <p className="student-security-note">
                      AttendX validates the session,
                      QR signature, expiry, duplicate
                      attendance and configured location
                      before creating the attendance event.
                    </p>

                  </div>

                </div>

                <section id="student-face-attendance" className="student-face-attendance-card" aria-label="Face recognition attendance">
                  <div className="student-face-attendance-heading">
                    <div>
                      <strong>Face Recognition Attendance</strong>
                      <p>Registration status: <b className={faceStatus?.face_registered ? "registered" : "not-registered"}>
                        {faceStatus?.face_registered ? "Registered" : "Not Registered"}
                      </b></p>
                    </div>
                    {faceCameraActive && <button type="button" className="student-secondary-button" onClick={stopFaceCamera} disabled={faceSubmitting}>Close camera</button>}
                  </div>
                  {faceCameraActive && !faceRegistrationMode ? (
                    <div className="student-face-camera-layout">
                      <video ref={faceVideoRef} autoPlay muted playsInline />
                      <canvas ref={faceCanvasRef} hidden />
                      <button type="button" className="student-submit-button" onClick={captureFaceAttendance} disabled={faceSubmitting}>
                        {faceSubmitting ? "Verifying face…" : "Capture and Mark Attendance"}
                      </button>
                    </div>
                  ) : (
                    <div className="student-face-attendance-actions">
                      <p>{faceStatus?.face_registered
                        ? "The backend verifies your live capture against your registered face and the active class session."
                        : "Your face is not registered. Please register your face first."}</p>
                      <button type="button" className="student-primary-button" onClick={startFaceCamera}
                        disabled={!faceStatus?.face_registered || faceSubmitting || submitting || selectedSession.already_attended}>
                        Open Camera
                      </button>
                    </div>
                  )}
                </section>

                </>

              )}

            </div>
          )}

        </section>


        <section className="student-attendance-panel">

          <div className="student-attendance-panel-header">

            <div>
              <div className="student-attendance-panel-kicker">
                HISTORY
              </div>

              <h2>
                Attendance Records
              </h2>

              <p>
                Your recorded attendance events.
              </p>
            </div>


            <div className="student-attendance-filters">

              {[
                ["all", "All"],
                ["present", "Present"],
                ["late", "Late"],
                ["absent", "Absent"],
              ].map(
                ([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={
                      filter === value
                        ? "active"
                        : ""
                    }
                    onClick={() =>
                      setFilter(value)
                    }
                  >
                    {label}
                  </button>
                )
              )}

            </div>

          </div>


          {filteredRecords.length === 0 ? (

            <div className="student-attendance-empty">

              <strong>
                No attendance records found.
              </strong>

              <span>
                Your verified attendance events
                will appear here.
              </span>

            </div>

          ) : (

            <div className="student-attendance-table-wrap">

              <table className="student-attendance-table">

                <thead>
                  <tr>
                    <th>
                      Subject
                    </th>

                    <th>
                      Class
                    </th>

                    <th>
                      Date
                    </th>

                    <th>
                      Time
                    </th>

                    <th>
                      Method
                    </th>

                    <th>
                      Status
                    </th>
                  </tr>
                </thead>


                <tbody>

                  {filteredRecords.map(
                    (record, index) => (
                      <tr
                        key={
                          record.id ??
                          index
                        }
                      >

                        <td>
                          <div className="student-attendance-subject">
                            <strong>
                              {record.subject_name ||
                                "Subject"}
                            </strong>

                            <span>
                              {record.title ||
                                "Attendance Session"}
                            </span>
                          </div>
                        </td>


                        <td>
                          <div className="student-attendance-class">
                            <strong>
                              {record.class_name ||
                                "—"}
                            </strong>

                            {record.section && (
                              <span>
                                Section{" "}
                                {record.section}
                              </span>
                            )}
                          </div>
                        </td>


                        <td>
                          {formatDate(
                            record.verified_at
                          )}
                        </td>


                        <td>
                          {formatTime(
                            record.verified_at
                          )}
                        </td>


                        <td>
                          <span className="attendance-method">
                            {record.method ||
                              "—"}
                          </span>
                        </td>


                        <td>
                          <span
                            className={`student-status ${
                              record.status
                            }`}
                          >
                            {record.status ||
                              "unknown"}
                          </span>
                        </td>

                      </tr>
                    )
                  )}

                </tbody>

              </table>

            </div>

          )}

        </section>

      </div>
    </div>
  );
}
