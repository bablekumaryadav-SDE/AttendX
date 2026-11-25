import React from "react";
import PublicPageLayout from "./PublicPageLayout";

export default function AboutPage() {
  return (
    <PublicPageLayout
      eyebrow="About AttendX"
      title="Attendance management for higher education."
      description="AttendX is designed to modernize college attendance management through digital workflows, classroom verification and centralized administration."
    >
      <div className="public-content-grid">
        <section className="public-content-card">
          <h2>What AttendX is for</h2>
          <p>AttendX focuses on the attendance needs of colleges: organizing attendance activity, supporting verification methods, and presenting available information to authorized users.</p>
        </section>
        <section className="public-content-card">
          <h2>Intended users</h2>
          <p>The product is being developed for Super Admins, College Admins, teachers and students. There is no Parent Dashboard or Parent Login.</p>
        </section>
        <section className="public-content-card">
          <h2>How the product fits together</h2>
          <p>The repository contains a React web application and a shared FastAPI backend. Existing accounts use a common sign-in route; role and College access depend on protected routes and verified membership context.</p>
        </section>
        <section className="public-content-card">
          <h2>Current state and direction</h2>
          <p>Selected tenant-scoped read views are implemented. College ownership and registration migrations remain drafts; registration/review code is not operational until its schema is applied. College Admin activation and business writes remain unavailable.</p>
          <p>AttendX's product direction is to make attendance workflows clearer while keeping access and data ownership explicit. This describes product intent, not a claim that every planned workflow is available.</p>
        </section>
      </div>
      <p className="public-page-footer-note">This page describes the current project and intended product direction. It does not assert customer counts, company history, certification or production availability.</p>
    </PublicPageLayout>
  );
}
