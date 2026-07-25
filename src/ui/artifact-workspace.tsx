import { useState } from "react";
import type { WorkflowSnapshot } from "../workflow/contracts.js";

export type ArtifactContent = Readonly<Record<string, string>>;

export function ArtifactWorkspace(props: {
  readonly snapshot: WorkflowSnapshot | undefined;
  readonly content: ArtifactContent;
  readonly onRegenerate: () => void;
}) {
  const names = props.snapshot?.artifacts.map(({ filename }) => filename) ?? [];
  const [active, setActive] = useState<string>("migration-up.sql");
  if (names.length === 0) {
    return (
      <section className="panel artifact-panel">
        <p className="muted">Validated artifacts will appear here.</p>
      </section>
    );
  }
  const selected = names.some((name) => name === active) ? active : names[0]!;
  return (
    <section className="panel artifact-panel" aria-labelledby="artifact-title">
      <div className="artifact-header">
        <div>
          <p className="eyebrow">Migration package</p>
          <h2 id="artifact-title">Review before execution</h2>
        </div>
        <button className="quiet-button" type="button" onClick={props.onRegenerate}>
          Regenerate
        </button>
      </div>
      <div className="tabs" role="tablist">
        {names.map((name) => (
          <button
            key={name}
            role="tab"
            aria-selected={name === selected}
            onClick={() => setActive(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="artifact-actions">
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(props.content[selected] ?? "")}
        >
          Copy
        </button>
        <a href={`/api/runs/${props.snapshot!.runId}/artifacts/${selected}`} download={selected}>
          Download
        </a>
      </div>
      <pre tabIndex={0}>
        <code>{props.content[selected] ?? "Loading artifact…"}</code>
      </pre>
    </section>
  );
}
