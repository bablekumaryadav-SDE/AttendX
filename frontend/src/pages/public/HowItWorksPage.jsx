import React from "react";
import PublicPageLayout from "./PublicPageLayout";

const steps = [
  ["College onboarding", "IMPLEMENTED IN SOURCE; SCHEMA NOT APPLIED", "Public application submission and Super Admin review APIs/pages exist in source. Their migration is DRAFT / NOT APPLIED; approved accounts remain pending activation and no invitation is sent."],
  ["College administration", "PARTIALLY AVAILABLE", "Existing members can use selected tenant-scoped views. User invitations and full College management actions are not enabled."],
  ["Teacher and student setup", "PARTIALLY AVAILABLE", "Read-only directory views exist for selected data. Tenant-safe account provisioning and business writes remain unavailable."],
  ["Academic structure and timetable", "PLANNED", "A complete academic-session, timetable and lecture setup workflow is not established."],
  ["Teacher starts an attendance session", "NOT AVAILABLE", "Session code exists in the legacy application, but tenant-safe session creation remains blocked by the default-deny gate."],
  ["Student scans an attendance QR", "PARTIALLY AVAILABLE", "QR attendance logic exists in legacy source. An enabled, tenant-safe end-to-end College workflow is not established."],
  ["Backend checks attendance requirements", "PARTIALLY AVAILABLE", "QR, location and optional face checks exist in source. Device, policy and tenant behavior are not fully verified."],
  ["Attendance is recorded", "PARTIALLY AVAILABLE", "Legacy recording code exists; business-write APIs remain gated and PostgreSQL validation is outstanding."],
  ["Authorized users review results", "PARTIALLY AVAILABLE", "Selected tenant-scoped read APIs and summary views are available. Broader reports remain blocked."],
];

export default function HowItWorksPage() {
  return (
    <PublicPageLayout
      eyebrow="How AttendX works"
      title="An intended journey, with current limits made clear."
      description="The following describes the product direction and labels where workflows are planned or only partly available. It is not a claim that this complete sequence can currently be run end to end."
    >
      <div className="public-callout"><strong>Not an operational guarantee.</strong> Registration and review code is not backed by an applied schema; activation and tenant-safe attendance writes are unavailable. No attendance submission is simulated on this page.</div>
      <ol className="public-step-list">
        {steps.map(([title, status, detail], index) => (
          <li key={title}>
            <span className="public-step-number">{String(index + 1).padStart(2, "0")}</span>
            <div><h3>{title}<span className="public-status" data-status={status.toLowerCase().replaceAll(" ", "-")}>{status}</span></h3><p>{detail}</p></div>
          </li>
        ))}
      </ol>
    </PublicPageLayout>
  );
}
