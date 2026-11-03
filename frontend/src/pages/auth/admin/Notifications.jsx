import React, { useCallback, useEffect, useState } from "react";
import {
  getNotificationHistory,
  markNotificationRead,
} from "../../../services/notifications";
import { getApiErrorMessage } from "../../../utils/errors.js";
import "./Notifications.css";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

export default function Notifications() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getNotificationHistory();
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to load your notifications."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const markRead = async (row) => {
    setUpdatingId(row.id);
    setError("");
    try {
      await markNotificationRead(row.id);
      setRows((current) => current.map((item) =>
        item.id === row.id ? { ...item, read_at: item.read_at || new Date().toISOString() } : item
      ));
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to mark this notification as read."));
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="notifications-page">
      <header className="notifications-header">
        <div>
          <span>ACCOUNT NOTIFICATIONS</span>
          <h1>Notification History</h1>
          <p>Events addressed to your signed-in account. Queued delivery is not a confirmation of SMS or email delivery.</p>
        </div>
        <button type="button" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </header>

      {error && <div className="notifications-alert" role="alert">{error}</div>}

      <section className="notifications-card">
        <table>
          <thead>
            <tr><th>Event</th><th>Channel</th><th>Details</th><th>Delivery</th><th>Read</th><th>Created</th><th>Action</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.title || row.event_type || "—"}</td>
                <td>{row.channel || "—"}</td>
                <td>{row.message || "—"}</td>
                <td>{row.delivery_status || "—"}</td>
                <td>{row.read_at ? "Read" : "Unread"}</td>
                <td>{formatDate(row.created_at)}</td>
                <td>
                  {!row.read_at && (
                    <button type="button" onClick={() => markRead(row)} disabled={updatingId === row.id}>
                      {updatingId === row.id ? "Saving…" : "Mark read"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan="7" className="notifications-empty">No notification events are available for this account.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
