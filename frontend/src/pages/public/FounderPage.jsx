import React from "react";
import PublicPageLayout from "./PublicPageLayout";

export default function FounderPage() {
  return (
    <PublicPageLayout
      eyebrow="Founder"
      title="A clear note of ownership."
      description="AttendX publicly credits its founder and owner without adding unverified personal or company history."
    >
      <p className="public-owner-credit">Founded and Owned by Bablu Kumar Yadav.</p>
      <p>No verified biography, photograph, qualifications, employment history, awards or personal achievements were supplied for publication. This page intentionally does not invent them.</p>
    </PublicPageLayout>
  );
}
