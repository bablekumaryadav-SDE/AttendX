import React from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown, ArrowRight, ArrowUpRight, BarChart3, BookOpenCheck, Check,
  ChevronDown, CircleHelp, Fingerprint, GraduationCap, MapPin, QrCode,
  ShieldCheck, Users, Zap,
} from "lucide-react";
import { PublicSiteFooter, PublicSiteHeader } from "../components/public/PublicSiteChrome";
import "./LandingPage.css";

const features = [
  { icon: QrCode, title: "Dynamic QR attendance", status: "Partial", detail: "QR session flows exist in the legacy attendance implementation; tenant-safe attendance writes are not enabled." },
  { icon: MapPin, title: "GPS and geofencing", status: "Partial", detail: "Location checks exist in source. Device spoof resistance and every tenant workflow are not verified." },
  { icon: Fingerprint, title: "Optional face verification", status: "Partial", detail: "Face matching and camera flows exist. Face use is not mandatory; this does not establish liveness." },
  { icon: ShieldCheck, title: "Liveness detection", status: "Unavailable", detail: "Liveness detection and anti-spoofing are not implemented or verified." },
  { icon: ShieldCheck, title: "Duplicate prevention", status: "Partial", detail: "Duplicate protections exist in selected attendance flows; full PostgreSQL validation is outstanding." },
  { icon: BarChart3, title: "Attendance summaries and reports", status: "Partial", detail: "Selected tenant-scoped summaries are available. Legacy reports and broader analytics remain unavailable." },
  { icon: QrCode, title: "Attendance tracking", status: "Partial", detail: "Attendance history and selected read views exist; a complete tenant-safe attendance lifecycle is not enabled." },
  { icon: Users, title: "Secure role-based access", status: "Partial", detail: "Role-protected workspaces exist; not every dashboard action is enabled." },
  { icon: GraduationCap, title: "Multi-college management", status: "In development", detail: "Membership selection and selected read APIs exist. Ownership migration is still a draft and business writes remain blocked." },
  { icon: Zap, title: "Guardian notifications", status: "Not verified", detail: "Notification source exists, but tenant attribution and external delivery are not verified." },
];

const roles = [
  { name: "Super Admin", icon: ShieldCheck, text: "Platform-level entry point. College operations and platform management workflows are not yet available." },
  { name: "College Admin", icon: GraduationCap, text: "College workspace with selected read-only tenant views. Business management writes remain unavailable." },
  { name: "Teacher", icon: BookOpenCheck, text: "Teacher workspace and attendance pages exist; tenant-safe session creation is not enabled." },
  { name: "Student", icon: Users, text: "Student workspace and attendance views exist; available information depends on enabled routes." },
];

const dashboardPreviews = [
  { name: "Super Admin", label: "Illustrative preview", items: ["Platform overview", "Application review: in development", "Activation: unavailable"] },
  { name: "College Admin", label: "Illustrative preview", items: ["College summary", "Selected student views", "Management writes: unavailable"] },
  { name: "Teacher", label: "Illustrative preview", items: ["Teaching workspace", "Attendance views", "Session actions: limited"] },
  { name: "Student", label: "Illustrative preview", items: ["Student workspace", "Attendance history", "Personal academic views"] },
];

const faqs = [
  ["What is AttendX?", "AttendX is a college attendance product in development, with protected workspaces and selected tenant-scoped read views."],
  ["How does QR attendance work?", "QR attendance flows exist in source, but the tenant-safe end-to-end attendance workflow is not currently enabled for this website."],
  ["Is GPS verification required?", "GPS checks are present in some attendance flows. Whether they apply depends on the configured workflow; universal enforcement is not claimed."],
  ["Is face recognition compulsory?", "No. Face verification is optional in the existing implementation. Liveness detection is not available."],
  ["Can students access their dashboard outside college?", "The student workspace is protected by sign-in. Location and attendance rules depend on the workflow; no general access promise is made here."],
  ["Can multiple colleges use AttendX?", "A multi-college foundation and selected read APIs exist. The ownership migration is not applied and complete multi-college management is not ready."],
  ["How can a college register?", "A registration form and review workflow are implemented in source, but the database migration is not applied. Applications may be unavailable until the reviewed schema is installed; approval does not activate an account."],
  ["How are absence notifications sent?", "Notification code exists, but delivery-provider configuration and successful delivery have not been verified."],
];

function SectionTitle({ kicker, title, description, align = "center" }) {
  return <div className={`site-section-title site-section-title-${align}`}>
    <span className="site-kicker">{kicker}</span><h2>{title}</h2><p>{description}</p>
  </div>;
}

export default function LandingPage() {
  return <div className="site-shell" id="home">
    <a className="site-skip-link" href="#main-content">Skip to content</a>
    <PublicSiteHeader />
    <main id="main-content">
      <section className="site-hero" aria-labelledby="hero-title">
        <div className="site-container site-hero-grid">
          <div className="site-hero-copy">
            <span className="site-pill"><span className="site-pill-dot" /> College attendance, thoughtfully designed</span>
            <h1 id="hero-title">Smart Attendance.<br /><span>Smarter Campus Management.</span></h1>
            <p>AttendX is designed to simplify college attendance management through digital attendance workflows, classroom verification and centralized administration.</p>
            <div className="site-hero-actions">
              <Link className="site-button site-button-quiet" to="/register-college">Register your College</Link>
              <Link className="site-button site-button-primary" to="/login">Login <ArrowUpRight size={17} /></Link>
              <a className="site-button site-button-quiet" href="#features">Explore features <ArrowDown size={16} /></a>
            </div>
            <p className="site-hero-note">Applications are reviewed before provisioning. Approved accounts still require verified activation.</p>
          </div>
          <div className="site-preview-wrap" aria-label="Illustrative product preview">
            <div className="site-preview-glow" />
            <div className="site-preview-card">
              <div className="site-preview-top"><div><span>ATTENDX WORKSPACE</span><strong>Campus overview</strong></div><span className="site-preview-tag">Illustrative preview</span></div>
              <div className="site-preview-welcome"><span className="site-preview-monogram">AX</span><div><small>YOUR CAMPUS, AT A GLANCE</small><strong>Attendance, organized.</strong><span>Sample interface · no live data</span></div></div>
              <div className="site-preview-stats"><div><span className="site-stat-icon"><QrCode size={18} /></span><small>WORKFLOW</small><strong>Session-based</strong><span>Availability varies</span></div><div><span className="site-stat-icon site-stat-icon-alt"><BarChart3 size={18} /></span><small>OVERVIEW</small><strong>Selected summaries</strong><span>Read-only views</span></div></div>
              <div className="site-preview-list"><span className="site-preview-list-icon"><Check size={16} /></span><div><strong>Built around clear access</strong><small>Protected workspaces · illustrative only</small></div><ArrowRight size={17} /></div>
            </div>
            <div className="site-preview-caption">Illustrative preview — not a live dashboard</div>
          </div>
        </div>
      </section>

      <section className="site-proof-strip" aria-label="Product principles"><div className="site-container site-proof-inner"><span>Designed for college workflows</span><i /><span>Role-aware access</span><i /><span>Tenant foundation in progress</span></div></section>

      <section className="site-section site-features" id="features">
        <div className="site-container"><SectionTitle kicker="CAPABILITIES" title="Attendance workflows, built with care." description="Explore the capabilities in AttendX. Availability varies while tenant workflows and verification continue." />
          <div className="site-feature-grid">{features.map(({ icon: Icon, title, detail, status }) => <article className="site-feature-card" key={title} data-status={status.toLowerCase().replaceAll(" ", "-")}><div className="site-feature-top"><span className="site-feature-icon"><Icon size={20} strokeWidth={1.8} /></span><span className="site-status">{status}</span></div><h3>{title}</h3><p>{detail}</p></article>)}</div>
        </div>
      </section>

      <section className="site-section site-workflow" id="how-it-works">
        <div className="site-container site-workflow-grid"><div><span className="site-kicker">HOW IT WORKS</span><h2>A clearer path from campus to classroom.</h2><p>These steps describe the intended product journey. Registration and review code now exists, but the migration is unapplied and account activation is unavailable.</p><span className="site-development-note"><CircleHelp size={17} /> Illustrative journey — not every step is available today</span></div>
          <ol className="site-steps"><li><span>01</span><div><strong>College onboarding</strong><p>Public application and Super Admin review are implemented in source. The required migration is DRAFT / NOT APPLIED; approved accounts remain pending activation.</p><em>In development</em></div></li><li><span>02</span><div><strong>Set up a workspace</strong><p>Authorized users access features currently enabled for their role and College membership.</p><em>In development</em></div></li><li><span>03</span><div><strong>Run attendance workflows</strong><p>QR, location and optional face flows exist in source; tenant-safe session creation is not enabled.</p><em>Partially implemented</em></div></li><li><span>04</span><div><strong>Review available summaries</strong><p>Selected read-only tenant views are available. Broader reports remain unavailable.</p><em>Limited availability</em></div></li></ol>
        </div>
      </section>

      <section className="site-section site-roles" id="roles"><div className="site-container"><SectionTitle kicker="PURPOSE-BUILT ACCESS" title="A workspace for every role." description="Existing accounts sign in through the current AttendX login. The scope of available actions depends on enabled workflows." /><div className="site-role-grid">{roles.map(({ name, icon: Icon, text }) => <article className="site-role-card" key={name}><span className="site-role-icon"><Icon size={21} /></span><h3>{name}</h3><p>{text}</p><Link to="/login">Sign in <ArrowRight size={15} /></Link></article>)}</div></div></section>

      <section className="site-section site-dashboards"><div className="site-container"><SectionTitle kicker="PRODUCT PREVIEW" title="A considered view of each workspace." description="Synthetic interface concepts only. These are not screenshots and contain no live or personal data." /><div className="site-dashboard-grid">{dashboardPreviews.map((preview) => <article className="site-dashboard-card" key={preview.name}><div className="site-dashboard-heading"><span className="site-dashboard-avatar">{preview.name.split(" ").map((part) => part[0]).join("")}</span><div><strong>{preview.name}</strong><small>{preview.label}</small></div><ChevronDown size={17} /></div><div className="site-dashboard-lines"><span /><span /><span /></div><ul>{preview.items.map((item) => <li key={item}><span />{item}</li>)}</ul></article>)}</div></div></section>

      <section className="site-section site-benefits" id="benefits"><div className="site-container site-benefits-grid"><div><span className="site-kicker">WHY ATTENDX</span><h2>Less friction around the school day.</h2><p>Bring attendance workflows and the information people need into a clearer digital experience—at a pace that keeps access and accuracy in view.</p><Link className="site-text-link" to="/login">Explore your workspace <ArrowRight size={16} /></Link></div><div className="site-benefit-list"><div><Check /><span><strong>Reduce manual steps</strong><small>Move attendance processes into structured digital workflows.</small></span></div><div><Check /><span><strong>Make records easier to review</strong><small>Provide protected views for information currently available.</small></span></div><div><Check /><span><strong>Keep access role-aware</strong><small>Use dedicated sign-in and protected workspaces.</small></span></div><div><Check /><span><strong>Build toward tenant-aware operations</strong><small>Selected College-scoped APIs are a foundation, not complete SaaS management.</small></span></div></div></div></section>

      <section className="site-section site-security" id="about"><div className="site-container site-security-panel"><div><span className="site-kicker">ABOUT ATTENDX</span><h2>Smart workflows.<br />Responsible access.</h2><p>AttendX is designed to modernize college attendance management through intelligent verification, centralized administration and reliable digital attendance workflows.</p><p className="site-security-caveat">Tenant ownership migration remains a draft. Complete isolation across legacy APIs and production security have not been established.</p></div><div className="site-security-points"><div><ShieldCheck /><span><strong>Protected sign-in</strong><small>Existing workspaces require authentication.</small></span></div><div><Users /><span><strong>College-aware foundation</strong><small>Membership selection and selected scoped reads exist.</small></span></div><div><Fingerprint /><span><strong>Verification with limits</strong><small>Face is optional. Liveness and perfect spoof prevention are not claimed.</small></span></div></div></div></section>

      <section className="site-section site-pricing" id="pricing"><div className="site-container site-pricing-panel"><div><span className="site-kicker">PRICING</span><h2>Plans are not configured yet.</h2><p>AttendX has no verified subscription plans or prices to publish. Contact-based pricing details are not available in the current public configuration.</p></div><span className="site-pricing-label">Contact Us for Pricing <small>Details available when plans are published</small></span></div></section>

      <section className="site-section site-registration" id="contact"><div className="site-container site-registration-panel"><div><span className="site-kicker">COLLEGE ONBOARDING</span><h2>Bring Your College to AttendX.</h2><p>Submit an application for review. Submission does not activate a College or administrator account.</p><p className="site-contact-note">A verified public contact method is not configured.</p></div><Link className="site-button site-button-primary" to="/register-college">Start registration</Link></div></section>

      <section className="site-section site-faq" id="faq"><div className="site-container site-faq-layout"><div><span className="site-kicker">GOOD TO KNOW</span><h2>Frequently asked questions.</h2><p>Clear answers about what is available today and what is still being built.</p></div><div className="site-faq-list">{faqs.map(([question, answer]) => <details key={question}><summary>{question}<ChevronDown size={18} /></summary><p>{answer}</p></details>)}</div></div></section>
    </main>
    <PublicSiteFooter />
  </div>;
}
