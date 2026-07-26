import type { WorkflowSnapshot } from "../workflow/contracts.js";

const labelReason = (reason: string): string => reason.replaceAll("_", " ");

export function ContextCoveragePanel({
  snapshot,
}: {
  readonly snapshot: WorkflowSnapshot | undefined;
}) {
  const completeness = snapshot?.evidenceCompleteness;
  const retrieval = snapshot?.entityContextRetrieval;
  const coverage = snapshot?.contextCoverage;
  const indicators = snapshot?.contextIndicators;
  const dimensions =
    completeness === undefined
      ? []
      : ([
          ["search", completeness.search],
          ["list_schema_fields", completeness.schema],
          ["get_lineage · table", completeness.tableLineage],
          ["get_lineage · column", completeness.columnLineage],
        ] as const);

  return (
    <section className="panel context-panel" aria-labelledby="completeness-title">
      <div className="coverage-grid">
        <div>
          <p className="eyebrow">Safety gate</p>
          <h2 id="completeness-title">Evidence completeness</h2>
          {completeness === undefined ? (
            <p className="muted">Run an analysis to inspect collection completeness.</p>
          ) : (
            <>
              <strong className={completeness.complete ? "complete" : "unknown"}>
                {completeness.complete ? "Evidence complete" : "Incomplete evidence"}
              </strong>
              {!completeness.complete && (
                <p className="unknown">Collected counts are lower bounds.</p>
              )}
              <ul className="coverage-list">
                {dimensions.map(([name, collection]) => (
                  <li key={name}>
                    <span>{name}</span>
                    <span>{collection.complete ? "complete" : "incomplete"}</span>
                    <small>
                      {collection.itemCount} items · {collection.pages} pages
                    </small>
                    {collection.reasonCodes.map((reason) => (
                      <small className="unknown" key={reason}>
                        {labelReason(reason)}
                      </small>
                    ))}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div aria-labelledby="coverage-title">
          <p className="eyebrow">Metadata readiness</p>
          <h2 id="coverage-title">Context coverage</h2>
          {coverage === undefined ? (
            <p className="muted">Context appears after DataHub enrichment.</p>
          ) : (
            <>
              <strong className="coverage-score">
                {coverage.percentage === null ? "Not measurable" : `${coverage.percentage}%`}
              </strong>
              <p>
                {coverage.inspectedAssets} of {coverage.relevantAssets} assets inspected
              </p>
              <p>{coverage.retrievalPercentage}% retrieval coverage</p>
              {retrieval !== undefined && (
                <div className="retrieval-state">
                  <strong>
                    Entity context retrieval {retrieval.complete ? "complete" : "incomplete"}
                  </strong>
                  <p>
                    <code>get_entities</code> · {retrieval.itemCount} entities · {retrieval.pages}{" "}
                    batches
                  </p>
                  {retrieval.reasonCodes.map((reason) => (
                    <small className="unknown" key={reason}>
                      {labelReason(reason)}
                    </small>
                  ))}
                </div>
              )}
              <ul className="coverage-counts">
                <li>{coverage.withDescriptions} with descriptions</li>
                <li>{coverage.withOwners} with owners</li>
                <li>{coverage.withGovernance} with tags or glossary terms</li>
              </ul>
              {indicators !== undefined && (
                <div className="indicator-summary" aria-label="Quality and usage indicators">
                  <p>
                    Quality indicators: {indicators.quality.signalCount} signals across{" "}
                    {indicators.quality.assetsWithSignals} assets
                  </p>
                  <p>Usage indicators not collected in the four-tool read-only slice.</p>
                </div>
              )}
              {coverage.missingMetadataUrns.length > 0 && (
                <details>
                  <summary>
                    Missing metadata on {coverage.missingMetadataUrns.length} inspected assets
                  </summary>
                  <ul className="urn-list">
                    {coverage.missingMetadataUrns.map((urn) => (
                      <li key={urn}>
                        <code>{urn}</code>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {coverage.unknownMetadataUrns.length > 0 && (
                <details className="unknown">
                  <summary>
                    Metadata retrieval is unknown for {coverage.unknownMetadataUrns.length} assets
                  </summary>
                  <ul className="urn-list">
                    {coverage.unknownMetadataUrns.map((urn) => (
                      <li key={urn}>
                        <code>{urn}</code>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
