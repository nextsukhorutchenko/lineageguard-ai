import type { WorkflowSnapshot } from "../workflow/contracts.js";

export function EvidencePanel({ snapshot }: { readonly snapshot: WorkflowSnapshot | undefined }) {
  return (
    <section className="panel evidence-panel" aria-labelledby="evidence-title">
      <div className="section-heading">
        <p className="eyebrow">DataHub evidence</p>
        <h2 id="evidence-title">Why the agent stopped the rename</h2>
      </div>
      <ul className="evidence-list">
        {(snapshot?.evidence ?? []).map((item) => (
          <li key={item.id}>
            <span className={`evidence-level ${item.level}`}>{item.level}</span>
            <span>
              <code className="urn">{item.urn}</code>
              <small>Evidence ID: {item.id}</small>
              {item.fieldPath === undefined ? null : <small>Field: {item.fieldPath}</small>}
            </span>
            {item.hop === undefined ? null : <span>hop {item.hop}</span>}
          </li>
        ))}
      </ul>
      {snapshot?.assumptions.map((assumption) => (
        <p className="muted" key={assumption}>
          Assumption: {assumption}
        </p>
      ))}
      {snapshot?.unknowns.map((unknown) => (
        <p className="unknown" key={unknown}>
          {unknown}
        </p>
      ))}
    </section>
  );
}
