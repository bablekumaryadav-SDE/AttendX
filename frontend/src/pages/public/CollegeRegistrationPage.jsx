import React, { useState } from "react";
import PublicPageLayout from "./PublicPageLayout";
import {
  checkCollegeRegistrationStatus,
  submitCollegeRegistration,
} from "../../services/collegeRegistration";
import { getApiErrorMessage } from "../../utils/errors";

const INITIAL_FORM = {
  college_name: "", college_type: "", address: "", city: "", state: "",
  postal_code: "", country: "", official_email: "", contact_number: "",
  website: "", admin_name: "", admin_email: "", admin_contact_number: "",
  password: "", password_confirmation: "",
};

function registrationErrorMessage(error) {
  const responseStatus = error?.response?.status;
  if (responseStatus === 503) {
    return "The registration service could not confirm this submission because its storage is unavailable. Please contact support before retrying.";
  }
  if (!error?.response) {
    return "Registration is temporarily unavailable. Please try again later.";
  }
  if (responseStatus === 409) {
    return getApiErrorMessage(
      error,
      "A registration may already exist for these details. If you have its reference and private tracking token, use Check application status; otherwise review the submitted details.",
    );
  }
  if (responseStatus === 422) {
    return getApiErrorMessage(error, "Review the highlighted registration fields and try again.");
  }
  if (responseStatus >= 500) {
    return "Registration is temporarily unavailable. Please try again later.";
  }
  return getApiErrorMessage(error, "The application could not be submitted. Please try again later.");
}

export default function CollegeRegistrationPage() {
  const [form, setForm] = useState(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [submission, setSubmission] = useState(null);
  const [statusForm, setStatusForm] = useState({ application_reference: "", tracking_token: "" });
  const [applicationStatus, setApplicationStatus] = useState(null);

  function updateForm(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setApplicationStatus(null);
    setSubmitting(true);
    try {
      const result = await submitCollegeRegistration({
        ...form,
        website: form.website.trim() || null,
      });
      setSubmission(result);
      setStatusForm({ application_reference: result.application_reference, tracking_token: result.tracking_token });
      setForm(INITIAL_FORM);
    } catch (requestError) {
      setError(registrationErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatus(event) {
    event.preventDefault();
    if (checking) return;
    setError("");
    setApplicationStatus(null);
    setChecking(true);
    try {
      const result = await checkCollegeRegistrationStatus(statusForm);
      setApplicationStatus(result);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Application status is unavailable. Check the reference and tracking token."));
    } finally {
      setChecking(false);
    }
  }

  return (
    <PublicPageLayout
      eyebrow="College onboarding"
      title="Apply to bring your college to AttendX."
      description="Submit an application for Super Admin review. Submission does not activate a College or account."
    >
      <div className="registration-notice" role="note">
        <strong>Activation is not automatic.</strong> If approved, the College Admin account remains inactive and the membership remains pending until a verified activation process is available. No invitation email is currently sent.
      </div>
      {error && <p className="registration-error" role="alert">{error}</p>}
      {submission && (
        <section className="registration-success" role="status" aria-live="polite">
          <h2>Application received</h2>
          <p>The backend confirmed the application record. Save this reference and tracking token now; the token is shown only in this response and is not saved in this browser.</p>
          <dl><dt>Reference</dt><dd>{submission.application_reference}</dd><dt>Status</dt><dd>{submission.status}</dd><dt>Tracking token</dt><dd><code>{submission.tracking_token}</code></dd></dl>
        </section>
      )}

      <form className="registration-form" onSubmit={handleSubmit}>
        <h2>College details</h2>
        <div className="registration-grid">
          <label>Official college name<input name="college_name" value={form.college_name} onChange={updateForm} required maxLength={200} autoComplete="organization" /></label>
          <label>College type<input name="college_type" value={form.college_type} onChange={updateForm} required maxLength={80} /></label>
          <label className="registration-wide">Address<input name="address" value={form.address} onChange={updateForm} required maxLength={255} autoComplete="street-address" /></label>
          <label>City<input name="city" value={form.city} onChange={updateForm} required maxLength={100} autoComplete="address-level2" /></label>
          <label>State / region<input name="state" value={form.state} onChange={updateForm} required maxLength={100} autoComplete="address-level1" /></label>
          <label>Postal code<input name="postal_code" value={form.postal_code} onChange={updateForm} required maxLength={20} autoComplete="postal-code" /></label>
          <label>Country<input name="country" value={form.country} onChange={updateForm} required maxLength={80} autoComplete="country-name" /></label>
          <label>Official email<input name="official_email" type="email" value={form.official_email} onChange={updateForm} required maxLength={254} autoComplete="email" /></label>
          <label>Official phone<input name="contact_number" type="tel" value={form.contact_number} onChange={updateForm} required placeholder="+14155550123" autoComplete="tel" /></label>
          <label className="registration-wide">Website (optional)<input name="website" type="url" value={form.website} onChange={updateForm} maxLength={2048} placeholder="https://example.edu" autoComplete="url" /></label>
        </div>

        <h2>Authorized representative and proposed College Admin</h2>
        <div className="registration-grid">
          <label>Full name<input name="admin_name" value={form.admin_name} onChange={updateForm} required maxLength={120} autoComplete="name" /></label>
          <label>Official email<input name="admin_email" type="email" value={form.admin_email} onChange={updateForm} required maxLength={150} autoComplete="username" /></label>
          <label>Contact number<input name="admin_contact_number" type="tel" value={form.admin_contact_number} onChange={updateForm} required placeholder="+14155550124" autoComplete="tel" /></label>
          <label>Password<input name="password" type="password" value={form.password} onChange={updateForm} required minLength={12} maxLength={72} autoComplete="new-password" /></label>
          <label>Password confirmation<input name="password_confirmation" type="password" value={form.password_confirmation} onChange={updateForm} required minLength={12} maxLength={72} autoComplete="new-password" /></label>
        </div>
        <p className="registration-help">Use at least 12 characters with uppercase, lowercase, a number and a symbol. The server validates every field. The password is never returned; only a one-way hash is stored while the application is pending.</p>
        <button className="registration-submit" type="submit" disabled={submitting}>{submitting ? "Submitting…" : "Submit application"}</button>
      </form>

      <section className="registration-status-section" aria-labelledby="registration-status-title">
        <h2 id="registration-status-title">Check application status</h2>
        <p>Use the reference and private tracking token returned at submission. Do not share the token.</p>
        <form className="registration-status-form" onSubmit={handleStatus}>
          <label>Application reference<input value={statusForm.application_reference} onChange={(event) => setStatusForm((s) => ({ ...s, application_reference: event.target.value }))} required autoComplete="off" /></label>
          <label>Tracking token<input type="password" value={statusForm.tracking_token} onChange={(event) => setStatusForm((s) => ({ ...s, tracking_token: event.target.value }))} required autoComplete="off" /></label>
          <button type="submit" disabled={checking}>{checking ? "Checking…" : "Check status"}</button>
        </form>
        {applicationStatus && <p className="registration-status-result" role="status">Application {applicationStatus.application_reference}: <strong>{applicationStatus.status.replaceAll("_", " ")}</strong></p>}
      </section>
    </PublicPageLayout>
  );
}
