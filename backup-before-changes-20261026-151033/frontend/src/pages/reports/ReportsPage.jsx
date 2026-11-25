
import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../../services/api";

const normalize = (value) => String(value ?? "").toLowerCase();

function exportCsv(records) {
  const fields = [
    ["id", "Record ID"],
    ["date", "Date"],
    ["student_id", "Student ID"],
    ["teacher_id", "Teacher ID"],
    ["subject_id", "Subject ID"],
    ["class_id", "Class ID"],
    ["status", "Status"],
    ["remarks", "Remarks"],
  ];

  const quote = (value) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;

  const contents = [
    fields.map((field) => quote(field[1])).join(","),
    ...records.map((record) =>
      fields.map(([key]) => quote(record[key])).join(",")
    ),
  ].join("\r\n");

  const blob = new Blob(["\uFEFF" + contents], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `attendx-report-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Metric({ title, value, note }) {
  return (
    <article className="stat-card">
      <span className="stat-title">{title}</span>
      <strong className="stat-value">{value}</strong>
      <span style={{ color: "#667085", fontSize: 12 }}>{note}</span>
    </article>
  );
}

export default function ReportsPage() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await api.get("/attendance-records/");
      setRecords(Array.isArray(response.data) ? response.data : []);
    } catch (err) {
      setError(
        err.response?.data?.detail ||
        "Reports load nahi ho paaye. Backend/API permissions check karein."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const filtered = useMemo(() => {
    return records.filter((record) => {
      const date = String(record.date || record.created_at || "").slice(0, 10);
      const normalizedStatus = normalize(record.status);

      if (fromDate && (!date || date < fromDate)) return false;
      if (toDate && (!date || date > toDate)) return false;
      if (status !== "all" && normalizedStatus !== status) return false;

      const haystack = [
        record.id,
        record.student_id,
        record.teacher_id,
        record.subject_id,
        record.class_id,
        record.status,
        record.remarks,
      ].map(normalize).join(" ");

      return haystack.includes(normalize(search).trim());
    });
  }, [records, fromDate, toDate, status, search]);

  const summary = useMemo(() => {
    const present = filtered.filter(
      (item) => normalize(item.status) === "present"
    ).length;

    const absent = filtered.filter(
      (item) => normalize(item.status) === "absent"
    ).length;

    const late = filtered.filter(
      (item) => normalize(item.status) === "late"
    ).length;

    const marked = present + absent + late;
    const attendanceRate = marked
      ? Math.round(((present + late) / marked) * 100)
      : 0;

    return {
      total: filtered.length,
      present,
      absent,
      late,
      attendanceRate,
    };
  }, [filtered]);

  return (
    <main className="dashboard-page">
      <header className="dashboard-welcome">
        <div>
          <span className="page-eyebrow">ANALYTICS & REPORTING</span>
          <h1>Attendance reports</h1>
          <p>Review attendance trends and export filtered records.</p>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            className="text-button"
            type="button"
            onClick={loadRecords}
            disabled={loading}
          >
            {loading ? "Loading..." : "↻ Refresh"}
          </button>

          <button
            className="text-button"
            type="button"
            onClick={() => exportCsv(filtered)}
            disabled={loading || filtered.length === 0}
          >
            Export CSV
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" style={{
          marginBottom: 16,
          padding: 14,
          borderRadius: 10,
          color: "#b42318",
          background: "#fff4f2",
          border: "1px solid #fecdca",
        }}>
          {error}
        </div>
      )}

      <section className="stats-grid">
        <Metric title="Total records" value={loading ? "…" : summary.total} note="Filtered records" />
        <Metric title="Present" value={loading ? "…" : summary.present} note="Marked present" />
        <Metric title="Absent" value={loading ? "…" : summary.absent} note="Marked absent" />
        <Metric title="Late" value={loading ? "…" : summary.late} note="Marked late" />
        <Metric title="Attendance rate" value={loading ? "…" : `${summary.attendanceRate}%`} note="(Present + late) / marked" />
      </section>

      <section className="dashboard-panel" style={{ marginTop: 22 }}>
        <div className="panel-header">
          <div>
            <span className="panel-eyebrow">REPORT FILTERS</span>
            <h2>Find records</h2>
          </div>
        </div>

        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          padding: 16,
        }}>
          <input
            type="date"
            aria-label="From date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
            style={{ padding: 10 }}
          />

          <input
            type="date"
            aria-label="To date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
            style={{ padding: 10 }}
          />

          <select
            aria-label="Status filter"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            style={{ padding: 10 }}
          >
            <option value="all">All statuses</option>
            <option value="present">Present</option>
            <option value="absent">Absent</option>
            <option value="late">Late</option>
          </select>

          <input
            aria-label="Search report records"
            placeholder="Search IDs, status, remarks..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{ padding: 10, flex: 1, minWidth: 220 }}
          />

          <button
            className="text-button"
            type="button"
            onClick={() => {
              setFromDate("");
              setToDate("");
              setStatus("all");
              setSearch("");
            }}
          >
            Reset
          </button>
        </div>

        {fromDate && toDate && fromDate > toDate && (
          <p role="alert" style={{ padding: 16, color: "#b42318" }}>
            From date, To date se baad ki nahi honi chahiye.
          </p>
        )}

        {loading ? (
          <p style={{ padding: 20 }}>Loading report data...</p>
        ) : !error && filtered.length === 0 ? (
          <p style={{ padding: 20 }}>Selected filters ke liye koi record nahi mila.</p>
        ) : !error && (
          <div style={{ overflowX: "auto" }}>
            <table style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: 760,
            }}>
              <thead>
                <tr>
                  {[
                    "ID",
                    "Date",
                    "Student",
                    "Teacher",
                    "Subject",
                    "Class",
                    "Status",
                  ].map((heading) => (
                    <th key={heading} style={{
                      textAlign: "left",
                      padding: 12,
                      borderBottom: "1px solid #eaecf0",
                    }}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((record) => (
                  <tr key={record.id}>
                    <td style={{ padding: 12 }}>{record.id ?? "—"}</td>
                    <td style={{ padding: 12 }}>
                      {String(record.date || record.created_at || "—")}
                    </td>
                    <td style={{ padding: 12 }}>{record.student_id ?? "—"}</td>
                    <td style={{ padding: 12 }}>{record.teacher_id ?? "—"}</td>
                    <td style={{ padding: 12 }}>{record.subject_id ?? "—"}</td>
                    <td style={{ padding: 12 }}>{record.class_id ?? "—"}</td>
                    <td style={{ padding: 12 }}>{record.status || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p style={{ padding: 14, color: "#667085", fontSize: 12 }}>
          Report summary current API response aur selected filters par based hai.
        </p>
      </section>
    </main>
  );
}