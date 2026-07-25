import { useId, useState } from "react";
import type { WorkflowSnapshot } from "../workflow/contracts.js";

export type ArtifactContent = Readonly<Record<string, string>>;

export function ArtifactWorkspace(props: {
  readonly snapshot: WorkflowSnapshot | undefined;
  readonly content: ArtifactContent;
  readonly onRegenerate: () => void;
  readonly busy?: boolean;
  readonly onStatus?: (message: string) => void;
}) {
  const names = props.snapshot?.artifacts.map(({ filename }) => filename) ?? [];
  const [active, setActive] = useState<string>("migration-up.sql");
  const id = useId();
  if (names.length === 0) {
    return (
      <section className="panel artifact-panel">
        <p className="muted">Validated artifacts will appear here.</p>
      </section>
    );
  }
  const selected = names.find((name) => name === active) ?? names[0]!;
  return (
    <section
      className="panel artifact-panel"
      aria-labelledby="artifact-title"
      data-run-id={props.snapshot!.runId}
    >
      <div className="artifact-header">
        <div>
          <p className="eyebrow">Migration package</p>
          <h2 id="artifact-title">Review before execution</h2>
        </div>
        <button
          className="quiet-button"
          type="button"
          onClick={props.onRegenerate}
          disabled={props.busy}
        >
          Regenerate
        </button>
      </div>
      <div className="tabs" role="tablist" aria-label="Migration artifacts">
        {names.map((name, index) => (
          <button
            key={name}
            role="tab"
            aria-selected={name === selected}
            aria-controls={`${id}-${index}-panel`}
            id={`${id}-${index}-tab`}
            tabIndex={name === selected ? 0 : -1}
            onClick={() => setActive(name)}
            onKeyDown={(event) => {
              const selectedIndex = names.indexOf(selected);
              const targetIndex =
                event.key === "ArrowRight"
                  ? (selectedIndex + 1) % names.length
                  : event.key === "ArrowLeft"
                    ? (selectedIndex - 1 + names.length) % names.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? names.length - 1
                        : undefined;
              if (targetIndex === undefined) return;
              event.preventDefault();
              const next = names[targetIndex]!;
              setActive(next);
              document.getElementById(`${id}-${targetIndex}-tab`)?.focus();
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="artifact-actions">
        <button
          type="button"
          disabled={props.content[selected] === undefined}
          onClick={() => {
            void (async () => {
              try {
                if (navigator.clipboard === undefined) throw new Error("clipboard");
                await navigator.clipboard.writeText(props.content[selected] ?? "");
                props.onStatus?.("Artifact copied.");
              } catch {
                props.onStatus?.("Artifact copy is unavailable.");
              }
            })();
          }}
        >
          Copy
        </button>
        <a href={`/api/runs/${props.snapshot!.runId}/artifacts/${selected}`} download={selected}>
          Download
        </a>
      </div>
      <pre
        role="tabpanel"
        id={`${id}-${names.indexOf(selected)}-panel`}
        aria-labelledby={`${id}-${names.indexOf(selected)}-tab`}
        tabIndex={0}
      >
        <code>{props.content[selected] ?? "Loading artifact…"}</code>
      </pre>
    </section>
  );
}
