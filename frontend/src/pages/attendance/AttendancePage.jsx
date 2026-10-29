
import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString();
};

const normalize = (value) => String(value ?? "").toLowerCase();

function downloadCsv(rows) {
  const columns = [
    ["id", "Record ID"],
    ["student_id", "Student ID"],
    ["teacher_id", "Teacher ID"],
    ["subject_id", "Subject ID"],
    ["class_id", "Class ID"],
    ["date", "Date"],
    ["status", "Status"],
    ["remarks", "Remarks"],
  ];

  const quote = (value) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;

  const csv = [
    columns.map((column) => quote(column[1])).join(","),
    ...rows.map((row) =>
      columns.map(([key]) => quote(row[key])).join(",")
    ),
  ].join("\r\n");

  const blob = new Blob(["\uFEFF" + csv], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `attendx-attendance-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function SummaryCard({ title, value }) {
  return (
    <div className="stat-card">
      <span className="stat-title">{title}</span>
      <strong className="stat-value">{value}</strong>
    </div>
  );
}

export default function AttendancePage() {
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");

  const loadAttendance = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await api.get("/attendance-records/");
      setRecords(Array.isArray(response.data) ? response.data : []);
    } catch (err) {
      setError(
        err.response?.data?.detail ||
        "Attendance load nahi hui. Backend aur login permissions check karein."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      const status = normalize(record.status);
      const date = String(record.date || record.created_at || "").slice(0, 10);

      const matchesStatus =
        statusFilter === "all" || status === statusFilter;

      const matchesDate = !dateFilter || date === dateFilter;

      const searchable = [
        record.id,
        record.student_id,
        record.teacher_id,
        record.subject_id,
        record.class_id,
        record.status,
        record.remarks,
      ].map(normalize).join(" ");

      return (
        matchesStatus &&
        matchesDate &&
        searchable.includes(normalize(search).trim())
      );
    });
  }, [records, search, statusFilter, dateFilter]);

  const stats = useMemo(() => {
    const count = (status) =>
      records.filter((record) => normalize(record.status) === status).length;

    return {
      total: records.length,
      present: count("present"),
      absent: count("absent"),
      late: count("late"),
    };
  }, [records]);

  return (
    <main className="dashboard-page">
      <header className="dashboard-welcome">
        <div>
          <span className="page-eyebrow">ATTENDANCE MANAGEMENT</span>
          <h1>Attendance records</h1>
          <p>
            Signed in as {user?.email || user?.role || "user"}.
            {" "}Records backend API se load hote hain.
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            className="text-button"
            type="button"
            onClick={loadAttendance}
            disabled={loading}
          >
            {loading ? "Loading..." : "↻ Refresh"}
          </button>

          <button
            className="text-button"
            type="button"
            onClick={() => downloadCsv(filteredRecords)}
            disabled={loading || filteredRecords.length === 0}
          >
            Export CSV
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" style={{
          padding: 14,
          marginBottom: 16,
          border: "1px solid #fecdca",
          borderRadius: 10,
          color: "#b42318",
          background: "#fff4f2",
        }}>
          {error}
        </div>
      )}

      <section className="stats-grid">
        <SummaryCard title="Total records" value={loading ? "…" : stats.total} />
        <SummaryCard title="Present" value={loading ? "…" : stats.present} />
        <SummaryCard title="Absent" value={loading ? "…" : stats.absent} />
        <SummaryCard title="Late" value={loading ? "…" : stats.late} />
      </section>

      <section className="dashboard-panel" style={{ marginTop: 22 }}>
        <div className="panel-header">
          <div>
            <span className="panel-eyebrow">RECORD DIRECTORY</span>
            <h2>Attendance history</h2>
          </div>
        </div>

        <div style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          padding: 16,
        }}>
          <input
            aria-label="Search attendance records"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search student, subject, class, status..."
            style={{ minWidth: 220, flex: 1, padding: 11 }}
          />

          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            style={{ padding: 11 }}
          >
            <option value="all">All statuses</option>
            <option value="present">Present</option>
            <option value="absent">Absent</option>
            <option value="late">Late</option>
          </select>

          <input
            aria-label="Filter by date"
            type="date"
            value={dateFilter}
            onChange={(event) => setDateFilter(event.target.value)}
            style={{ padding: 11 }}
          />

          <button
            type="button"
            className="text-button"
            onClick={() => {
              setSearch("");
              setStatusFilter("all");
              setDateFilter("");
            }}
          >
            Clear filters
          </button>
        </div>

        {loading ? (
          <p style={{ padding: 20 }}>Loading attendance records...</p>
        ) : !error && filteredRecords.length === 0 ? (
          <p style={{ padding: 20 }}>
            Is filter ke liye attendance records nahi mile.
          </p>
        ) : !error && (
          <div style={{ overflowX: "auto" }}>
            <table style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: 850,
            }}>
              <thead>
                <tr>
                  {[
                    "Record",
                    "Date",
                    "Student ID",
                    "Teacher ID",
                    "Subject ID",
                    "Class ID",
                    "Status",
                    "Remarks",
                  ].map((heading) => (
                    <th key={heading} style={{
                      textAlign: "left",
                      padding: 12,
                      borderBottom: "1px solid #eaecf0",
                      whiteSpace: "nowrap",
                    }}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {filteredRecords.map((record) => (
                  <tr key={record.id}>
                    <td style={{ padding: 12 }}>{record.id ?? "—"}</td>
                    <td style={{ padding: 12 }}>
                      {formatDate(record.date || record.created_at)}
                    </td>
                    <td style={{ padding: 12 }}>{record.student_id ?? "—"}</td>
                    <td style={{ padding: 12 }}>{record.teacher_id ?? "—"}</td>
                    <td style={{ padding: 12 }}>{record.subject_id ?? "—"}</td>
                    <td style={{ padding: 12 }}>{record.class_id ?? "—"}</td>
                    <td style={{ padding: 12 }}>
                      <span>{record.status || "—"}</span>
                    </td>
                    <td style={{ padding: 12 }}>{record.remarks || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p style={{ padding: 14, color: "#667085", fontSize: 12 }}>
          Showing {loading ? "…" : filteredRecords.length} of {records.length} records.
        </p>
      </section>
    </main>
  );
}