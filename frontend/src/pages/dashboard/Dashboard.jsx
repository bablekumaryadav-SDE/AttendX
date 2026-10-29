import React from "react";
import { useAuth } from "../../context/AuthContext";

function Dashboard() {
  const { user } = useAuth();

  const role = user?.role || "student";

  const roleName = {
    admin: "Administrator",
    teacher: "Teacher",
    student: "Student",
  }[role];

  const stats = [
    {
      title: "Overall Attendance",
      value: "92.4%",
      change: "+4.8%",
      note: "vs. last month",
      icon: "✓",
      positive: true,
    },
    {
      title: "Present Today",
      value: "38",
      change: "+6",
      note: "from yesterday",
      icon: "◉",
      positive: true,
    },
    {
      title: "Classes Today",
      value: "6",
      change: "2",
      note: "remaining",
      icon: "▦",
      positive: true,
    },
    {
      title: "Attendance Alerts",
      value: "3",
      change: "Needs",
      note: "your attention",
      icon: "!",
      positive: false,
    },
  ];

  const schedule = [
    {
      time: "09:00 AM",
      subject: "Data Structures",
      room: "Room 204",
      status: "Present",
      statusType: "success",
    },
    {
      time: "10:30 AM",
      subject: "Database Management",
      room: "Lab 02",
      status: "Present",
      statusType: "success",
    },
    {
      time: "12:00 PM",
      subject: "Web Development",
      room: "Room 108",
      status: "Upcoming",
      statusType: "upcoming",
    },
    {
      time: "02:00 PM",
      subject: "Software Engineering",
      room: "Room 301",
      status: "Upcoming",
      statusType: "upcoming",
    },
  ];

  const activities = [
    {
      title: "Attendance marked",
      description: "Data Structures · Present",
      time: "10 min ago",
      icon: "✓",
    },
    {
      title: "Attendance updated",
      description: "Database Management · Present",
      time: "1 hr ago",
      icon: "↻",
    },
    {
      title: "New class scheduled",
      description: "Web Development · 12:00 PM",
      time: "3 hrs ago",
      icon: "▦",
    },
  ];

  return (
    <div className="dashboard-page">
      <div className="dashboard-welcome">
        <div>
          <span className="page-eyebrow">
            {roleName} DASHBOARD
          </span>

          <h2>
            Good morning, {roleName}.
          </h2>

          <p>
            Here's what's happening with your attendance
            today.
          </p>
        </div>

        <div className="date-card">
          <span>Today</span>
          <strong>26 August 2026</strong>
        </div>
      </div>

      <div className="stats-grid">
        {stats.map((stat) => (
          <div className="stat-card" key={stat.title}>
            <div className="stat-card-top">
              <div className="stat-icon">
                {stat.icon}
              </div>

              <span
                className={`stat-change ${
                  stat.positive
                    ? "positive"
                    : "attention"
                }`}
              >
                {stat.change}
              </span>
            </div>

            <span className="stat-title">
              {stat.title}
            </span>

            <strong className="stat-value">
              {stat.value}
            </strong>

            <span className="stat-note">
              {stat.note}
            </span>
          </div>
        ))}
      </div>

      <div className="dashboard-grid">
        <section className="dashboard-panel attendance-panel">
          <div className="panel-header">
            <div>
              <span className="panel-eyebrow">
                ATTENDANCE
              </span>

              <h3>Attendance overview</h3>
            </div>

            <select
              className="period-select"
              defaultValue="6"
              aria-label="Attendance period"
            >
              <option value="6">Last 6 months</option>
              <option value="3">Last 3 months</option>
              <option value="1">This month</option>
            </select>
          </div>

          <div className="chart">
            <div className="chart-y-axis">
              <span>100%</span>
              <span>75%</span>
              <span>50%</span>
              <span>25%</span>
              <span>0%</span>
            </div>

            <div className="chart-area">
              <div className="chart-lines">
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>

              <div className="chart-bars">
                {[
                  ["Mar", 72],
                  ["Apr", 79],
                  ["May", 83],
                  ["Jun", 88],
                  ["Jul", 91],
                  ["Aug", 92],
                ].map(([month, height]) => (
                  <div className="chart-column" key={month}>
                    <div className="bar-wrapper">
                      <div
                        className="chart-bar"
                        style={{
                          height: `${height}%`,
                        }}
                      >
                        <span>{height}%</span>
                      </div>
                    </div>

                    <small>{month}</small>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="dashboard-panel">
          <div className="panel-header">
            <div>
              <span className="panel-eyebrow">
                TODAY
              </span>

              <h3>Class schedule</h3>
            </div>

            <button
              type="button"
              className="text-button"
            >
              View all →
            </button>
          </div>

          <div className="schedule-list">
            {schedule.map((item) => (
              <div
                className="schedule-item"
                key={`${item.time}-${item.subject}`}
              >
                <div className="schedule-time">
                  {item.time}
                </div>

                <div className="schedule-marker">
                  <span />
                </div>

                <div className="schedule-content">
                  <strong>{item.subject}</strong>
                  <span>{item.room}</span>
                </div>

                <span
                  className={`schedule-status ${item.statusType}`}
                >
                  {item.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="dashboard-grid bottom-grid">
        <section className="dashboard-panel">
          <div className="panel-header">
            <div>
              <span className="panel-eyebrow">
                ACTIVITY
              </span>

              <h3>Recent activity</h3>
            </div>

            <button
              type="button"
              className="text-button"
            >
              View history →
            </button>
          </div>

          <div className="activity-list">
            {activities.map((activity) => (
              <div
                className="activity-item"
                key={activity.title}
              >
                <div className="activity-icon">
                  {activity.icon}
                </div>

                <div className="activity-content">
                  <strong>{activity.title}</strong>
                  <span>{activity.description}</span>
                </div>

                <time>{activity.time}</time>
              </div>
            ))}
          </div>
        </section>

        <section className="dashboard-panel attendance-score">
          <div className="panel-header">
            <div>
              <span className="panel-eyebrow">
                PERFORMANCE
              </span>

              <h3>Attendance health</h3>
            </div>
          </div>

          <div className="score-content">
            <div className="score-ring">
              <div>
                <strong>92%</strong>
                <span>Excellent</span>
              </div>
            </div>

            <div className="score-details">
              <div>
                <span>Present</span>
                <strong>44</strong>
              </div>

              <div>
                <span>Absent</span>
                <strong>3</strong>
              </div>

              <div>
                <span>Late</span>
                <strong>1</strong>
              </div>
            </div>
          </div>

          <div className="score-message">
            <span>✓</span>
            Your attendance is above the recommended
            85% threshold.
          </div>
        </section>
      </div>
    </div>
  );
}

export default Dashboard;