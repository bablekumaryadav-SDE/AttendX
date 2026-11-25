import { GraduationCap, ShieldCheck } from "lucide-react";

export default function AuthLayout({ children }) {
  return (
    <div className="auth-shell">
      <section className="auth-brand-panel">
        <div className="brand-mark">
          <GraduationCap size={28} strokeWidth={2.2} />
        </div>

        <div className="brand-content">
          <p className="eyebrow">ATTENDANCE INTELLIGENCE</p>

          <h1>
            Smarter attendance.
            <br />
            Better academic control.
          </h1>

          <p className="brand-description">
            AttendX brings students, teachers and administrators together
            through one secure attendance management platform.
          </p>

          <div className="brand-points">
            <div>
              <ShieldCheck size={18} />
              <span>Secure role-based access</span>
            </div>

            <div>
              <ShieldCheck size={18} />
              <span>Real-time attendance insights</span>
            </div>

            <div>
              <ShieldCheck size={18} />
              <span>Centralized academic management</span>
            </div>
          </div>
        </div>

        <div className="brand-footer">
          AttendX · Academic Attendance Platform
        </div>
      </section>

      <section className="auth-form-panel">
        <div className="auth-form-container">
          {children}
        </div>
      </section>
    </div>
  );
}