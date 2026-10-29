import React, {
  useEffect,
  useState,
} from "react";
import {
  getNotificationHistory,
} from "../../services/notifications";
import "./Notifications.css";

export default function Notifications() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");

    try {
      const data =
        await getNotificationHistory();

      setRows(
        Array.isArray(data) ? data : []
      );
    } catch (e) {
      setError(
        e?.response?.data?.detail ||
          "Unable to load notification history."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="notifications-page">
      <header className="notifications-header">
        <div>
          <span>
            COMMUNICATION CENTER
          </span>

          <h1>Notification History</h1>

          <p>
            Track absence and low-attendance
            alert records stored by AttendX.
          </p>
        </div>

        <button onClick={load}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </header>

      {error && (
        <div className="notifications-alert">
          {error}
        </div>
      )}

      <section className="notifications-card">
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Channel</th>
              <th>Recipient</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  {row.event_type || "—"}
                </td>

                <td>
                  {row.channel || "—"}
                </td>

                <td>
                  {row.recipient || "—"}
                </td>

                <td>
                  {row.subject || "—"}
                </td>

                <td>
                  {row.status || "—"}
                </td>

                <td>
                  {row.created_at
                    ? new Date(
                        row.created_at
                      ).toLocaleString()
                    : "—"}
                </td>
              </tr>
            ))}

            {!loading && rows.length === 0 && (
              <tr>
                <td
                  colSpan="6"
                  className="notifications-empty"
                >
                  No notification records returned.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}