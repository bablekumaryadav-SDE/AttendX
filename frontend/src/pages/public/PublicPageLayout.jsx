import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { PublicSiteFooter, PublicSiteHeader } from "../../components/public/PublicSiteChrome";
import "../LandingPage.css";
import "./PublicPages.css";

function usePageMetadata(title, description) {
  useEffect(() => {
    const oldTitle = document.title;
    let meta = document.querySelector('meta[name="description"]');
    const oldDescription = meta?.getAttribute("content");
    const created = !meta;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    document.title = `${title} | AttendX`;
    meta.setAttribute("content", description);

    return () => {
      document.title = oldTitle;
      if (created) meta.remove();
      else if (oldDescription !== null) meta.setAttribute("content", oldDescription);
    };
  }, [title, description]);
}

export default function PublicPageLayout({ eyebrow, title, description, children }) {
  usePageMetadata(title, description);

  return (
    <div className="site-shell public-page-shell">
      <a className="site-skip-link" href="#public-page-content">Skip to content</a>
      <PublicSiteHeader />
      <main id="public-page-content" className="public-page-main">
        <div className="site-container">
          <nav className="public-breadcrumb" aria-label="Breadcrumb">
            <Link to="/">Home</Link><span aria-hidden="true">/</span><span aria-current="page">{title}</span>
          </nav>
          <header className="public-page-heading">
            <span className="site-kicker">{eyebrow}</span>
            <h1>{title}</h1>
            <p>{description}</p>
          </header>
          <div className="public-page-content">{children}</div>
        </div>
      </main>
      <PublicSiteFooter />
    </div>
  );
}
