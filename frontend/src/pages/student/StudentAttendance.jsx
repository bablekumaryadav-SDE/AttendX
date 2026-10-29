import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  getActiveStudentSessions,
  getMyAttendance,
  submitStudentQrAttendance,
} from "../../services/attendance";

import "./StudentAttendance.css";


function getErrorMessage(error, fallback) {
  return (
    error?.response?.data?.detail ||
    error?.message ||
    fallback
  );
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
  const [sessions, setSessions] = useState([]);
  const [records, setRecords] = useState([]);

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
  const streamRef = useRef(null);
  const scannerTimerRef = useRef(null);


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
        ] = await Promise.all([
          getActiveStudentSessions(),
          getMyAttendance(),
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
      } catch (error) {
        console.error(
          "Student attendance loading failed:",
          error
        );

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
    setScannerSupported(
      "BarcodeDetector" in window
    );
  }, []);


  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, []);


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
      console.error(
        "Student attendance submission failed:",
        error
      );

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

    if (!("BarcodeDetector" in window)) {
      setError(
        "QR camera scanning is not supported by this browser. Use the QR token field below."
      );

      return;
    }

    try {
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

      const detector =
        new window.BarcodeDetector({
          formats: ["qr_code"],
        });

      scannerTimerRef.current =
        window.setInterval(
          async () => {
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
              const barcodes =
                await detector.detect(
                  videoRef.current
                );

              if (
                barcodes.length > 0 &&
                barcodes[0].rawValue
              ) {
                const scanned =
                  barcodes[0].rawValue.trim();

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
          : "Unable to access the camera."
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


        <section className="student-live-attendance">

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
                      Attendance already recorded
                    </strong>

                    <span>
                      You cannot submit another
                      attendance event for this
                      session.
                    </span>
                  </div>

                </div>

              ) : (

                <div className="student-verification-grid">

                  <div className="student-scanner-card">

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