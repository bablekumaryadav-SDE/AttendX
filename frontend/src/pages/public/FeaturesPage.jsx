import React from "react";
import PublicPageLayout from "./PublicPageLayout";
import { featureGroups } from "./featureCatalog";

function FeatureStatus({ value }) {
  const key = value.toLowerCase().replaceAll(" ", "-");
  return <span className="public-status" data-status={key}>{value}</span>;
}

export default function FeaturesPage() {
  return (
    <PublicPageLayout
      eyebrow="Features"
      title="Capabilities with clear availability."
      description="AttendX includes attendance and verification work in progress. Each status reflects current source and project verification, not a promise that every workflow is enabled."
    >
      <div className="public-callout"><strong>Availability note:</strong> The tenant ownership migration is not applied. Legacy business writes remain default-denied, and selected read-only APIs do not represent complete College management.</div>
      {featureGroups.map((group) => (
        <section key={group.title} aria-labelledby={`feature-${group.title.toLowerCase().replaceAll(" ", "-")}`}>
          <h2 id={`feature-${group.title.toLowerCase().replaceAll(" ", "-")}`}>{group.title}</h2>
          <div className="public-status-list">
            {group.features.map(([name, status, detail]) => (
              <article key={name}>
                <div><h3>{name}</h3><FeatureStatus value={status} /></div>
                <p>{detail}</p>
              </article>
            ))}
          </div>
        </section>
      ))}
    </PublicPageLayout>
  );
}
