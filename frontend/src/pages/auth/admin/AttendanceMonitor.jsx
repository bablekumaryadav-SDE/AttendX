import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getAttendanceSessions,
  getLiveAttendance,
} from "../../../services/attendance";
import "./AttendanceMonitor.css";
import { getApiErrorMessage } from "../../../utils/errors.js";

export default function AttendanceMonitor() {
  const [sessions, setSessions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [liveLoading, setLiveLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [liveError, setLiveError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setSessionsError("");

    try {
      const data = await getAttendanceSessions();

      const list = Array.isArray(data) ? data : [];

      setSessions(list);
      setSelected((current) =>
        list.find((session) => session.id === current?.id) ||
        list[0] ||
        null
      );
    } catch (e) {
      setSessionsError(
        getApiErrorMessage(e, "Unable to load attendance sessions.")
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLive = useCallback(async (session) => {
    if (!session) return;

    setLiveLoading(true);

    try {
      const data = await getLiveAttendance(
        session.id
      );

      setRows(Array.isArray(data) ? data : []);
      setLiveError("");
    } catch (e) {
      setRows([]);
      setLiveError(
        getApiErrorMessage(e, "Unable to load live attendance.")
      );
    } finally {
      setLiveLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (selected) {
      loadLive(selected);
    } else {
      setRows([]);
      setLiveError("");
      setLiveLoading(false);
    }
  }, [selected, loadLive]);

  useEffect(() => {
    if (
      !selected ||
      selected.status !== "active"
    ) {
      return undefined;
    }

    const timer = setInterval(
      () => loadLive(selected),
      5000
    );

    return () => clearInterval(timer);
  }, [selected, loadLive]);

  const counts = useMemo(
    () => ({
      total: rows.length,
      present: rows.filter(
        (r) => r.status === "present"
      ).length,
      late: rows.filter(
        (r) => r.status === "late"
      ).length,
      absent: rows.filter(
        (r) => r.status === "absent"
      ).length,
      pending: rows.filter(
        (r) => r.status === "pending" || r.attendance_id == null
      ).length,
      recorded: rows.filter(
        (r) => r.attendance_id != null
      ).length,
    }),
    [rows]
  );

  return (
    <div className="monitor-page">
      <header className="monitor-header">
        <div>
          <span>ATTENDANCE OPERATIONS</span>

          <h1>Attendance Monitor</h1>

          <p>
            Watch active sessions and their
            PostgreSQL-backed attendance events.
          </p>
        </div>

        <button type="button" onClick={load} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {sessionsError && (
        <div className="monitor-alert" role="alert">
          {sessionsError}
        </div>
      )}
      {liveError && (
        <div className="monitor-alert" role="alert">
          {liveError}
        </div>
      )}

      <div className="monitor-layout">
        <aside className="monitor-sessions">
          <div className="monitor-side-title">
            Sessions <b>{sessions.length}</b>
          </div>

          {loading ? (
            <div className="monitor-empty">
              Loading…
            </div>
          ) : (
            sessions.map((session) => (
              <button
                key={session.id}
                className={
                  selected?.id === session.id
                    ? "selected"
                    : ""
                }
                onClick={() =>
                  {
                    setRows([]);
                    setLiveError("");
                    setSelected(session);
                  }
                }
              >
                <strong>
                  {session.title}
                </strong>

                <span>
                  {session.subject_name ||
                    `Subject #${session.subject_id}`}
                </span>

                <em
                  className={session.status}
                >
                  {session.status}
                </em>
              </button>
            ))
          )}

          {!loading &&
            sessions.length === 0 && (
              <div className="monitor-empty">
                No sessions.
              </div>
            )}
        </aside>

        <main className="monitor-main">
          {selected ? (
            <>
              <div className="monitor-title">
                <div>
                  <span>
                    SELECTED SESSION
                  </span>

                  <h2>{selected.title}</h2>

                  <p>
                    {selected.class_name ||
                      `Class #${selected.class_id}`}{" "}
                    ·{" "}
                    {selected.section || "—"}
                  </p>
                </div>

                <b
                  className={`monitor-pill ${selected.status}`}
                >
                  {selected.status}
                </b>
              </div>

              <div className="monitor-stats">
                <div>
                  <span>Total</span>
                  <strong>
                    {counts.total}
                  </strong>
                </div>

                <div>
                  <span>Present</span>
                  <strong>
                    {counts.present}
                  </strong>
                </div>

                <div>
                  <span>Late</span>
                  <strong>
                    {counts.late}
                  </strong>
                </div>

                <div>
                  <span>Absent</span>
                  <strong>
                    {counts.absent}
                  </strong>
                </div>
              </div>

              {counts.pending > 0 && (
                <div className="monitor-loading" role="status">
                  {counts.pending} students have not been marked yet.
                </div>
              )}

              <div className="monitor-table-wrap">
                {counts.recorded === 0 && !liveLoading && !liveError && (
                  <div className="monitor-empty">
                    {rows.length === 0
                      ? "No active students are enrolled in this class."
                      : "No attendance records for this session yet."}
                    {counts.pending > 0 && (
                      <div>{counts.pending} students are still pending.</div>
                    )}
                  </div>
                )}
                <table>
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Roll</th>
                      <th>Status</th>
                      <th>Method</th>
                      <th>Verified</th>
                    </tr>
                  </thead>

                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.student_id}
                      >
                        <td>
                          <strong>
                            {row.name}
                          </strong>

                          <small>
                            {row.student_code ||
                              "—"}
                          </small>
                        </td>

                        <td>
                          {row.roll_number ||
                            "—"}
                        </td>

                        <td>
                          <span
                            className={`monitor-status ${row.status}`}
                          >
                            {row.status === "pending"
                              ? "Pending"
                              : row.status}
                          </span>
                        </td>

                        <td>
                          {row.method || "—"}
                        </td>

                        <td>
                          {row.verified_at
                            ? new Date(
                                row.verified_at
                              ).toLocaleTimeString()
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {liveLoading && (
                  <div className="monitor-loading">
                    Updating live records…
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="monitor-empty large">
              Select an attendance session.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
