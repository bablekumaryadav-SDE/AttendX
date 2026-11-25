export function buildTenantReportCsv(summary, attendance) {
  const rows = [
    ["Report", "Metric", "Value"],
    ["College overview", "College", summary.college_name],
    ...["students", "teachers", "classes", "subjects"].flatMap((key) => [
      ["College overview", `${key} active`, summary[key].active],
      ["College overview", `${key} inactive`, summary[key].inactive],
      ["College overview", `${key} total`, summary[key].total],
    ]),
    ["Face registration", "Registered", summary.face_registered_count],
    ["Face registration", "Not registered", summary.face_not_registered_count],
    ["Attendance", "Present records", attendance.present_records],
    ["Attendance", "Late records", attendance.late_records],
    ["Attendance", "Absent records", attendance.absent_records],
    ["Attendance", "Recorded presence rate", attendance.recorded_presence_rate_percent ?? "Unavailable"],
    ...attendance.trends.map((point) => ["Attendance trend", `${point.period} presence rate`, point.presence_rate_percent ?? "Unavailable"]),
  ];

  return rows.map((row) => row.map((value) => {
    const text = String(value ?? "");
    const safeText = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safeText.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n");
}
