import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import jsQR from "jsqr";

import { Link } from "react-router-dom";

import {
  Activity,
  ArrowRight,
  BookOpen,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  Camera,
  QrCode,
  X,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";

import { useAuth } from "../../context/AuthContext";

import {
  getActiveStudentSessions,
  getMyFaceStatus,
  getMyAttendance,
  submitStudentFaceAttendance,
  submitStudentQrAttendance,
} from "../../services/attendance";

import "./StudentDashboard.css";
import { getApiErrorMessage } from "../../utils/errors";

function toList(value, keys = []) {
  if (Array.isArray(value)) return value;

  for (const key of keys) {
    if (Array.isArray(value?.[key])) {
      return value[key];
    }
  }

  return [];
}

function getErrorMessage(error, fallback) {
  return getApiErrorMessage(error, fallback);
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

function formatTime(value) {
  if (!value) return "—";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
}

function statusName(value) {
  const status = String(value || "unknown").toLowerCase();

  if (status === "present") return "Present";
  if (status === "late") return "Late";
  if (status === "absent") return "Absent";
  if (status === "excused") return "Excused";

  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function StudentDashboard() {
  const { user } = useAuth();

  const [records, setRecords] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [faceStatus, setFaceStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [selectedAttendanceSessionId, setSelectedAttendanceSessionId] = useState("");
  const [cameraMethod, setCameraMethod] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [faceCapture, setFaceCapture] = useState(null);
  const [faceSubmitting, setFaceSubmitting] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const scanTimerRef = useRef(null);
  const scanBusyRef = useRef(false);
  const dashboardLoadRef = useRef(false);

  const selectedAttendanceSession = sessions.find(
    (session) => String(session.id) === String(selectedAttendanceSessionId)
  ) || null;
  const noEligibleSessionMessage = error.toLowerCase().includes("no active class enrollment")
    ? "A class assignment is required before eligible sessions can be shown."
    : "Waiting for your teacher to start attendance.";

  const loadDashboard = useCallback(async (silent = false) => {
    if (dashboardLoadRef.current) return;
    dashboardLoadRef.current = true;

    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError("");
    try {
      const [historyResult, sessionsResult, faceResult] =
        await Promise.allSettled([
          getMyAttendance(),
          getActiveStudentSessions(),
          getMyFaceStatus(),
        ]);

      if (historyResult.status === "fulfilled") {
        setRecords(toList(historyResult.value, ["records", "items", "attendance"]));
      }

      if (sessionsResult.status === "fulfilled") {
        setSessions(toList(sessionsResult.value, ["sessions", "items", "active_sessions"]));
      }

      if (faceResult.status === "fulfilled") {
        setFaceStatus(faceResult.value);
      }

      const errors = [];
      if (historyResult.status === "rejected") {
        errors.push(getErrorMessage(historyResult.reason, "Attendance history could not be loaded."));
      }
      if (sessionsResult.status === "rejected") {
        errors.push(getErrorMessage(sessionsResult.reason, "Active sessions could not be loaded."));
      }
      if (faceResult.status === "rejected") {
        errors.push(getErrorMessage(faceResult.reason, "Face registration status could not be checked."));
      }
      if (errors.length) setError(errors.join(" "));
      setLastUpdated(new Date());
    } catch (loadError) {
      setError(getErrorMessage(loadError, "Student attendance data could not be loaded."));
    } finally {
      dashboardLoadRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!selectedAttendanceSessionId && sessions.length) {
      setSelectedAttendanceSessionId(String(sessions[0].id));
    } else if (selectedAttendanceSessionId && !sessions.some((session) => String(session.id) === String(selectedAttendanceSessionId))) {
      setSelectedAttendanceSessionId(sessions.length ? String(sessions[0].id) : "");
    }
  }, [sessions, selectedAttendanceSessionId]);

  const stopCamera = useCallback(() => {
    if (scanTimerRef.current) {
      window.clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }, []);

  useEffect(() => () => {
    if (scanTimerRef.current) window.clearInterval(scanTimerRef.current);
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => () => {
    if (faceCapture?.preview) URL.revokeObjectURL(faceCapture.preview);
  }, [faceCapture?.preview]);

  useEffect(() => {
    if (!cameraActive || !videoRef.current || !cameraStreamRef.current) return undefined;
    const video = videoRef.current;
    video.srcObject = cameraStreamRef.current;
    video.muted = true;
    video.playsInline = true;
    video.play().catch(() => setError("Camera preview could not start. Check browser camera permissions."));
    return () => { video.srcObject = null; };
  }, [cameraActive]);

  const openCamera = async (method) => {
    setError("");
    setNotice("");
    setFaceCapture(null);
    setCameraMethod(method);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera access is unavailable. Open AttendX on HTTPS or localhost and check browser support.");
      return;
    }
    try {
      stopCamera();
      cameraStreamRef.current = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: method === "qr" ? { ideal: "environment" } : { ideal: "user" },
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      setCameraActive(true);
    } catch (cameraError) {
      setCameraActive(false);
      setError(cameraError?.name === "NotAllowedError"
        ? "Camera permission was denied. Allow camera access and try again."
        : cameraError?.name === "NotFoundError"
          ? "No camera was found on this device."
          : "Unable to open the camera. Close other apps using it and retry.");
    }
  };

  const getSessionCoordinates = async (session) => {
    if (session?.latitude == null || session?.longitude == null) return null;
    if (!navigator.geolocation) throw new Error("Location permission is required for this attendance session.");
    return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      (geoError) => reject(new Error(geoError.code === 1
        ? "Location permission was denied."
        : "Unable to get your current location.")),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    ));
  };

  const handleScannedQr = useCallback(async (rawValue) => {
    if (scanBusyRef.current) return;
    scanBusyRef.current = true;
    stopCamera();
    try {
      let token = String(rawValue || "").trim();
      if (!token.startsWith("AXQR.")) {
        try { token = new URL(token, window.location.origin).searchParams.get("token") || token; } catch { /* Keep the scanned value for a readable validation failure. */ }
      }
      const tokenSessionId = token.match(/^AXQR\.(\d+)\./)?.[1];
      const session = selectedAttendanceSession;
      if (!session) throw new Error("No active attendance session matches this QR code.");
      if (tokenSessionId && String(tokenSessionId) !== String(session.id)) {
        throw new Error("This QR code belongs to a different session. Select that session before scanning.");
      }
      if (session.already_attended) throw new Error("Attendance already marked for this session.");
      const coordinates = await getSessionCoordinates(session);
      const result = await submitStudentQrAttendance(session.id, {
        token,
        latitude: coordinates?.latitude ?? null,
        longitude: coordinates?.longitude ?? null,
      });
      setNotice(result?.message || "Attendance recorded successfully.");
      setSessions((current) => current.map((item) => String(item.id) === String(session.id)
        ? { ...item, already_attended: true }
        : item));
      await loadDashboard(true);
    } catch (scanError) {
      setError(getErrorMessage(scanError, "QR attendance could not be recorded."));
    } finally {
      scanBusyRef.current = false;
    }
  }, [sessions, selectedAttendanceSession, stopCamera, loadDashboard]);

  useEffect(() => {
    if (!cameraActive || cameraMethod !== "qr" || !videoRef.current) return undefined;
    let active = true;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !context) {
      setError("QR scanning could not access the camera frame. Close the scanner and retry.");
      stopCamera();
      return undefined;
    }
    const scan = async () => {
      if (!active || scanBusyRef.current || !videoRef.current || videoRef.current.readyState < 2) return;
      scanBusyRef.current = true;
      let decodedValue = "";
      try {
        const video = videoRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = context.getImageData(0, 0, canvas.width, canvas.height);
        decodedValue = jsQR(frame.data, frame.width, frame.height, {
          inversionAttempts: "attemptBoth",
        })?.data || "";
      } catch (scanError) {
        console.warn("QR frame decode failed:", scanError);
      } finally {
        scanBusyRef.current = false;
      }
      if (active && decodedValue) await handleScannedQr(decodedValue);
    };
    scanTimerRef.current = window.setInterval(scan, 450);
    return () => {
      active = false;
      if (scanTimerRef.current) window.clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    };
  }, [cameraActive, cameraMethod, handleScannedQr, stopCamera]);

  const captureFace = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!video?.videoWidth || !canvas || !context) {
      setError("Wait for the live camera preview before capturing your face.");
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) {
      setError("The camera frame could not be captured. Please retry.");
      return;
    }
    setFaceCapture({
      file: new File([blob], "attendance-face.jpg", { type: "image/jpeg" }),
      preview: URL.createObjectURL(blob),
    });
    stopCamera();
    setError("");
    setNotice("Face captured. Verify it against the selected active session.");
  };

  const verifyFace = async () => {
    if (!selectedAttendanceSession || !faceCapture?.file) return;
    if (selectedAttendanceSession.already_attended) {
      setError("Attendance already marked for this session.");
      return;
    }
    setFaceSubmitting(true);
    setError("");
    setNotice("");
    try {
      const coordinates = await getSessionCoordinates(selectedAttendanceSession);
      const result = await submitStudentFaceAttendance(selectedAttendanceSession.id, faceCapture.file, coordinates);
      setNotice(result?.message || "Face recognized successfully. Your attendance has been marked.");
      if (faceCapture.preview) URL.revokeObjectURL(faceCapture.preview);
      setFaceCapture(null);
      setSessions((current) => current.map((item) => String(item.id) === String(selectedAttendanceSession.id)
        ? { ...item, already_attended: true }
        : item));
      await loadDashboard(true);
    } catch (faceError) {
      setError(getErrorMessage(faceError, "Face attendance could not be recorded."));
    } finally {
      setFaceSubmitting(false);
    }
  };

  const closeCameraDialog = () => {
    stopCamera();
    setCameraMethod(null);
    if (faceCapture?.preview) URL.revokeObjectURL(faceCapture.preview);
    setFaceCapture(null);
  };

  // Teacher session creation and attendance events should reach the
  // student dashboard without requiring a manual page refresh.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        loadDashboard(true);
      }
    }, 7000);

    return () => window.clearInterval(timer);
  }, [loadDashboard]);

  const summary = useMemo(() => {
    const present = records.filter(
      (record) =>
        String(record.status || "").toLowerCase() === "present"
    ).length;

    const late = records.filter(
      (record) =>
        String(record.status || "").toLowerCase() === "late"
    ).length;

    const absent = records.filter(
      (record) =>
        String(record.status || "").toLowerCase() === "absent"
    ).length;

    const attended = present + late;
    const total = records.length;

    const percentage = total
      ? Math.round((attended / total) * 100)
      : 0;

    return {
      present,
      late,
      absent,
      attended,
      total,
      percentage,
    };
  }, [records]);

  const subjectSummary = useMemo(() => {
    const subjects = new Map();

    records.forEach((record) => {
      const name =
        record.subject_name ||
        record.subject ||
        "Other classes";

      const item = subjects.get(name) || {
        name,
        total: 0,
        attended: 0,
      };

      item.total += 1;

      const status = String(record.status || "").toLowerCase();

      if (status === "present" || status === "late") {
        item.attended += 1;
      }

      subjects.set(name, item);
    });

    return [...subjects.values()]
      .map((item) => ({
        ...item,
        percentage: item.total
          ? Math.round((item.attended / item.total) * 100)
          : 0,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [records]);

  const firstName =
    String(user?.name || "Student")
      .trim()
      .split(/\s+/)[0] || "Student";

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="student-dashboard-page">
      <section className="sd-welcome">
        <div>
          <span className="sd-eyebrow">
            STUDENT WORKSPACE
          </span>

          <h2>Welcome back, {firstName}.</h2>

          <p>
            Track your attendance, check current sessions
            and stay on top of your classes.
          </p>

          <div className="sd-today">
            <CalendarCheck2 size={15} />
            {today}
          </div>
        </div>

        <div className="sd-welcome-actions">
          <button
            className="sd-quiet-button"
            type="button"
            onClick={() => loadDashboard(true)}
            disabled={loading || refreshing}
          >
            <RefreshCw
              size={15}
              className={refreshing ? "sd-spin" : ""}
            />

            {refreshing ? "Refreshing" : "Refresh"}
          </button>

          <Link
            className="sd-primary-button"
            to="/student/attendance"
          >
            Open attendance <ArrowRight size={17} />
          </Link>
        </div>
      </section>

      {error && (
        <div className="sd-alert" role="status">
          <ShieldAlert size={18} />

          <span>
            {error} Check that the backend is running
            and your student profile is active.
          </span>
        </div>
      )}

      <section
        className="sd-stat-grid"
        aria-label="Attendance summary"
      >
        <article className="sd-stat-card">
          <span className="sd-stat-icon purple">
            <TrendingUp size={20} />
          </span>

          <div>
            <span className="sd-stat-label">
              Attendance rate
            </span>

            <strong>
              {loading ? "—" : `${summary.percentage}%`}
            </strong>

            <small>Present + late classes</small>
          </div>

          <div
            className="sd-stat-ring"
            style={{
              "--sd-ring": `${summary.percentage}%`,
            }}
          >
            <span>
              {loading ? "…" : `${summary.percentage}%`}
            </span>
          </div>
        </article>

        <article className="sd-stat-card">
          <span className="sd-stat-icon green">
            <CheckCircle2 size={20} />
          </span>

          <div>
            <span className="sd-stat-label">
              Classes attended
            </span>

            <strong>
              {loading ? "—" : summary.attended}
            </strong>

            <small>
              {summary.present} present · {summary.late} late
            </small>
          </div>
        </article>

        <article className="sd-stat-card">
          <span className="sd-stat-icon orange">
            <Clock3 size={20} />
          </span>

          <div>
            <span className="sd-stat-label">
              Absent classes
            </span>

            <strong>
              {loading ? "—" : summary.absent}
            </strong>

            <small>Based on loaded records</small>
          </div>
        </article>

        <article className="sd-stat-card">
          <span className="sd-stat-icon blue">
            <Activity size={20} />
          </span>

          <div>
            <span className="sd-stat-label">
              Live sessions
            </span>

            <strong>
              {loading ? "—" : sessions.length}
            </strong>

            <small>Available to join now</small>
          </div>
        </article>
      </section>

      {summary.total > 0 &&
        summary.percentage < 75 &&
        !loading && (
          <div className="sd-attendance-tip">
            <ShieldAlert size={17} />

            <span>
              <strong>Your attendance is below 75%.</strong>
              {" "}Try to attend upcoming classes regularly
              and check your subject-wise records.
            </span>
          </div>
        )}

      <section className="sd-face-status sd-panel">
        <div className="sd-face-status-copy">
          <span className="sd-panel-kicker">BIOMETRIC PROFILE</span>
          <h3>Face registration</h3>
          <p>{faceStatus?.face_registered ? "Your registered face reference is ready for verification." : "Your face is not registered. Please register your face first."}</p>
        </div>
        <span className={`sd-session-status ${faceStatus?.face_registered ? "done" : "open"}`}>
          {loading ? "Checking…" : faceStatus?.status === "unavailable" ? "Unavailable" : faceStatus?.face_registered ? "Registered" : "Not registered"}
        </span>
        {faceStatus?.face_registered ? (
          <Link to="/student/attendance">Open attendance <ArrowRight size={14} /></Link>
        ) : (
          <Link to="/student/attendance" state={{ method: "register-face" }}>Register My Face <ArrowRight size={14} /></Link>
        )}
      </section>

      <section className="sd-attendance-methods" aria-labelledby="sd-attendance-methods-title">
        <div className="sd-attendance-methods-heading">
          <div>
            <span className="sd-panel-kicker">ATTENDANCE OPTIONS</span>
            <h3 id="sd-attendance-methods-title">MARK YOUR ATTENDANCE</h3>
            <p>Choose a method, then select your teacher’s active session.</p>
          </div>
        </div>
        <div className="sd-attendance-method-grid">
          <article className="sd-attendance-method-card">
            <span className="sd-attendance-method-icon qr"><QrCode size={22} /></span>
            <div>
              <h4>Scan Teacher QR</h4>
              <p>Scan the dynamic QR code displayed by your teacher.</p>
            </div>
            <select aria-label="Select session for QR attendance" value={selectedAttendanceSessionId} onChange={(event) => setSelectedAttendanceSessionId(event.target.value)}>
              <option value="">{sessions.length ? "Select an active session" : "No active sessions"}</option>
              {sessions.map((session) => <option key={session.id} value={session.id}>{session.title || session.subject_name} · {session.class_name} · {session.teacher_name || "Teacher"}</option>)}
            </select>
            {selectedAttendanceSession ? (
              <div className="sd-attendance-session-summary">
                <strong>{selectedAttendanceSession.subject_name || "Subject"} · {selectedAttendanceSession.class_name || "Class"}</strong>
                <span>Teacher: {selectedAttendanceSession.teacher_name || "Assigned teacher"}</span>
                <span>Starts {formatDate(selectedAttendanceSession.starts_at)} at {formatTime(selectedAttendanceSession.starts_at)}</span>
                <span className="active">{statusName(selectedAttendanceSession.status).toUpperCase()}</span>
              </div>
            ) : (
              <div className="sd-attendance-session-summary waiting">{noEligibleSessionMessage}</div>
            )}
            <button type="button" onClick={() => openCamera("qr")} disabled={!selectedAttendanceSession || Boolean(selectedAttendanceSession?.already_attended)}>
              Open QR Scanner <ArrowRight size={15} />
            </button>
          </article>
          <article className="sd-attendance-method-card">
            <span className="sd-attendance-method-icon face"><Camera size={22} /></span>
            <div>
              <h4>Face Recognition</h4>
              <p>Face status: <strong>{loading ? "Checking…" : faceStatus?.status === "unavailable" ? "Unavailable" : faceStatus?.face_registered ? "Registered" : "Not Registered"}</strong></p>
            </div>
            <select aria-label="Select session for face attendance" value={selectedAttendanceSessionId} onChange={(event) => setSelectedAttendanceSessionId(event.target.value)}>
              <option value="">{sessions.length ? "Select an active session" : "No active sessions"}</option>
              {sessions.map((session) => <option key={session.id} value={session.id}>{session.title || session.subject_name} · {session.class_name} · {session.teacher_name || "Teacher"}</option>)}
            </select>
            {selectedAttendanceSession ? (
              <div className="sd-attendance-session-summary">
                <strong>{selectedAttendanceSession.subject_name || "Subject"} · {selectedAttendanceSession.class_name || "Class"}</strong>
                <span>Teacher: {selectedAttendanceSession.teacher_name || "Assigned teacher"}</span>
                <span>Starts {formatDate(selectedAttendanceSession.starts_at)} at {formatTime(selectedAttendanceSession.starts_at)}</span>
                <span className="active">{statusName(selectedAttendanceSession.status).toUpperCase()}</span>
              </div>
            ) : (
              <div className="sd-attendance-session-summary waiting">{noEligibleSessionMessage}</div>
            )}
            {faceStatus?.face_registered ? (
              <button type="button" onClick={() => openCamera("face")} disabled={!selectedAttendanceSession || Boolean(selectedAttendanceSession?.already_attended)}>
                Open Face Camera <ArrowRight size={15} />
              </button>
            ) : (
              <Link to="/student/attendance" state={{ method: "register-face" }}>
                Register My Face <ArrowRight size={15} />
              </Link>
            )}
          </article>
        </div>
        {!loading && sessions.length === 0 && !error && (
          <p className="sd-no-active-attendance">No active attendance session. Please wait for your teacher to start attendance.</p>
        )}
      </section>

      {cameraMethod && (
        <div className="sd-camera-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCameraDialog(); }}>
          <section className="sd-camera-dialog" role="dialog" aria-modal="true" aria-labelledby="sd-camera-title">
            <header>
              <div>
                <span className="sd-panel-kicker">ATTENDANCE VERIFICATION</span>
                <h3 id="sd-camera-title">{cameraMethod === "qr" ? "Scan Teacher’s QR Code" : "Face Recognition Attendance"}</h3>
              </div>
              <button type="button" className="sd-camera-close" onClick={closeCameraDialog} aria-label="Close camera"><X size={19} /></button>
            </header>
            {error && <p className="sd-camera-inline-message" role="alert">{error}</p>}
            {notice && <p className="sd-camera-success-message" role="status">{notice}</p>}
            <label className="sd-camera-session-select">
              Active session
              <select value={selectedAttendanceSessionId} onChange={(event) => setSelectedAttendanceSessionId(event.target.value)}>
                <option value="">{sessions.length ? "Select an active session" : "No active sessions"}</option>
                {sessions.map((session) => <option key={session.id} value={session.id}>{session.title || session.subject_name} · {session.class_name}</option>)}
              </select>
            </label>
            {!selectedAttendanceSession && (
              <p className="sd-no-active-attendance">No active attendance session. Please wait for your teacher to start attendance. Camera preview is available; attendance submission is disabled.</p>
            )}
            {selectedAttendanceSession?.already_attended && (
              <p className="sd-camera-inline-message">Attendance already marked for this session.</p>
            )}
            <div className="sd-camera-preview">
              {cameraActive ? (
                <video ref={videoRef} autoPlay muted playsInline />
              ) : cameraMethod === "face" && faceCapture?.preview ? (
                <img src={faceCapture.preview} alt="Captured face preview" />
              ) : (
                <div>{cameraMethod === "qr" ? <QrCode size={30} /> : <Camera size={30} />}<span>{cameraMethod === "qr" ? "QR camera preview" : "Face camera preview"}</span></div>
              )}
              <canvas ref={canvasRef} hidden />
            </div>
            <div className="sd-camera-controls">
              {cameraActive ? (
                cameraMethod === "qr" ? (
                  <button type="button" className="secondary" onClick={stopCamera}>Stop Scanner</button>
                ) : (
                  <button type="button" className="primary" onClick={captureFace}>Capture Face</button>
                )
              ) : cameraMethod === "qr" ? (
                <button type="button" className="primary" onClick={() => openCamera("qr")}>Open QR Scanner</button>
              ) : faceCapture ? (
                <>
                  <button type="button" className="secondary" onClick={() => { setFaceCapture(null); openCamera("face"); }}>Retake</button>
                  <button type="button" className="primary" onClick={verifyFace} disabled={!selectedAttendanceSession || selectedAttendanceSession.already_attended || faceSubmitting || !faceCapture?.file}>
                    {faceSubmitting ? "Verifying face…" : "Verify Face and Mark Attendance"}
                  </button>
                </>
              ) : (
                <button type="button" className="primary" onClick={() => openCamera("face")}>Open Face Camera</button>
              )}
            </div>
            {cameraMethod === "face" && !faceStatus?.face_registered && (
              <p className="sd-camera-inline-message">Your face is not registered. Please register your face first. <Link to="/student/attendance" state={{ method: "register-face" }} onClick={closeCameraDialog}>Register My Face</Link></p>
            )}
            {!selectedAttendanceSession && <button className="sd-camera-disabled-action" type="button" disabled>{cameraMethod === "qr" ? "Mark Attendance" : "Verify Face"} — select an active session first</button>}
          </section>
        </div>
      )}

      <section className="sd-main-grid">
        <article className="sd-panel sd-sessions-panel">
          <div className="sd-panel-heading">
            <div>
              <span className="sd-panel-kicker">
                LIVE ATTENDANCE
              </span>
              <h3>MARK YOUR ATTENDANCE</h3>
            </div>

            <Link to="/student/attendance">
              Attendance page <ArrowRight size={14} />
            </Link>
          </div>

          {loading ? (
            <div className="sd-empty">
              <span className="sd-loader" />
              Loading active sessions…
            </div>
          ) : sessions.length === 0 ? (
            <div className="sd-empty">
              <span className="sd-empty-icon">
                <CalendarCheck2 size={22} />
              </span>

              <strong>No active sessions right now</strong>

              <p>No active attendance session. Please wait for your teacher to start attendance.</p>
            </div>
          ) : (
            <div className="sd-session-list">
              {sessions.slice(0, 5).map((session) => {
                const alreadyAttended =
                  Boolean(session.already_attended);

                const title =
                  session.title ||
                  session.subject_name ||
                  `Session #${session.id}`;

                return (
                  <div
                    className="sd-session-row"
                    key={
                      session.id ??
                      `${title}-${session.starts_at}`
                    }
                  >
                    <div className="sd-session-icon">
                      <BookOpen size={18} />
                    </div>

                    <div className="sd-session-info">
                      <strong>{title}</strong>

                      <span>
                        {session.subject_name || "Subject"}
                        {" · "}
                        {session.class_name || "Class"}
                        {session.section
                          ? ` · ${session.section}`
                          : ""}
                      </span>

                      <small>
                        {session.teacher_name
                          ? `Teacher: ${session.teacher_name}`
                          : "Attendance session"}

                        {session.ends_at
                          ? ` · Ends ${formatTime(session.ends_at)}`
                          : ""}
                      </small>
                    </div>

                    <span
                      className={`sd-session-status ${
                        alreadyAttended ? "done" : "open"
                      }`}
                    >
                      {alreadyAttended ? "Marked" : "Open"}
                    </span>

                    <div className="sd-session-actions" aria-label={`Attendance options for ${title}`}>
                      {alreadyAttended ? (
                        <Link
                          className="sd-session-option recorded"
                          to="/student/attendance"
                          state={{ sessionId: session.id }}
                        >
                          View record
                        </Link>
                      ) : (
                        <>
                          <Link
                            className="sd-session-option face"
                            to="/student/attendance"
                            state={{ sessionId: session.id, method: "face" }}
                          >
                            Open Camera - Face Recognition
                          </Link>
                          <Link
                            className="sd-session-option qr"
                            to="/student/attendance"
                            state={{ sessionId: session.id, method: "qr" }}
                          >
                            Scan QR Code
                          </Link>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </article>

        <article className="sd-panel sd-subject-panel">
          <div className="sd-panel-heading">
            <div>
              <span className="sd-panel-kicker">
                YOUR CLASSES
              </span>
              <h3>Subject attendance</h3>
            </div>
          </div>

          {loading ? (
            <div className="sd-empty">
              Calculating your attendance…
            </div>
          ) : subjectSummary.length === 0 ? (
            <div className="sd-empty">
              <span className="sd-empty-icon">
                <BookOpen size={22} />
              </span>

              <strong>No subject records yet</strong>

              <p>
                Your subject summary appears after
                attendance records are available.
              </p>
            </div>
          ) : (
            <div className="sd-subject-list">
              {subjectSummary.map((subject) => (
                <div
                  className="sd-subject-item"
                  key={subject.name}
                >
                  <div className="sd-subject-copy">
                    <strong>{subject.name}</strong>
                    <span>
                      {subject.attended} of {subject.total} classes
                    </span>
                  </div>

                  <div className="sd-progress-track">
                    <span
                      style={{
                        width: `${subject.percentage}%`,
                      }}
                    />
                  </div>

                  <strong className="sd-subject-percent">
                    {subject.percentage}%
                  </strong>
                </div>
              ))}
            </div>
          )}

          <div className="sd-subject-footer">
            <span>Recommended target</span>
            <strong>75% attendance</strong>
          </div>
        </article>
      </section>

      <section className="sd-panel sd-history-panel">
        <div className="sd-panel-heading">
          <div>
            <span className="sd-panel-kicker">
              RECENT ACTIVITY
            </span>

            <h3>Attendance history</h3>

            <p>
              Latest records available for your account.
            </p>
          </div>

          <Link to="/student/attendance">
            View full history <ArrowRight size={14} />
          </Link>
        </div>

        {loading ? (
          <div className="sd-empty">
            Loading attendance history…
          </div>
        ) : records.length === 0 ? (
          <div className="sd-empty">
            <span className="sd-empty-icon">
              <CalendarCheck2 size={22} />
            </span>

            <strong>No attendance records yet</strong>

            <p>
              Your records will appear here after
              a session has been marked.
            </p>
          </div>
        ) : (
          <div className="sd-table-wrap">
            <table className="sd-table">
              <thead>
                <tr>
                  <th>Class / session</th>
                  <th>Subject</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Method</th>
                  <th>Status</th>
                </tr>
              </thead>

              <tbody>
                {records.slice(0, 7).map((record, index) => {
                  const status = String(
                    record.status || "unknown"
                  ).toLowerCase();

                  return (
                    <tr
                      key={
                        record.id ??
                        `${record.title}-${record.verified_at}-${index}`
                      }
                    >
                      <td>
                        <strong>
                          {record.title ||
                            record.class_name ||
                            "Class session"}
                        </strong>

                        {record.section && (
                          <small>{record.section}</small>
                        )}
                      </td>

                      <td>{record.subject_name || "—"}</td>

                      <td>
                        {formatDate(
                          record.verified_at || record.starts_at
                        )}
                      </td>

                      <td>
                        {formatTime(
                          record.verified_at || record.starts_at
                        )}
                      </td>

                      <td>
                        <span className="sd-method">
                          {String(record.method || "—").replaceAll(
                            "_",
                            " "
                          )}
                        </span>
                      </td>

                      <td>
                        <span
                          className={`sd-status-badge ${status}`}
                        >
                          {statusName(status)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="sd-footer-note">
        <CheckCircle2 size={15} />

        Attendance data reflects records returned by
        your AttendX account.

        {lastUpdated
          ? ` Updated at ${lastUpdated.toLocaleTimeString(
              undefined,
              {
                hour: "2-digit",
                minute: "2-digit",
              }
            )}.`
          : ""}
      </div>
    </div>
  );
}
