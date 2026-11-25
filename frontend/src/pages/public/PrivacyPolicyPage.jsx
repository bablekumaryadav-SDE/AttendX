import React from "react";
import PublicPageLayout from "./PublicPageLayout";

const topics = [
  ["Accounts and authentication", "IMPLEMENTED IN SOURCE", "AttendX has user accounts, sign-in and protected workspaces. Exact production account configuration and session-retention policy are not verified here."],
  ["College application information", "IMPLEMENTED IN SOURCE; SCHEMA NOT APPLIED", "The application form collects College and representative contact details. The submitted password is stored only as a one-way hash while pending and transferred to an inactive account after approval; rejected/pending-activation lifecycle and retention require owner/legal review. The workflow is not operational until its migration is applied."],
  ["College and academic records", "IMPLEMENTED IN SOURCE", "The application models College memberships and academic records. The tenant ownership migration remains DRAFT / NOT APPLIED; legacy record ownership may be UNKNOWN."],
  ["Attendance and QR workflows", "PARTIALLY AVAILABLE", "Attendance records and QR/session workflows exist in source. Some legacy write routes remain blocked, and PostgreSQL production behavior is NOT TESTED."],
  ["Location information", "PARTIALLY AVAILABLE", "Some attendance attempts use foreground location and geofence checks. Exact retention, access, deletion and deployed permission behavior are NOT VERIFIED."],
  ["Face-verification data", "OPTIONAL; CONTROLS UNVERIFIED", "Face registration source stores reference image data and derived embeddings. Face is optional. Encryption at rest, retention, deletion, consent evidence handling and liveness are NOT VERIFIED or configured as a complete policy."],
  ["Guardian contact information", "PARTIALLY AVAILABLE", "A one-contact-per-student guardian record and notification source exist. College attribution and external message delivery are NOT VERIFIED."],
  ["Access permissions", "PARTIALLY AVAILABLE", "Protected routes, membership context and a default-deny gate exist. Complete isolation across every legacy API is not established."],
  ["Retention and deletion", "NOT CONFIGURED", "No approved global retention schedule or complete deletion guarantee was verified for these data categories."],
  ["External providers", "NOT VERIFIED", "No provider inventory or confirmed delivery configuration is included in the available public project evidence."],
  ["Rights and privacy contact", "NOT CONFIGURED", "The jurisdiction, legal entity, rights-request procedure and approved privacy contact have not been supplied."],
];

export default function PrivacyPolicyPage() {
  return (
    <PublicPageLayout
      eyebrow="Privacy"
      title="Privacy Policy - draft for review"
      description="This page is an evidence-based working draft about the current project. It is not an approved legal policy and must not be treated as ready for publication."
    >
      <div className="public-draft-banner"><strong>DRAFT - OWNER AND LEGAL REVIEW REQUIRED</strong><p>Do not publish as a final policy. The responsible legal entity, jurisdiction, official privacy contact, retention rules and user-rights process have not been verified.</p></div>
      <p>AttendX is being developed for college attendance management. The topics below distinguish implementation evidence from unknown or unconfigured policy. This page does not create consent, determine lawful basis, or make a regulatory-compliance claim.</p>
      <div className="public-status-list">
        {topics.map(([title, status, detail]) => (
          <article key={title}>
            <div><h3>{title}</h3><span className="public-status">{status}</span></div>
            <p>{detail}</p>
          </article>
        ))}
      </div>
      <h2>Information still needed before publication</h2>
      <ul>
        <li>Owner-approved data purposes, lawful basis and notice timing for each category.</li>
        <li>Approved retention, deletion, backup and account-closure rules.</li>
        <li>Verified service-provider inventory and data-processing responsibilities.</li>
        <li>Responsible legal entity, applicable jurisdiction and official privacy contact.</li>
        <li>Owner and qualified legal review of the final policy and user-rights process.</li>
      </ul>
      <p className="public-page-footer-note">No encryption-at-rest, end-to-end encryption, fixed retention period, deletion guarantee or regulatory compliance is claimed by this draft.</p>
    </PublicPageLayout>
  );
}
