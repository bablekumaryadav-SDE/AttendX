import React from "react";

function AuthLayout({ children }) {
  return (
    <div className="auth-page">
      <div className="auth-brand-panel">
        <div className="brand-mark">
          <span>AX</span>
        </div>

        <div className="brand-content">
          <div className="brand-label">ATTENDX</div>

          <h1>
            Smarter attendance.
            <br />
            Better academic insight.
          </h1>

          <p>
            A modern attendance management platform built for
            administrators, teachers and students.
          </p>

          <div className="brand-features">
            <div>
              <span className="feature-icon">✓</span>
              Real-time attendance tracking
            </div>

            <div>
              <span className="feature-icon">✓</span>
              Role-based academic management
            </div>

            <div>
              <span className="feature-icon">✓</span>
              Intelligent attendance analytics
            </div>
          </div>
        </div>

        <div className="brand-footer">
          © 2026 AttendX · Smart Attendance Management
        </div>
      </div>

      <main className="auth-content">{children}</main>
    </div>
  );
}

export default AuthLayout;