import type { WorkflowSnapshot } from "../workflow/contracts.js";

export function ImpactPanel({ snapshot }: { readonly snapshot: WorkflowSnapshot | undefined }) {
  const impact = snapshot?.impact;
  return (
    <section className="panel impact-panel" aria-labelledby="impact-title">
      <div className="section-heading">
        <p className="eyebrow">Deterministic impact</p>
        <h2 id="impact-title">Blast radius</h2>
      </div>
      {impact === undefined ? (
        <p className="muted">DataHub evidence will appear here.</p>
      ) : (
        <>
          <div className="risk-row">
            <div className="risk-score">
              <span>{impact.score}</span>
              <small>/100</small>
            </div>
            <div>
              <strong>{impact.level[0]!.toUpperCase() + impact.level.slice(1)} risk</strong>
              <p>{impact.confidence} confidence</p>
            </div>
          </div>
          <div className="metric-grid">
            <span>
              <strong>{impact.downstreamAssets}</strong> downstream
            </span>
            <span>
              <strong>{impact.columnAffectedAssets}</strong> column-confirmed
            </span>
          </div>
          <p>
            Evidence level: <strong>{impact.evidenceLevel}</strong>
          </p>
          <ul>
            {impact.factors.map((factor) => (
              <li key={factor.name}>
                <strong>
                  {factor.name}: {factor.points} points.
                </strong>{" "}
                {factor.explanation}
              </li>
            ))}
          </ul>
          <div className="decision-badge">{impact.advisoryDecision.replaceAll("_", " ")}</div>
        </>
      )}
    </section>
  );
}
