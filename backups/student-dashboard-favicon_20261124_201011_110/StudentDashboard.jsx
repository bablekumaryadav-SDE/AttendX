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
  getMyStudentAcademics,
  getMyFaceStatus,
  getMyAttendance,
  submitStudentFaceAttendance,
  submitStudentQrAttendance,
} from "../../services/attendance";

import "./StudentDashboard.css";
import { getApiErrorMessage, uniqueApiErrorMessages } from "../../utils/errors";
import { acquireCameraStreamSafely } from "../../utils/cameraLifecycle";
import { stopCameraStream } from "../../utils/cameraAccess";
import { getFreshAttendanceLocation } from "../../utils/attendanceLocation";
import { getTenantCollegeProfile } from "../../services/tenant";

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
  if (!error?.response && (error?.code === "ERR_NETWORK" || error?.message === "Network Error")) {
    return "AttendX could not reach the backend. Check the connection and retry.";
  }
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
  const { user, activeCollegeId } = useAuth();

  const [records, setRecords] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [academics, setAcademics] = useState(null);
  const [faceStatus, setFaceStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [attendanceHistoryStatus, setAttendanceHistoryStatus] = useState("loading");
  const [sessionsStatus, setSessionsStatus] = useState("loading");
  const [faceStatusLoadState, setFaceStatusLoadState] = useState("loading");
  const [academicsStatus, setAcademicsStatus] = useState("loading");
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
  const attendanceSubmissionRef = useRef(false);
  const dashboardRequestRef = useRef(0);
  const dashboardScopeRef = useRef(null);
  const cameraRequestVersionRef = useRef(0);
  const mountedRef = useRef(false);
  const lastAutoRefreshAtRef = useRef(0);

  const selectedAttendanceSession = sessionsStatus === "ready" ? sessions.find(
    (session) => String(session.id) === String(selectedAttendanceSessionId)
  ) || null : null;
  const noEligibleSessionMessage = sessionsStatus === "error"
    ? "Active sessions are unavailable. Refresh to retry."
    : error.toLowerCase().includes("no active class enrollment")
    ? "A class assignment is required before eligible sessions can be shown."
    : "Waiting for your teacher to start attendance.";

  const loadDashboard = useCallback(async (silent = false) => {
    const requestId = ++dashboardRequestRef.current;
    const requestCollegeId = activeCollegeId;
    const requestScope = `${user?.id ?? ""}:${activeCollegeId ?? ""}`;
    if (dashboardScopeRef.current !== requestScope) {
      dashboardScopeRef.current = requestScope;
      setRecords([]);
      setSessions([]);
      setAcademics(null);
      setFaceStatus(null);
      setSelectedAttendanceSessionId("");
      setAttendanceHistoryStatus(activeCollegeId ? "loading" : "idle");
      setSessionsStatus(activeCollegeId ? "loading" : "idle");
      setFaceStatusLoadState(activeCollegeId ? "loading" : "idle");
      setAcademicsStatus(activeCollegeId ? "loading" : "idle");
    }
    if (!activeCollegeId) {
      setRecords([]);
      setSessions([]);
      setAcademics(null);
      setFaceStatus(null);
      setAttendanceHistoryStatus("idle");
      setSessionsStatus("idle");
      setFaceStatusLoadState("idle");
      setAcademicsStatus("idle");
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setAttendanceHistoryStatus("loading");
    }

    setError("");
    try {
      const [historyResult, sessionsResult, faceResult, academicsResult] =
        await Promise.allSettled([
          getMyAttendance(activeCollegeId),
          getActiveStudentSessions(activeCollegeId),
          getMyFaceStatus(activeCollegeId),
          getMyStudentAcademics(activeCollegeId),
        ]);

      if (dashboardRequestRef.current !== requestId || String(requestCollegeId) !== String(activeCollegeId)) return;

      if (historyResult.status === "fulfilled") {
        setRecords(toList(historyResult.value, ["records", "items", "attendance"]));
        setAttendanceHistoryStatus("ready");
      } else {
        setRecords([]);
        setAttendanceHistoryStatus("error");
      }

      if (sessionsResult.status === "fulfilled") {
        setSessions(toList(sessionsResult.value, ["sessions", "items", "active_sessions"]));
        setSessionsStatus("ready");
      } else {
        setSessions([]);
        setSessionsStatus("error");
      }

      if (faceResult.status === "fulfilled") {
        setFaceStatus(faceResult.value);
        setFaceStatusLoadState("ready");
      } else {
        setFaceStatus(null);
        setFaceStatusLoadState("error");
      }
      if (academicsResult.status === "fulfilled") {
        setAcademics(academicsResult.value);
        setAcademicsStatus("ready");
      } else {
        setAcademics(null);
        setAcademicsStatus("error");
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
      if (academicsResult.status === "rejected") {
        errors.push(getErrorMessage(academicsResult.reason, "Your class and Subject assignments could not be loaded."));
      }
      if (errors.length) setError(uniqueApiErrorMessages(errors));
      setLastUpdated(new Date());
    } catch (loadError) {
      if (dashboardRequestRef.current !== requestId || String(requestCollegeId) !== String(activeCollegeId)) return;
      setRecords([]);
      setSessions([]);
      setFaceStatus(null);
      setAcademics(null);
      setAttendanceHistoryStatus("error");
      setSessionsStatus("error");
      setFaceStatusLoadState("error");
      setAcademicsStatus("error");
      setError(getErrorMessage(loadError, "Student attendance data could not be loaded."));
    } finally {
      if (dashboardRequestRef.current === requestId) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [activeCollegeId, user?.id]);

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
    cameraRequestVersionRef.current += 1;
    if (scanTimerRef.current) {
      window.clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    stopCameraStream(cameraStreamRef.current);
    cameraStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      dashboardRequestRef.current += 1;
      cameraRequestVersionRef.current += 1;
      if (scanTimerRef.current) window.clearInterval(scanTimerRef.current);
      stopCameraStream(cameraStreamRef.current);
      cameraStreamRef.current = null;
    };
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
    stopCamera();
    const requestVersion = cameraRequestVersionRef.current;
    try {
      const stream = await acquireCameraStreamSafely({
        getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
        constraints: {
          video: {
            facingMode: method === "qr" ? { ideal: "environment" } : { ideal: "user" },
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        },
        isCurrent: () => mountedRef.current && cameraRequestVersionRef.current === requestVersion,
      });
      if (!stream) return;
      cameraStreamRef.current = stream;
      setCameraActive(true);
    } catch (cameraError) {
      if (!mountedRef.current || cameraRequestVersionRef.current !== requestVersion) return;
      setCameraActive(false);
      setError(cameraError?.name === "NotAllowedError"
        ? "Camera permission was denied. Allow camera access and try again."
        : cameraError?.name === "NotFoundError"
          ? "No camera was found on this device."
          : "Unable to open the camera. Close other apps using it and retry.");
    }
  };

  const getSessionCoordinates = async (session) => {
    if (session?.latitude == null || session?.longitude == null) {
      throw new Error("Attendance location is not configured for this session. Ask your College Admin or Teacher to configure the classroom location.");
    }
    const requestCollegeId = activeCollegeId;
    const profile = await getTenantCollegeProfile(requestCollegeId);
    return getFreshAttendanceLocation(undefined, profile.gps_accuracy_limit_m);
  };

  const handleScannedQr = useCallback(async (rawValue) => {
    if (scanBusyRef.current || attendanceSubmissionRef.current) return;
    scanBusyRef.current = true;
    attendanceSubmissionRef.current = true;
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
        accuracy_m: coordinates?.accuracy ?? null,
      }, activeCollegeId);
      setNotice(result?.message || "Attendance recorded successfully.");
      setSessions((current) => current.map((item) => String(item.id) === String(session.id)
        ? { ...item, already_attended: true }
        : item));
      await loadDashboard(true);
    } catch (scanError) {
      setError(getErrorMessage(scanError, "QR attendance could not be recorded."));
    } finally {
      scanBusyRef.current = false;
      attendanceSubmissionRef.current = false;
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
        if (import.meta.env.DEV) console.warn("QR frame decode failed:", scanError);
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

  const submitFaceCapture = async (capture, alreadyLocked = false) => {
    if (!capture?.file || !selectedAttendanceSession) return;
    if (selectedAttendanceSession.already_attended) {
      setError("Attendance already marked for this session.");
      return;
    }
    if (!alreadyLocked && (attendanceSubmissionRef.current || faceSubmitting)) return;
    if (!alreadyLocked) {
      attendanceSubmissionRef.current = true;
      setFaceSubmitting(true);
    }
    setError("");
    setNotice("");
    try {
      const result = await submitStudentFaceAttendance(selectedAttendanceSession.id, capture.file, null, activeCollegeId);
      setNotice(result?.message || "Face recognized successfully. Your attendance has been marked PRESENT.");
      if (capture.preview) URL.revokeObjectURL(capture.preview);
      setFaceCapture(null);
      setSessions((current) => current.map((item) => String(item.id) === String(selectedAttendanceSession.id)
        ? { ...item, already_attended: true }
        : item));
      setCameraMethod(null);
      await loadDashboard(true);
    } catch (faceError) {
      if (faceError?.response?.status === 409) {
        if (capture.preview) URL.revokeObjectURL(capture.preview);
        setFaceCapture(null);
        setCameraMethod(null);
        setSessions((current) => current.map((item) => String(item.id) === String(selectedAttendanceSession.id)
          ? { ...item, already_attended: true }
          : item));
        await loadDashboard(true);
        setError("Attendance was already recorded for this session. Your dashboard has been refreshed.");
        return;
      }
      setError(getErrorMessage(faceError, "Face attendance could not be recorded."));
    } finally {
      if (!alreadyLocked) {
        attendanceSubmissionRef.current = false;
        setFaceSubmitting(false);
      }
    }
  };

  const captureFace = async () => {
    if (attendanceSubmissionRef.current || faceSubmitting) return;
    if (!selectedAttendanceSession || selectedAttendanceSession.already_attended) return;
    attendanceSubmissionRef.current = true;
    setFaceSubmitting(true);
    setError("");
    setNotice("");
    try {
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
      const capture = {
        file: new File([blob], "attendance-face.jpg", { type: "image/jpeg" }),
        preview: URL.createObjectURL(blob),
      };
      setFaceCapture(capture);
      stopCamera();
      setNotice("Face captured. Verifying your identity and attendance location…");
      await submitFaceCapture(capture, true);
    } catch (captureError) {
      setError(getErrorMessage(captureError, "The camera frame could not be captured. Please retry."));
    } finally {
      attendanceSubmissionRef.current = false;
      setFaceSubmitting(false);
    }
  };

  const verifyFace = () => submitFaceCapture(faceCapture);

  const closeCameraDialog = () => {
    stopCamera();
    setCameraMethod(null);
    if (faceCapture?.preview) URL.revokeObjectURL(faceCapture.preview);
    setFaceCapture(null);
  };

  useEffect(() => {
    const refreshVisibleDashboard = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastAutoRefreshAtRef.current < 1000) return;
      lastAutoRefreshAtRef.current = now;
      loadDashboard(true);
    };
    window.addEventListener("focus", refreshVisibleDashboard);
    document.addEventListener("visibilitychange", refreshVisibleDashboard);
    return () => {
      window.removeEventListener("focus", refreshVisibleDashboard);
      document.removeEventListener("visibilitychange", refreshVisibleDashboard);
    };
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

  const hasNoAttendanceData = attendanceHistoryStatus === "ready" && summary.total === 0;
  const attendanceHistoryUnavailable = attendanceHistoryStatus === "error";
  const faceRegistrationUnavailable = faceStatusLoadState !== "ready" || faceStatus?.status === "unavailable";
  const faceRegistered = !faceRegistrationUnavailable && Boolean(faceStatus?.face_registered);
  const sessionSelectorPlaceholder = sessionsStatus === "error" ? "Sessions unavailable" : sessions.length ? "Select an active session" : "No active sessions";
  const attendanceRateDisplay = attendanceHistoryStatus === "ready" && summary.total > 0
    ? `${summary.percentage}%`
    : attendanceHistoryStatus === "error"
      ? "Unavailable"
      : "—";
  const attendanceRateRingDisplay = attendanceHistoryStatus === "ready" && summary.total > 0
    ? `${summary.percentage}%`
    : "—";

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

  const enrolledSubjectCount = useMemo(() => {
    const subjectIds = (academics?.enrollments || []).flatMap((enrollment) =>
      (enrollment.subjects || []).map((subject) => subject.id).filter((id) => id != null)
    );
    return new Set(subjectIds.map(String)).size;
  }, [academics]);

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
        <aside className="sd-standing-snapshot" aria-label="Attendance standing">
          <span className="sd-snapshot-kicker">ATTENDANCE STANDING</span>
          <div className="sd-standing-reading">
            <div className="sd-standing-ring" style={{ "--sd-ring": `${summary.percentage}%` }}>
              <strong>{attendanceRateRingDisplay}</strong>
            </div>
            <div>
              <strong>
                {loading || attendanceHistoryStatus === "loading"
                  ? "Loading history"
                  : hasNoAttendanceData
                    ? "No attendance data yet"
                    : attendanceHistoryStatus === "error"
                      ? "Attendance history unavailable"
                      : attendanceHistoryStatus === "idle"
                        ? "Select an active College"
                        : `${summary.attended} classes attended`}
              </strong>
              <span>{hasNoAttendanceData ? "Your attendance summary will appear after your first recorded class." : "Present + late in loaded records"}</span>
            </div>
          </div>
          <Link to="/student/attendance">View attendance history <ArrowRight size={13} /></Link>
        </aside>
      </section>

      {error && !cameraMethod && (
        <div className="sd-alert" role="alert">
          <ShieldAlert size={18} />
          <span>{error}</span>
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
              {attendanceRateDisplay}
            </strong>

            <small>
              {hasNoAttendanceData
                ? "No attendance data yet"
                : attendanceHistoryStatus === "error"
                  ? "Attendance history unavailable"
                  : "Present + late classes"}
            </small>
          </div>

          <div
            className="sd-stat-ring"
            style={{
              "--sd-ring": `${summary.percentage}%`,
            }}
          >
            <span>
              {attendanceRateRingDisplay}
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
              {loading ? "?" : attendanceHistoryStatus === "ready" ? summary.attended : "Unavailable"}
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
              {loading ? "?" : attendanceHistoryStatus === "ready" ? summary.absent : "Unavailable"}
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
              {loading ? "?" : sessionsStatus === "ready" ? sessions.length : "Unavailable"}
            </strong>

            <small>Available to join now</small>
          </div>
        </article>
        <article className="sd-stat-card">
          <span className="sd-stat-icon purple"><BookOpen size={20} /></span>
          <div>
            <span className="sd-stat-label">Enrolled subjects</span>
            <strong>{loading ? "—" : academics ? enrolledSubjectCount : "Unavailable"}</strong>
            <small>From active College enrollments</small>
          </div>
        </article>
      </section>

      <section className="sd-panel sd-academics" aria-label="My Classes and Subjects">
        <div className="sd-academics-heading">
          <div>
            <span className="sd-panel-kicker">ACADEMIC PROFILE</span>
            <h3>My Classes &amp; Subjects</h3>
          </div>
          <Link to="/student/attendance">Attendance history <ArrowRight size={14} /></Link>
        </div>
        {loading ? <div className="sd-academics-state" role="status">Loading your active class enrollment…</div>
          : academicsStatus !== "ready" || !academics ? <div className="sd-academics-state" role="status">Class and Subject assignments are unavailable. Refresh to retry.</div>
            : !academics.enrollments?.length ? <div className="sd-academics-state" role="status">No active College class enrollment is available. Ask your College Admin to assign your Class.</div>
              : <div className="sd-academic-list">{academics.enrollments.map((enrollment) => <article className="sd-academic-card" key={enrollment.class_id}>
                <div className="sd-academic-title">
                  <strong>{enrollment.class_name}{enrollment.section ? ` · ${enrollment.section}` : ""}</strong>
                  <span>{enrollment.department || "Department unavailable"}{enrollment.semester != null ? ` · Semester ${enrollment.semester}` : ""}{enrollment.academic_year ? ` · ${enrollment.academic_year}` : ""}</span>
                  {enrollment.effective_from && <small>Enrolled {formatDate(enrollment.effective_from)}</small>}
                </div>
                {enrollment.subjects?.length ? <ul className="sd-subject-list">{enrollment.subjects.map((subject) => <li key={`${subject.id}-${subject.academic_year}-${subject.semester}`}>
                  <strong>{subject.name}</strong><span>{subject.code || "Code unavailable"}{subject.department ? ` · ${subject.department}` : ""}{subject.semester != null ? ` · Semester ${subject.semester}` : ""}{subject.academic_year ? ` · ${subject.academic_year}` : ""}</span>
                </li>)}</ul> : <p className="sd-academics-state">No active Subjects are assigned to this Class yet.</p>}
              </article>)}</div>}
      </section>

      {summary.total > 0 &&
        attendanceHistoryStatus === "ready" &&
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
          <p>{faceRegistrationUnavailable ? "Face registration status could not be checked. Refresh to retry." : faceRegistered ? "Your registered face reference is ready for verification." : "Your face is not registered. Please register your face first."}</p>
        </div>
        <span className={`sd-session-status ${faceRegistered ? "done" : "open"}`}>
          {loading || faceStatusLoadState === "loading" ? "Checking..." : faceRegistrationUnavailable ? "Unavailable" : faceRegistered ? "Registered" : "Not registered"}
        </span>
        {faceRegistered ? (
          <Link to="/student/attendance">Open attendance <ArrowRight size={14} /></Link>
        ) : faceStatusLoadState === "ready" && faceStatus?.status !== "unavailable" ? (
          <Link to="/student/attendance" state={{ method: "register-face" }}>Register My Face <ArrowRight size={14} /></Link>
        ) : (
          <span className="sd-empty" role="status">Retry face status from the dashboard.</span>
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
              <option value="">{sessionSelectorPlaceholder}</option>
              {sessionsStatus === "ready" && sessions.map((session) => <option key={session.id} value={session.id}>{session.title || session.subject_name} · {session.class_name} · {session.teacher_name || "Teacher"}</option>)}
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
              <p>Face status: <strong>{loading || faceStatusLoadState === "loading" ? "Checking..." : faceRegistrationUnavailable ? "Unavailable" : faceRegistered ? "Registered" : "Not Registered"}</strong></p>
            </div>
            <select aria-label="Select session for face attendance" value={selectedAttendanceSessionId} onChange={(event) => setSelectedAttendanceSessionId(event.target.value)}>
              <option value="">{sessionSelectorPlaceholder}</option>
              {sessionsStatus === "ready" && sessions.map((session) => <option key={session.id} value={session.id}>{session.title || session.subject_name} · {session.class_name} · {session.teacher_name || "Teacher"}</option>)}
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
            {faceRegistered ? (
              <button type="button" onClick={() => openCamera("face")} disabled={!selectedAttendanceSession || Boolean(selectedAttendanceSession?.already_attended)}>
                Open Face Camera <ArrowRight size={15} />
              </button>
            ) : faceStatusLoadState === "ready" && faceStatus?.status !== "unavailable" ? (
              <Link to="/student/attendance" state={{ method: "register-face" }}>
                Register My Face <ArrowRight size={15} />
              </Link>
            ) : (
              <button type="button" disabled>Face status unavailable</button>
            )}
          </article>
        </div>
        {!loading && sessionsStatus === "ready" && sessions.length === 0 && !error && (
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
              <p className="sd-no-active-attendance">{sessionsStatus === "error" ? "Active sessions are unavailable. Refresh the dashboard to retry. Camera attendance submission is disabled." : "No active attendance session. Please wait for your teacher to start attendance. Camera preview is available; attendance submission is disabled."}</p>
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
                  <button type="button" className="primary" onClick={captureFace} disabled={!selectedAttendanceSession || selectedAttendanceSession.already_attended || faceSubmitting}>Capture Face &amp; Mark Attendance</button>
                )
              ) : cameraMethod === "qr" ? (
                <button type="button" className="primary" onClick={() => openCamera("qr")}>Open QR Scanner</button>
              ) : faceCapture ? (
                <>
                  <button type="button" className="secondary" onClick={() => { setFaceCapture(null); openCamera("face"); }}>Retake</button>
                  <button type="button" className="primary" onClick={verifyFace} disabled={!selectedAttendanceSession || selectedAttendanceSession.already_attended || faceSubmitting || !faceCapture?.file}>
                    {faceSubmitting ? "Verifying face…" : "Retry Face Verification"}
                  </button>
                </>
              ) : (
                <button type="button" className="primary" onClick={() => openCamera("face")}>Open Face Camera</button>
              )}
            </div>
            {cameraMethod === "face" && faceStatusLoadState === "ready" && !faceRegistered && (
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
          ) : sessionsStatus === "error" ? (
            <div className="sd-empty" role="status">Active sessions are unavailable. Refresh to retry.</div>
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
          ) : attendanceHistoryUnavailable ? (
            <div className="sd-empty" role="status">Subject attendance is unavailable. Refresh to retry.</div>
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
        ) : attendanceHistoryUnavailable ? (
          <div className="sd-empty" role="status">Attendance history is unavailable. Refresh to retry.</div>
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
                          record.verified_at || record.date || record.starts_at
                        )}
                      </td>

                      <td>
                        {formatTime(
                          record.verified_at || record.date || record.starts_at
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
