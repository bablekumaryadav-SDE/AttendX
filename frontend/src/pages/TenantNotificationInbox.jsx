import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bell, CheckCheck, RefreshCw } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import {
  getTenantUnreadNotificationCount,
  listTenantNotifications,
  markAllTenantNotificationsRead,
  markTenantNotificationRead,
} from "../services/tenantNotifications";
import "./TenantNotificationInbox.css";

function notificationError(error) {
  const status = error?.response?.status;
  if (status === 401) return "Your session expired. Sign in again.";
  if (status === 403) return "Your active College membership does not allow access to this inbox.";
  if (status === 404 || status === 503) return "The tenant notification API or required College schema is not deployed and verified.";
  if (status === 422) return "The notification request was not accepted. Refresh and retry.";
  if (!error?.response) return "The notification service could not be reached.";
  return "Notifications could not be loaded. Retry shortly.";
}

export default function TenantNotificationInbox() {
  const { user, activeCollegeId } = useAuth();
  const authenticatedUserId = user?.user_id ?? user?.id;
  const requestRef = useRef(0);
  const scope = `${authenticatedUserId ?? ""}:${activeCollegeId ?? ""}`;
  const activeScopeRef = useRef(scope);
  activeScopeRef.current = scope;
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useLayoutEffect(() => {
    requestRef.current += 1;
    setItems([]);
    setTotal(0);
    setUnreadCount(null);
    setNotice("");
    setError("");
    setLoading(Boolean(activeCollegeId));
    setSaving(false);
  }, [authenticatedUserId, activeCollegeId]);

  const refresh = useCallback(async () => {
    const requestId = ++requestRef.current;
    const requestScope = scope;
    setItems([]);
    setTotal(0);
    setUnreadCount(null);
    setNotice("");
    if (!activeCollegeId) {
      setLoading(false);
      setError("Select an active College membership to load this inbox.");
      return;
    }
    setLoading(true);
    setError("");
    const results = await Promise.allSettled([
      listTenantNotifications(activeCollegeId, unreadOnly ? { unread: true } : {}, { limit: 25, offset }),
      getTenantUnreadNotificationCount(activeCollegeId),
    ]);
    if (requestRef.current !== requestId || activeScopeRef.current !== requestScope) return;
    const [pageResult, countResult] = results;
    if (pageResult.status === "rejected") {
      setItems([]);
      setTotal(0);
      setUnreadCount(null);
      setError(notificationError(pageResult.reason));
      setLoading(false);
      return;
    }
    const page = pageResult.value;
    if (!Array.isArray(page?.items) || !Number.isSafeInteger(page?.total)) {
      setItems([]);
      setTotal(0);
      setUnreadCount(null);
      setError("The notification service returned an invalid page response. Refresh and retry.");
      setLoading(false);
      return;
    }
    setItems(page.items);
    setTotal(page.total);
    setUnreadCount(countResult.status === "fulfilled" && Number.isSafeInteger(countResult.value?.unread_count)
      ? countResult.value.unread_count : null);
    setLoading(false);
  }, [activeCollegeId, authenticatedUserId, unreadOnly, offset]);

  useEffect(() => { setOffset(0); }, [activeCollegeId, unreadOnly]);
  useEffect(() => {
    void refresh();
    return () => { requestRef.current += 1; };
  }, [refresh]);

  const markRead = async (item) => {
    if (!activeCollegeId || saving || item.read_at) return;
    const scopeAtStart = scope;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await markTenantNotificationRead(activeCollegeId, item.id);
      if (activeScopeRef.current !== scopeAtStart) return;
      setItems((current) => current.map((entry) => entry.id === saved.id ? saved : entry));
      setUnreadCount((count) => count == null ? null : Math.max(0, count - 1));
      setNotice("Notification marked as read.");
    } catch (requestError) {
      if (activeScopeRef.current === scopeAtStart) setError(notificationError(requestError));
    } finally {
      if (activeScopeRef.current === scopeAtStart) setSaving(false);
    }
  };

  const markAllRead = async () => {
    if (!activeCollegeId || saving || !items.some((item) => !item.read_at)) return;
    const scopeAtStart = scope;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await markAllTenantNotificationsRead(activeCollegeId);
      if (activeScopeRef.current !== scopeAtStart) return;
      if (Number.isSafeInteger(result?.updated)) {
        setUnreadCount((count) => count == null ? null : Math.max(0, count - result.updated));
      }
      await refresh();
      setNotice("Unread notifications were marked as read by the server.");
    } catch (requestError) {
      if (activeScopeRef.current === scopeAtStart) setError(notificationError(requestError));
    } finally {
      if (activeScopeRef.current === scopeAtStart) setSaving(false);
    }
  };

  return (
    <main className="tenant-notification-page" aria-labelledby="tenant-notifications-title">
      <header className="tenant-notification-hero">
        <div><span className="tenant-notification-eyebrow">COLLEGE WORKSPACE</span><h1 id="tenant-notifications-title">Notifications</h1><p>Review persisted in-app events for your authenticated College membership.</p></div>
        <div className="tenant-notification-actions">
          <button className="tenant-notification-primary-button" type="button" onClick={refresh} disabled={loading}><RefreshCw size={15} /> Refresh</button>
          <button className="tenant-notification-secondary-button" type="button" onClick={markAllRead} disabled={saving || !items.some((item) => !item.read_at)}><CheckCheck size={15} /> Mark all read</button>
        </div>
      </header>
      <section className="tenant-notification-panel">
        <div className="tenant-notification-panel-heading">
          <div><span className="tenant-notification-eyebrow">IN-APP INBOX</span><h2>Recent notifications</h2><p>{unreadCount == null ? "Unread count unavailable" : `${unreadCount} unread`} · {total} matching records</p></div>
          <label className="tenant-notification-inline-toggle"><input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} /> Unread only</label>
        </div>
        {error && <div className="tenant-notification-unavailable" role="alert"><span className="tenant-notification-status-icon"><Bell size={20} /></span><div><span className="tenant-notification-eyebrow">NOTIFICATION SERVICE</span><p>{error}</p><button type="button" onClick={refresh}>Retry</button></div></div>}
        {notice && <p className="tenant-notification-notice" role="status">{notice}</p>}
        {loading && <p role="status">Loading notifications…</p>}
        {!loading && !error && !items.length && <div className="tenant-notification-empty-state"><Bell size={23} /><h3>No notifications</h3><p>There are no in-app notification records for this view.</p></div>}
        {!error && <div className="tenant-notification-list">{items.map((item) => <article className={`tenant-notification-card${item.read_at ? " is-read" : " is-unread"}`} key={item.id}><div className="tenant-notification-content"><span className="tenant-notification-eyebrow">{item.event_type.replaceAll("_", " ")} · {item.channel}</span><h3>{item.title}</h3><p>{item.message}</p><time>{new Date(item.created_at).toLocaleString()}</time></div>{!item.read_at && <button type="button" className="tenant-notification-secondary-button" disabled={saving} onClick={() => void markRead(item)}>Mark read</button>}</article>)}</div>}
        {!error && total > 25 && <nav className="tenant-notification-pages" aria-label="Notification pages"><button type="button" className="tenant-notification-secondary-button" disabled={loading || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 25))}>Previous</button><span>Showing {offset + (items.length ? 1 : 0)}–{offset + items.length} of {total}</span><button type="button" className="tenant-notification-secondary-button" disabled={loading || offset + 25 >= total} onClick={() => setOffset((value) => value + 25)}>Next</button></nav>}
      </section>
      <p className="tenant-notification-role-note">This inbox reflects stored in-app notification records only. It does not claim email or SMS delivery.</p>
    </main>
  );
}
