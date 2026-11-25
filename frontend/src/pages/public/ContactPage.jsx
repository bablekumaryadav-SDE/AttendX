import React from "react";
import PublicPageLayout from "./PublicPageLayout";

export default function ContactPage() {
  return (
    <PublicPageLayout
      eyebrow="Contact"
      title="Official contact details are not published yet."
      description="AttendX does not currently have a verified public support email, phone number, business address or social channel available in the approved project information."
    >
      <div className="public-callout"><strong>Contact information unavailable.</strong> No message form is shown because there is no verified submission service. Please do not send personal or attendance information through this page.</div>
      <p>Official contact information can be added after the owner confirms which public channel should be published.</p>
    </PublicPageLayout>
  );
}
