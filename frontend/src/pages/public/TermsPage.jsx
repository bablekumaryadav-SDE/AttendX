import React from "react";
import PublicPageLayout from "./PublicPageLayout";

const topics = [
  ["Accounts and access", "DRAFT TOPIC", "The intended product uses authenticated, role-aware workspaces. Account lifecycle, recovery and user obligations require owner and legal decisions."],
  ["College administration", "PARTIALLY IMPLEMENTED IN SOURCE", "Registration and application review code exists, but the required migration is DRAFT / NOT APPLIED. Account activation, invitations and full College management are unavailable."],
  ["Attendance participation", "DRAFT TOPIC", "Teacher and student attendance workflows are being developed. No operational attendance submission or correction terms are established here."],
  ["QR, location and face verification", "PARTIALLY AVAILABLE", "Some verification source exists; policies, availability and requirements depend on workflows that are not fully enabled. Face verification is optional; liveness is unavailable."],
  ["Acceptable use and security", "DRAFT TOPIC", "Appropriate account and system-use rules require owner and legal review. This page does not establish a security warranty."],
  ["Availability and support", "NOT CONFIGURED", "No uptime commitment, service level, support contact or dispute process has been verified."],
  ["Subscriptions and payment", "NOT CONFIGURED", "No verified subscription plans, prices, payment provider, refund rules or cancellation terms are configured."],
  ["Limitations and legal terms", "REVIEW REQUIRED", "Jurisdiction, legal entity, liability, dispute resolution and other enforceable terms must be supplied and approved by the owner and qualified legal counsel."],
];

export default function TermsPage() {
  return (
    <PublicPageLayout
      eyebrow="Terms"
      title="Terms of Use - draft outline"
      description="This non-binding outline records topics that need decisions. It is not a contract, consent screen or approved set of terms."
    >
      <div className="public-draft-banner"><strong>DRAFT - OWNER AND LEGAL REVIEW REQUIRED</strong><p>Not approved for publication or reliance. No user acceptance or consent is collected on this page.</p></div>
      <p>The notes below describe product topics only. They do not create contractual obligations and do not replace owner-approved terms prepared for the correct legal entity and jurisdiction.</p>
      <div className="public-status-list">
        {topics.map(([title, status, detail]) => (
          <article key={title}>
            <div><h3>{title}</h3><span className="public-status">{status}</span></div>
            <p>{detail}</p>
          </article>
        ))}
      </div>
      <h2>Required before these terms can be finalized</h2>
      <ul>
        <li>Verified legal entity, jurisdiction, official address and support/contact method.</li>
        <li>Approved account, attendance, correction, subscription and cancellation policies.</li>
        <li>Owner and qualified legal review, followed by an explicit publication decision.</li>
      </ul>
      <p className="public-page-footer-note">No prices, refunds, arbitration, uptime guarantees, liability limits or legal jurisdiction are invented here.</p>
    </PublicPageLayout>
  );
}
