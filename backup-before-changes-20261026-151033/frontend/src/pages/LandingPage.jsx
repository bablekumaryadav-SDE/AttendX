
import React from "react";
import { Link } from "react-router-dom";
import "./LandingPage.css";

const features = [
  {
    icon: "◉",
    title: "AI Face Verification",
    text: "Verify student identity using face matching and add an optional liveness verification workflow.",
    tag: "AI Powered",
  },
  {
    icon: "▦",
    title: "Dynamic QR Attendance",
    text: "Generate time-limited QR codes for classroom attendance sessions and prevent duplicate submissions.",
    tag: "Fast & Easy",
  },
  {
    icon: "⌖",
    title: "GPS Geo-fencing",
    text: "Validate the student's reported location against the configured classroom radius.",
    tag: "Location Aware",
  },
  {
    icon: "▤",
    title: "Smart Reports",
    text: "View attendance history, subject-wise percentages, date filters and exportable reports.",
    tag: "Analytics",
  },
  {
    icon: "✉",
    title: "Parent Notifications",
    text: "Configure email and SMS alerts for absences and low-attendance situations.",
    tag: "Notifications",
  },
  {
    icon: "✦",
    title: "Gemini AI Insights",
    text: "Ask natural-language questions about authorized attendance data and generate useful summaries.",
    tag: "AI Assistant",
  },
];

const roles = [
  {
    icon: "◈",
    title: "Administrator",
    description:
      "Manage students, teachers, classes, subjects, attendance records and system settings.",
    link: "/login",
    label: "Admin Login",
  },
  {
    icon: "▣",
    title: "Teacher",
    description:
      "Manage class sessions, mark attendance, review student records and generate reports.",
    link: "/login",
    label: "Teacher Login",
  },
  {
    icon: "♙",
    title: "Student",
    description:
      "View your attendance percentage, subject-wise history and personal attendance records.",
    link: "/login",
    label: "Student Login",
  },
];

function SectionHeading({ eyebrow, title, text }) {
  return (
    <div className="ax-section-heading">
      <span className="ax-eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}

export default function LandingPage() {
  return (
    <main className="ax-landing">
      <header className="ax-navbar">
        <Link to="/" className="ax-brand" aria-label="AttendX home">
          <span className="ax-brand-icon">A</span>
          <span>
            Attend<span className="ax-brand-accent">X</span>
            <small>SMART ATTENDANCE PLATFORM</small>
          </span>
        </Link>

        <nav className="ax-nav-links" aria-label="Main navigation">
          <a href="#features">Features</a>
          <a href="#workflow">How it works</a>
          <a href="#portals">User portals</a>
          <a href="#about">About</a>
        </nav>

        <div className="ax-nav-actions">
          <Link to="/login" className="ax-login-link">
            Sign in
          </Link>
          <Link to="/login" className="ax-button ax-button-small">
            Get started <span>↗</span>
          </Link>
        </div>
      </header>

      <section className="ax-hero">
        <div className="ax-hero-grid">
          <div className="ax-hero-content">
            <div className="ax-status-pill">
              <span className="ax-status-dot" />
              SMARTER ATTENDANCE STARTS HERE
            </div>

            <h1>
              Attendance,
              <br />
              <span>reimagined with AI.</span>
            </h1>

            <p className="ax-hero-description">
              Meet AttendX — an intelligent attendance management platform
              that brings identity verification, classroom attendance,
              analytics and notifications into one connected workspace.
            </p>

            <div className="ax-hero-actions">
              <Link to="/login" className="ax-button">
                Access your dashboard <span>→</span>
              </Link>
              <a href="#features" className="ax-button ax-button-outline">
                Explore features
              </a>
            </div>

            <div className="ax-hero-trust">
              <div className="ax-avatar-stack" aria-hidden="true">
                <span>A</span>
                <span>T</span>
                <span>S</span>
              </div>
              <div>
                <strong>One connected platform</strong>
                <p>For administrators, teachers and students</p>
              </div>
            </div>
          </div>

          <div className="ax-hero-visual">
            <div className="ax-orb ax-orb-one" />
            <div className="ax-orb ax-orb-two" />

            <div className="ax-dashboard-preview">
              <div className="ax-preview-top">
                <div>
                  <span className="ax-preview-label">ATTENDX OVERVIEW</span>
                  <h3>Attendance dashboard</h3>
                </div>
                <span className="ax-live-label">
                  <span className="ax-status-dot" />
                  Preview
                </span>
              </div>

              <div className="ax-preview-welcome">
                <div>
                  <span>Welcome to AttendX</span>
                  <h4>Every class, accounted for.</h4>
                  <p>Attendance management made simpler.</p>
                </div>
                <div className="ax-preview-symbol">A</div>
              </div>

              <div className="ax-preview-metrics">
                <div className="ax-metric">
                  <span className="ax-metric-icon purple">▣</span>
                  <span>Attendance</span>
                  <strong>Tracking</strong>
                  <small>Session based</small>
                </div>
                <div className="ax-metric">
                  <span className="ax-metric-icon green">✓</span>
                  <span>Verification</span>
                  <strong>Multi-layer</strong>
                  <small>QR, face and GPS*</small>
                </div>
              </div>

              <div className="ax-preview-bottom">
                <div>
                  <span className="ax-mini-chart-icon">↗</span>
                  <div>
                    <strong>Smart insights</strong>
                    <small>Reports and attendance trends</small>
                  </div>
                </div>
                <span className="ax-preview-arrow">→</span>
              </div>
              <p className="ax-preview-note">
                *Features depend on configuration and implementation status.
              </p>
            </div>

            <div className="ax-floating-card ax-float-top">
              <span className="ax-float-icon">✦</span>
              <div>
                <strong>AI-assisted</strong>
                <small>Attendance insights</small>
              </div>
            </div>

            <div className="ax-floating-card ax-float-bottom">
              <span className="ax-float-check">✓</span>
              <div>
                <strong>One workspace</strong>
                <small>Three user roles</small>
              </div>
            </div>
          </div>
        </div>
        <div className="ax-hero-bottom-line">
          <span>BUILT FOR MODERN EDUCATION</span>
          <span>IDENTITY · ATTENDANCE · INSIGHTS</span>
        </div>
      </section>

      <section className="ax-features ax-section" id="features">
        <SectionHeading
          eyebrow="PLATFORM CAPABILITIES"
          title="Everything attendance needs."
          text="A unified platform designed to simplify classroom attendance and help institutions make better-informed decisions."
        />

        <div className="ax-feature-grid">
          {features.map((feature) => (
            <article className="ax-feature-card" key={feature.title}>
              <div className="ax-feature-card-top">
                <span className="ax-feature-icon">{feature.icon}</span>
                <span className="ax-feature-tag">{feature.tag}</span>
              </div>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
              <a href="#workflow" className="ax-feature-link">
                Discover how <span>→</span>
              </a>
            </article>
          ))}
        </div>
      </section>

      <section className="ax-workflow ax-section" id="workflow">
        <div className="ax-workflow-layout">
          <div className="ax-workflow-intro">
            <span className="ax-eyebrow">SIMPLE WORKFLOW</span>
            <h2>
              From classroom
              <br />
              to clear insights.
            </h2>
            <p>
              Bring attendance capture, validation and reporting together in
              a consistent workflow.
            </p>
            <Link to="/login" className="ax-button">
              Enter AttendX <span>→</span>
            </Link>
          </div>

          <div className="ax-steps">
            <article className="ax-step">
              <span className="ax-step-number">01</span>
              <div>
                <h3>Create a class session</h3>
                <p>
                  A teacher selects the class, subject and session details.
                </p>
              </div>
              <span className="ax-step-icon">▣</span>
            </article>

            <article className="ax-step">
              <span className="ax-step-number">02</span>
              <div>
                <h3>Verify and record attendance</h3>
                <p>
                  Use the enabled attendance method and apply configured
                  identity and location checks.
                </p>
              </div>
              <span className="ax-step-icon">◉</span>
            </article>

            <article className="ax-step">
              <span className="ax-step-number">03</span>
              <div>
                <h3>Review reports and insights</h3>
                <p>
                  Authorized users review attendance records, percentages
                  and configured notifications.
                </p>
              </div>
              <span className="ax-step-icon">↗</span>
            </article>
          </div>
        </div>
      </section>

      <section className="ax-portals ax-section" id="portals">
        <SectionHeading
          eyebrow="PURPOSE-BUILT WORKSPACES"
          title="The right tools for every role."
          text="Each user role has a dedicated workspace. Sign in to access the features permitted for your account."
        />

        <div className="ax-role-grid">
          {roles.map((role) => (
            <article className="ax-role-card" key={role.title}>
              <div className="ax-role-icon">{role.icon}</div>
              <h3>{role.title}</h3>
              <p>{role.description}</p>
              <Link to={role.link} className="ax-role-link">
                {role.label} <span>→</span>
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="ax-security ax-section" id="about">
        <div className="ax-security-panel">
          <div>
            <span className="ax-eyebrow">BUILT WITH RESPONSIBILITY</span>
            <h2>
              Useful insights.
              <br />
              Responsible access.
            </h2>
            <p>
              AttendX is designed around role-based access, attendance
              records and configurable verification workflows. Sensitive
              student information should only be available to authorized
              users.
            </p>
          </div>
          <div className="ax-security-points">
            <div>
              <span>✓</span>
              <div>
                <strong>Role-based access</strong>
                <p>Separate permissions for admin, teacher and student.</p>
              </div>
            </div>
            <div>
              <span>✓</span>
              <div>
                <strong>Attendance history</strong>
                <p>Review records with appropriate access controls.</p>
              </div>
            </div>
            <div>
              <span>✓</span>
              <div>
                <strong>Configurable integrations</strong>
                <p>Connect supported AI and notification services.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="ax-final-cta">
        <div>
          <span className="ax-eyebrow">YOUR ATTENDANCE WORKSPACE</span>
          <h2>Make every class count.</h2>
          <p>
            Sign in to AttendX and access your role-specific workspace.
          </p>
        </div>
        <Link to="/login" className="ax-button ax-cta-button">
          Sign in to AttendX <span>→</span>
        </Link>
      </section>

      <footer className="ax-footer">
        <Link to="/" className="ax-brand ax-footer-brand">
          <span className="ax-brand-icon">A</span>
          <span>
            Attend<span className="ax-brand-accent">X</span>
            <small>SMART ATTENDANCE PLATFORM</small>
          </span>
        </Link>

        <p>
          Intelligent attendance management for modern education.
        </p>

        <div className="ax-footer-links">
          <a href="#features">Features</a>
          <a href="#portals">User portals</a>
          <Link to="/login">Sign in</Link>
        </div>

        <div className="ax-footer-bottom">
          <span>© {new Date().getFullYear()} AttendX</span>
          <span>AI-assisted attendance management</span>
        </div>
      </footer>
    </main>
  );
}
