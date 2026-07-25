"use client";

import { useEffect, useRef, useState } from "react";
import type { DemoMode, WorkflowSnapshot } from "../workflow/contracts.js";
import { readNdjson } from "./read-ndjson.js";
import { ActivityTimeline } from "./activity-timeline.js";
import { ArtifactWorkspace, type ArtifactContent } from "./artifact-workspace.js";
import { ChangeRequestForm, type ChangeFormValue } from "./change-request-form.js";
import { EvidencePanel } from "./evidence-panel.js";
import { ImpactPanel } from "./impact-panel.js";
import { RunError } from "./run-error.js";

const initialValue: ChangeFormValue = {
  dataset: "snowflake:b2fd91.order_entry_db.analytics.order_details",
  sourceColumn: "customer_id",
  targetColumn: "customer_key",
};

const requestText = (value: ChangeFormValue): string =>
  `Rename column ${value.sourceColumn} to ${value.targetColumn} in dataset ${value.dataset}`;

export function DemoClient({ initialMode }: { readonly initialMode: DemoMode }) {
  const [value, setValue] = useState(initialValue);
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot>();
  const [activity, setActivity] = useState<WorkflowSnapshot["activity"]>([]);
  const [content, setContent] = useState<ArtifactContent>({});
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (snapshot?.status !== "COMPLETED") return;
    let active = true;
    void Promise.all(
      snapshot.artifacts.map(
        async ({ filename }) =>
          [
            filename,
            await (await fetch(`/api/runs/${snapshot.runId}/artifacts/${filename}`)).text(),
          ] as const,
      ),
    ).then((pairs) => {
      if (active) setContent(Object.fromEntries(pairs));
    });
    return () => {
      active = false;
    };
  }, [snapshot]);

  const consume = async (url: string, body?: unknown) => {
    controller.current = new AbortController();
    setBusy(true);
    setSnapshot(undefined);
    setContent({});
    setActivity([]);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.current.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      await readNdjson(response, (event) => {
        if (event.type === "activity") setActivity((current) => [...current, event.entry]);
        if (event.type === "snapshot") {
          setSnapshot(event.snapshot);
          setActivity(event.snapshot.activity);
        }
      });
    } catch {
      // The server supplies sanitized terminal snapshots; cancelled streams leave no unsafe error detail.
    } finally {
      setBusy(false);
      controller.current = null;
    }
  };

  const run = () => void consume("/api/runs", { mode: initialMode, request: requestText(value) });
  const regenerate = () => {
    if (snapshot !== undefined) void consume(`/api/runs/${snapshot.runId}/regenerate`);
  };

  return (
    <main>
      <header className="hero">
        <nav>
          <span className="brand-mark">LG</span>
          <strong>LineageGuard AI</strong>
          <span className="mode-badge">
            {initialMode === "REPLAY" ? "Fixture replay" : "Live DataHub + OpenAI"}
          </span>
        </nav>
        <p className="eyebrow">Metadata-aware change intelligence</p>
        <h1>Know the blast radius before you ship.</h1>
        <p className="hero-copy">
          Turn a proposed schema change into grounded impact evidence and a migration package your
          team can review.
        </p>
      </header>
      <div className="dashboard-grid">
        <section className="panel request-panel">
          <ChangeRequestForm
            value={value}
            busy={busy}
            onChange={setValue}
            onSubmit={run}
            onCancel={() => controller.current?.abort()}
          />
        </section>
        <ImpactPanel snapshot={snapshot} />
        <ActivityTimeline entries={activity} />
        <RunError
          failure={snapshot?.failure}
          validation={snapshot?.validation}
          onSelectCandidate={(dataset) => setValue({ ...value, dataset })}
          onRetryGeneration={regenerate}
          canRetryGeneration={
            snapshot?.parentRunId === undefined &&
            snapshot?.contextHash !== undefined &&
            (snapshot?.status === "GENERATION_FAILED" || snapshot?.status === "VALIDATION_FAILED")
          }
        />
      </div>
      <ArtifactWorkspace snapshot={snapshot} content={content} onRegenerate={regenerate} />
      <EvidencePanel snapshot={snapshot} />
      <footer>Read-only DataHub · No SQL execution · Human approval required</footer>
    </main>
  );
}
