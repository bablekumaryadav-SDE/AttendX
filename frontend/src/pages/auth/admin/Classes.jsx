import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import api from "../../../services/api";


function Classes() {
  const [classes, setClasses] = useState([]);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  const [search, setSearch] = useState("");


  const loadClasses = useCallback(
    async () => {
      setLoading(true);
      setError("");

      try {
        const response =
          await api.get("/classes/");

        const data = Array.isArray(
          response.data
        )
          ? response.data
          : [];

        setClasses(data);

      } catch (err) {
        console.error(
          "Classes loading error:",
          err
        );

        setError(
          err?.response?.data?.detail ||
          "Unable to load classes."
        );

      } finally {
        setLoading(false);
      }
    },
    []
  );


  useEffect(() => {
    loadClasses();
  }, [loadClasses]);


  const filteredClasses =
    useMemo(() => {
      const query =
        search.trim().toLowerCase();

      if (!query) {
        return classes;
      }

      return classes.filter(
        (item) =>
          [
            item.name,
            item.section,
            item.department,
            item.academic_year,
            item.code,
          ]
            .filter(Boolean)
            .some(
              (value) =>
                String(value)
                  .toLowerCase()
                  .includes(query)
            )
      );
    }, [classes, search]);


  const departments = new Set(
    classes
      .map(
        (item) =>
          item.department
      )
      .filter(Boolean)
  ).size;


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
          justifyContent:
            "space-between",
          alignItems: "flex-end",
          gap: "20px",
          flexWrap: "wrap",
          marginBottom: "28px",
        }}
      >

        <div>

          <div
            style={{
              fontSize: "11px",
              fontWeight: 800,
              letterSpacing:
                "0.18em",
              color: "#6366f1",
              marginBottom: "8px",
            }}
          >
            ACADEMIC STRUCTURE
          </div>

          <h1
            style={{
              margin: 0,
              color: "#101828",
              fontSize: "34px",
            }}
          >
            Classes
          </h1>

          <p
            style={{
              marginTop: "8px",
              color: "#667085",
              fontSize: "14px",
            }}
          >
            View academic classes,
            sections and class structure.
          </p>

        </div>


        <button
          type="button"
          onClick={loadClasses}
          style={{
            border:
              "1px solid #d0d5dd",
            background: "#ffffff",
            borderRadius: "10px",
            padding:
              "12px 18px",
            color: "#344054",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          ↻ Refresh
        </button>

      </div>


      {/* STATS */}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(3, minmax(0, 1fr))",
          gap: "16px",
          marginBottom: "22px",
        }}
      >

        <InfoCard
          title="Total Classes"
          value={classes.length}
          icon="▦"
        />

        <InfoCard
          title="Departments"
          value={departments}
          icon="#"
        />

        <InfoCard
          title="Sections"
          value={
            new Set(
              classes
                .map(
                  (item) =>
                    item.section
                )
                .filter(Boolean)
            ).size
          }
          icon="S"
        />

      </div>


      {/* DIRECTORY */}

      <section
        style={{
          background: "#ffffff",
          border:
            "1px solid #e4e7ec",
          borderRadius: "18px",
          overflow: "hidden",
          boxShadow:
            "0 10px 30px rgba(16,24,40,0.04)",
        }}
      >

        <div
          style={{
            padding: "22px",
            borderBottom:
              "1px solid #eaecf0",
            display: "flex",
            gap: "12px",
            alignItems: "center",
          }}
        >

          <input
            value={search}
            onChange={(event) =>
              setSearch(
                event.target.value
              )
            }
            placeholder="Search class, section, department..."
            style={{
              width: "100%",
              maxWidth: "520px",
              height: "44px",
              border:
                "1px solid #d0d5dd",
              borderRadius: "10px",
              padding:
                "0 14px",
              fontSize: "13px",
              outline: "none",
              boxSizing: "border-box",
            }}
          />

        </div>


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


        {loading ? (
          <div
            style={{
              padding: "60px",
              textAlign: "center",
              color: "#667085",
            }}
          >
            Loading classes...
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
                    "Class",
                    "Section",
                    "Department",
                    "Academic Year",
                    "Status",
                  ].map(
                    (heading) => (
                      <th
                        key={heading}
                        style={{
                          textAlign:
                            "left",
                          padding:
                            "14px 18px",
                          borderBottom:
                            "1px solid #eaecf0",
                          color:
                            "#667085",
                          fontSize:
                            "11px",
                          textTransform:
                            "uppercase",
                          letterSpacing:
                            "0.08em",
                        }}
                      >
                        {heading}
                      </th>
                    )
                  )}
                </tr>
              </thead>


              <tbody>

                {filteredClasses.length ===
                0 ? (
                  <tr>
                    <td
                      colSpan="5"
                      style={{
                        padding:
                          "55px",
                        textAlign:
                          "center",
                        color:
                          "#98a2b3",
                      }}
                    >
                      No classes found.
                    </td>
                  </tr>
                ) : (
                  filteredClasses.map(
                    (item) => (
                      <tr
                        key={item.id}
                      >

                        <td
                          style={{
                            padding:
                              "17px 18px",
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
                            {item.name ||
                              item.code ||
                              `Class #${item.id}`}
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
                            ID #{item.id}
                          </span>
                        </td>


                        <td
                          style={{
                            padding:
                              "17px 18px",
                            borderBottom:
                              "1px solid #f2f4f7",
                            color:
                              "#475467",
                          }}
                        >
                          {item.section ||
                            "—"}
                        </td>


                        <td
                          style={{
                            padding:
                              "17px 18px",
                            borderBottom:
                              "1px solid #f2f4f7",
                            color:
                              "#475467",
                          }}
                        >
                          {item.department ||
                            "—"}
                        </td>


                        <td
                          style={{
                            padding:
                              "17px 18px",
                            borderBottom:
                              "1px solid #f2f4f7",
                            color:
                              "#475467",
                          }}
                        >
                          {item.academic_year ||
                            "—"}
                        </td>


                        <td
                          style={{
                            padding:
                              "17px 18px",
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
                              background:
                                "#ecfdf3",
                              color:
                                "#027a48",
                              fontSize:
                                "10px",
                              fontWeight:
                                800,
                            }}
                          >
                            ACTIVE
                          </span>
                        </td>

                      </tr>
                    )
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


function InfoCard({
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
      }}
    >

      <div
        style={{
          width: "38px",
          height: "38px",
          display: "grid",
          placeItems: "center",
          background:
            "#eef2ff",
          color: "#6366f1",
          borderRadius:
            "10px",
          fontWeight: 900,
          marginBottom:
            "13px",
        }}
      >
        {icon}
      </div>

      <span
        style={{
          color: "#667085",
          fontSize: "12px",
          fontWeight: 600,
        }}
      >
        {title}
      </span>

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


export default Classes;