import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import api from "../../services/api";


function formatDate(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString(
    "en-IN",
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
    "en-IN",
    {
      hour: "2-digit",
      minute: "2-digit",
    }
  );
}


function Attendance() {
  const [records, setRecords] = useState([]);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  const [search, setSearch] = useState("");

  const [statusFilter, setStatusFilter] =
    useState("all");


  const loadAttendance = useCallback(
    async () => {
      setLoading(true);
      setError("");

      try {
        const response = await api.get(
          "/attendance/"
        );

        const data = Array.isArray(
          response.data
        )
          ? response.data
          : [];

        setRecords(data);

      } catch (err) {
        console.error(
          "Attendance loading error:",
          err
        );

        setError(
          err?.response?.data?.detail ||
          "Unable to load attendance records."
        );

      } finally {
        setLoading(false);
      }
    },
    []
  );


  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);


  const filteredRecords = useMemo(
    () => {
      const query =
        search.trim().toLowerCase();

      return records.filter(
        (record) => {

          const matchesSearch =
            !query ||
            [
              record.student_name,
              record.student_code,
              record.roll_number,
              record.teacher_name,
              record.status,
              record.date,
            ]
              .filter(Boolean)
              .some(
                (value) =>
                  String(value)
                    .toLowerCase()
                    .includes(query)
              );


          const normalizedStatus =
            String(
              record.status || ""
            ).toLowerCase();


          const matchesStatus =
            statusFilter === "all" ||
            normalizedStatus ===
              statusFilter;


          return (
            matchesSearch &&
            matchesStatus
          );
        }
      );
    },
    [
      records,
      search,
      statusFilter,
    ]
  );


  const presentCount =
    records.filter(
      (item) =>
        String(item.status)
          .toLowerCase() ===
        "present"
    ).length;


  const absentCount =
    records.filter(
      (item) =>
        String(item.status)
          .toLowerCase() ===
        "absent"
    ).length;


  const lateCount =
    records.filter(
      (item) =>
        String(item.status)
          .toLowerCase() ===
        "late"
    ).length;


  return (
    <div
      style={{
        padding: "34px",
        maxWidth: "1500px",
        margin: "0 auto",
      }}
    >

      {/* HEADER */}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: "20px",
          marginBottom: "28px",
          flexWrap: "wrap",
        }}
      >

        <div>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 800,
              letterSpacing: "0.18em",
              color: "#6366f1",
              marginBottom: "8px",
            }}
          >
            ATTENDANCE OPERATIONS
          </div>

          <h1
            style={{
              margin: 0,
              fontSize: "34px",
              color: "#101828",
            }}
          >
            Attendance
          </h1>

          <p
            style={{
              marginTop: "8px",
              color: "#667085",
              fontSize: "14px",
            }}
          >
            Monitor attendance records,
            present students and exceptions.
          </p>
        </div>


        <button
          type="button"
          onClick={loadAttendance}
          style={{
            border: "1px solid #d0d5dd",
            background: "#ffffff",
            color: "#344054",
            borderRadius: "10px",
            padding: "12px 18px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          ↻ Refresh
        </button>

      </div>


      {/* STAT CARDS */}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(4, minmax(0, 1fr))",
          gap: "16px",
          marginBottom: "22px",
        }}
      >

        <StatCard
          title="Total Records"
          value={records.length}
          icon="◎"
        />

        <StatCard
          title="Present"
          value={presentCount}
          icon="✓"
        />

        <StatCard
          title="Late"
          value={lateCount}
          icon="◷"
        />

        <StatCard
          title="Absent"
          value={absentCount}
          icon="!"
        />

      </div>


      {/* MAIN CARD */}

      <section
        style={{
          background: "#ffffff",
          border: "1px solid #e4e7ec",
          borderRadius: "18px",
          overflow: "hidden",
          boxShadow:
            "0 10px 30px rgba(16,24,40,0.04)",
        }}
      >

        {/* TOOLBAR */}

        <div
          style={{
            padding: "22px",
            borderBottom:
              "1px solid #eaecf0",
            display: "flex",
            gap: "12px",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >

          <div
            style={{
              flex: 1,
              minWidth: "260px",
            }}
          >

            <input
              type="text"
              value={search}
              onChange={(event) =>
                setSearch(
                  event.target.value
                )
              }
              placeholder="Search student, roll number, teacher..."
              style={{
                width: "100%",
                boxSizing: "border-box",
                height: "44px",
                border:
                  "1px solid #d0d5dd",
                borderRadius: "10px",
                padding:
                  "0 14px",
                outline: "none",
                fontSize: "13px",
              }}
            />

          </div>


          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(
                event.target.value
              )
            }
            style={{
              height: "44px",
              border:
                "1px solid #d0d5dd",
              borderRadius: "10px",
              padding:
                "0 14px",
              background: "#ffffff",
              minWidth: "150px",
              fontWeight: 600,
            }}
          >
            <option value="all">
              All Status
            </option>

            <option value="present">
              Present
            </option>

            <option value="late">
              Late
            </option>

            <option value="absent">
              Absent
            </option>
          </select>

        </div>


        {/* ERROR */}

        {error && (
          <div
            style={{
              margin: "18px 22px 0",
              padding: "13px 15px",
              borderRadius: "10px",
              background: "#fff4f4",
              border:
                "1px solid #fecdca",
              color: "#b42318",
              fontSize: "13px",
              fontWeight: 600,
            }}
          >
            {error}
          </div>
        )}


        {/* LOADING */}

        {loading ? (
          <div
            style={{
              padding: "60px",
              textAlign: "center",
              color: "#667085",
            }}
          >
            Loading attendance records...
          </div>
        ) : (
          <div
            style={{
              overflowX: "auto",
            }}
          >

            <table
              style={{
                width: "100%",
                borderCollapse:
                  "collapse",
              }}
            >

              <thead>
                <tr>
                  {[
                    "Student",
                    "Teacher",
                    "Date",
                    "Status",
                    "Record ID",
                  ].map(
                    (heading) => (
                      <th
                        key={heading}
                        style={{
                          textAlign: "left",
                          padding:
                            "14px 18px",
                          borderBottom:
                            "1px solid #eaecf0",
                          color: "#667085",
                          fontSize: "11px",
                          textTransform:
                            "uppercase",
                          letterSpacing:
                            "0.08em",
                          whiteSpace:
                            "nowrap",
                        }}
                      >
                        {heading}
                      </th>
                    )
                  )}
                </tr>
              </thead>


              <tbody>

                {filteredRecords.length ===
                0 ? (
                  <tr>
                    <td
                      colSpan="5"
                      style={{
                        padding: "55px",
                        textAlign:
                          "center",
                        color: "#98a2b3",
                      }}
                    >
                      No attendance records
                      found.
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map(
                    (record) => {

                      const status =
                        String(
                          record.status ||
                          ""
                        ).toLowerCase();

                      return (
                        <tr
                          key={
                            record.id
                          }
                        >

                          <td
                            style={{
                              padding:
                                "16px 18px",
                              borderBottom:
                                "1px solid #f2f4f7",
                            }}
                          >

                            <strong
                              style={{
                                display:
                                  "block",
                                color:
                                  "#101828",
                                fontSize:
                                  "13px",
                              }}
                            >
                              {record.student_name ||
                                record.name ||
                                `Student #${
                                  record.student_id ||
                                  "—"
                                }`}
                            </strong>

                            <span
                              style={{
                                display:
                                  "block",
                                marginTop:
                                  "4px",
                                color:
                                  "#98a2b3",
                                fontSize:
                                  "11px",
                              }}
                            >
                              {record.student_code ||
                                record.roll_number ||
                                "Student record"}
                            </span>

                          </td>


                          <td
                            style={{
                              padding:
                                "16px 18px",
                              borderBottom:
                                "1px solid #f2f4f7",
                              color:
                                "#475467",
                              fontSize:
                                "13px",
                            }}
                          >
                            {record.teacher_name ||
                              record.teacher_id ||
                              "—"}
                          </td>


                          <td
                            style={{
                              padding:
                                "16px 18px",
                              borderBottom:
                                "1px solid #f2f4f7",
                            }}
                          >

                            <strong
                              style={{
                                display:
                                  "block",
                                color:
                                  "#344054",
                                fontSize:
                                  "12px",
                              }}
                            >
                              {formatDate(
                                record.date
                              )}
                            </strong>

                            {record.verified_at && (
                              <span
                                style={{
                                  display:
                                    "block",
                                  marginTop:
                                    "4px",
                                  color:
                                    "#98a2b3",
                                  fontSize:
                                    "10px",
                                }}
                              >
                                {formatTime(
                                  record.verified_at
                                )}
                              </span>
                            )}

                          </td>


                          <td
                            style={{
                              padding:
                                "16px 18px",
                              borderBottom:
                                "1px solid #f2f4f7",
                            }}
                          >

                            <span
                              style={{
                                display:
                                  "inline-flex",
                                padding:
                                  "6px 10px",
                                borderRadius:
                                  "999px",
                                fontSize:
                                  "10px",
                                fontWeight:
                                  800,
                                textTransform:
                                  "uppercase",
                                background:
                                  status ===
                                  "present"
                                    ? "#ecfdf3"
                                    : status ===
                                      "late"
                                    ? "#fffaeb"
                                    : "#fef3f2",
                                color:
                                  status ===
                                  "present"
                                    ? "#027a48"
                                    : status ===
                                      "late"
                                    ? "#b54708"
                                    : "#b42318",
                              }}
                            >
                              {record.status ||
                                "Unknown"}
                            </span>

                          </td>


                          <td
                            style={{
                              padding:
                                "16px 18px",
                              borderBottom:
                                "1px solid #f2f4f7",
                              color:
                                "#667085",
                              fontSize:
                                "12px",
                            }}
                          >
                            #{record.id}
                          </td>

                        </tr>
                      );
                    }
                  )
                )}

              </tbody>

            </table>

          </div>
        )}

      </section>

    </div>
  );
}


function StatCard({
  title,
  value,
  icon,
}) {
  return (
    <div
      style={{
        background: "#ffffff",
        border:
          "1px solid #e4e7ec",
        borderRadius: "16px",
        padding: "20px",
        minHeight: "110px",
        boxSizing: "border-box",
      }}
    >

      <div
        style={{
          width: "38px",
          height: "38px",
          borderRadius: "10px",
          background: "#eef2ff",
          color: "#6366f1",
          display: "grid",
          placeItems: "center",
          fontWeight: 900,
          marginBottom: "14px",
        }}
      >
        {icon}
      </div>

      <div
        style={{
          color: "#667085",
          fontSize: "12px",
          fontWeight: 600,
        }}
      >
        {title}
      </div>

      <strong
        style={{
          display: "block",
          marginTop: "4px",
          color: "#101828",
          fontSize: "25px",
        }}
      >
        {value}
      </strong>

    </div>
  );
}


export default Attendance;