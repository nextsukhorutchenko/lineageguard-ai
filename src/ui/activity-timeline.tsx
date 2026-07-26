import type { ActivityEntry } from "../workflow/contracts.js";

export function ActivityTimeline({ entries }: { readonly entries: readonly ActivityEntry[] }) {
  return (
    <section className="panel" aria-labelledby="activity-title">
      <div className="section-heading">
        <p className="eyebrow">Agent activity</p>
        <h2 id="activity-title">Grounded workflow</h2>
      </div>
      <ol className="timeline" aria-live="polite">
        {entries.length === 0 ? <li className="muted">Ready for one supported rename.</li> : null}
        {entries.map((entry, index) => (
          <li key={`${entry.at}-${index}`} data-outcome={entry.outcome}>
            <span className="timeline-dot" aria-hidden="true" />
            <div>
              <strong>{entry.label}</strong>
              <span>
                {entry.status.replaceAll("_", " ")}
                {entry.durationMs === undefined ? "" : ` · ${entry.durationMs} ms`}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
