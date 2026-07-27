"use client";

import { useEffect, useRef, useState } from "react";
import type * as React from "react";
import { CLIENT_MAX_VIRTUAL_ARTIFACT_BYTES } from "./artifact-limits.js";
import {
  PUBLIC_REPLAY_REQUEST,
  PublicReplayErrorSchema,
  type DeploymentProfile,
} from "../hosting/public-replay-contracts.js";
import type { DemoMode, WorkflowSnapshot } from "../workflow/contracts.js";
import { readNdjson } from "./read-ndjson.js";
import { ActivityTimeline } from "./activity-timeline.js";
import { ArtifactWorkspace, type ArtifactContent } from "./artifact-workspace.js";
import { ChangeRequestForm, type ChangeFormValue } from "./change-request-form.js";
import { ContextCoveragePanel } from "./context-coverage-panel.js";
import { EvidencePanel } from "./evidence-panel.js";
import { ImpactPanel } from "./impact-panel.js";
import { createRequestOwner } from "./request-owner.js";
import { RunError } from "./run-error.js";
import { RuntimeProofPanel } from "./runtime-proof-panel.js";

const initialValue: ChangeFormValue = {
  dataset: "snowflake:b2fd91.order_entry_db.analytics.order_details",
  sourceColumn: "customer_id",
  targetColumn: "customer_key",
};

const requestText = (value: ChangeFormValue): string =>
  `Rename column ${value.sourceColumn} to ${value.targetColumn} in dataset ${value.dataset}`;

const artifactContentType = (filename: string): string =>
  filename.endsWith(".sql") ? "text/sql; charset=utf-8" : "text/markdown; charset=utf-8";

const WORKFLOW_STREAM_FALLBACK = "The workflow stream ended unexpectedly.";
const MAX_PUBLIC_REPLAY_ERROR_BYTES = 1_024;
const ARTIFACT_PREVIEW_UNAVAILABLE = "Artifact preview is unavailable.";
const PUBLIC_REPLAY_ARTIFACT_EXPIRED = "Run expired; analyze again.";

async function cancelResponseBody(response: Response): Promise<void> {
  if (response.body === null) return;
  try {
    await response.body.cancel();
  } catch {
    // The fixed workflow fallback remains authoritative.
  }
}

export async function readPublicReplayFailureMessage(response: Response): Promise<string> {
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (response.ok || response.body === null || mediaType !== "application/json") {
    await cancelResponseBody(response);
    return WORKFLOW_STREAM_FALLBACK;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (
        !(value instanceof Uint8Array) ||
        value.byteLength > MAX_PUBLIC_REPLAY_ERROR_BYTES - length
      ) {
        throw new Error("Public replay error is invalid.");
      }
      chunks.push(value);
      length += value.byteLength;
    }

    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed = PublicReplayErrorSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return WORKFLOW_STREAM_FALLBACK;
    if (parsed.data.error.code === "DEMO_BUSY") {
      return "Public replay is busy. Try again shortly.";
    }
    if (parsed.data.error.code === "DEMO_CAPACITY_REACHED") {
      return "Public replay capacity was reached. Try again after the service restarts.";
    }
    return WORKFLOW_STREAM_FALLBACK;
  } catch {
    try {
      await reader.cancel();
    } catch {
      // The fixed workflow fallback remains authoritative.
    }
    return WORKFLOW_STREAM_FALLBACK;
  } finally {
    reader.releaseLock();
  }
}

export async function readArtifact(
  response: Response,
  filename: string,
  deploymentProfile: DeploymentProfile,
): Promise<string> {
  const failureMessage =
    deploymentProfile === "PUBLIC_REPLAY" && response.status === 404
      ? PUBLIC_REPLAY_ARTIFACT_EXPIRED
      : ARTIFACT_PREVIEW_UNAVAILABLE;
  if (!response.ok || response.headers.get("content-type") !== artifactContentType(filename)) {
    if (response.body !== null) {
      try {
        await response.body.cancel();
      } catch {
        // The fixed artifact error remains authoritative.
      }
    }
    throw new Error(failureMessage);
  }
  if (response.body === null) throw new Error(failureMessage);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (
        !(value instanceof Uint8Array) ||
        value.byteLength > CLIENT_MAX_VIRTUAL_ARTIFACT_BYTES - length
      ) {
        throw new Error(failureMessage);
      }
      chunks.push(value);
      length += value.byteLength;
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      await reader.cancel();
    } catch {
      // The fixed artifact error remains authoritative.
    }
    throw new Error(failureMessage);
  } finally {
    reader.releaseLock();
  }
}

export function DemoClient(props: {
  readonly initialMode: DemoMode;
  readonly deploymentProfile: DeploymentProfile;
}): React.JSX.Element {
  const { initialMode, deploymentProfile } = props;
  const [value, setValue] = useState(initialValue);
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot>();
  const [activity, setActivity] = useState<WorkflowSnapshot["activity"]>([]);
  const [content, setContent] = useState<ArtifactContent>({});
  const [busy, setBusy] = useState(false);
  const [operationStatus, setOperationStatus] = useState("");
  const requestOwner = useRef(createRequestOwner());

  useEffect(() => {
    if (snapshot?.status !== "COMPLETED") return;
    let active = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const pairs = await Promise.all(
          snapshot.artifacts
            .filter(({ validated }) => validated)
            .map(async ({ filename }) => {
              const response = await fetch(`/api/runs/${snapshot.runId}/artifacts/${filename}`, {
                signal: controller.signal,
              });
              return [filename, await readArtifact(response, filename, deploymentProfile)] as const;
            }),
        );
        if (active) setContent(Object.fromEntries(pairs));
      } catch (error) {
        controller.abort();
        if (active) {
          setContent({});
          setOperationStatus(
            error instanceof Error &&
              (error.message === ARTIFACT_PREVIEW_UNAVAILABLE ||
                error.message === PUBLIC_REPLAY_ARTIFACT_EXPIRED)
              ? error.message
              : ARTIFACT_PREVIEW_UNAVAILABLE,
          );
        }
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [deploymentProfile, snapshot]);

  const consume = async (url: string, body?: unknown) => {
    const lease = requestOwner.current.begin();
    let failureMessage = WORKFLOW_STREAM_FALLBACK;
    setBusy(true);
    setOperationStatus("");
    setSnapshot(undefined);
    setContent({});
    setActivity([]);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: lease.controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        failureMessage = await readPublicReplayFailureMessage(response);
        throw new Error("Workflow stream is unavailable.");
      }
      await readNdjson(response, (event) => {
        if (!requestOwner.current.isCurrent(lease)) return;
        if (event.type === "activity") setActivity((current) => [...current, event.entry]);
        if (event.type === "snapshot") {
          setSnapshot(event.snapshot);
          setActivity(event.snapshot.activity);
        }
      });
    } catch (error) {
      if (
        requestOwner.current.isCurrent(lease) &&
        !(error instanceof DOMException && error.name === "AbortError")
      ) {
        setSnapshot({
          runId: "client-failure",
          mode: initialMode,
          status: "GENERATION_FAILED",
          activity: [],
          artifacts: [],
          evidence: [],
          facts: [],
          assumptions: [],
          unknowns: [],
          validation: { outcome: "NOT_RUN", findingCount: 0, findingCodes: [] },
          failure: {
            code: "GENERATION_FAILED",
            message: failureMessage,
          },
        });
      }
    } finally {
      if (requestOwner.current.finish(lease)) {
        setBusy(false);
      }
    }
  };

  const run = () => {
    if (!requestOwner.current.isInFlight())
      void consume("/api/runs", {
        mode: initialMode,
        request: deploymentProfile === "PUBLIC_REPLAY" ? PUBLIC_REPLAY_REQUEST : requestText(value),
      });
  };
  const regenerate = () => {
    if (!requestOwner.current.isInFlight() && snapshot !== undefined) {
      void consume(`/api/runs/${snapshot.runId}/regenerate`);
    }
  };

  return (
    <main>
      <header className="hero">
        <nav>
          <span className="brand-mark">LG</span>
          <strong>LineageGuard AI</strong>
          <span className="mode-badge">
            {deploymentProfile === "PUBLIC_REPLAY"
              ? "Public fixture replay"
              : initialMode === "REPLAY"
                ? "Fixture replay"
                : "Live DataHub + OpenAI"}
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
            locked={deploymentProfile === "PUBLIC_REPLAY"}
            onChange={setValue}
            onSubmit={run}
            onCancel={() => requestOwner.current.cancel()}
          />
        </section>
        <ActivityTimeline entries={activity} />
        <RuntimeProofPanel snapshot={snapshot} />
        <ImpactPanel snapshot={snapshot} />
        <RunError
          failure={snapshot?.failure}
          validation={snapshot?.validation}
          onSelectCandidate={(dataset) => setValue({ ...value, dataset })}
          onRetryGeneration={regenerate}
          isChildRun={snapshot?.parentRunId !== undefined}
          canRetryGeneration={
            snapshot?.parentRunId === undefined &&
            snapshot?.contextHash !== undefined &&
            !busy &&
            (snapshot?.status === "GENERATION_FAILED" || snapshot?.status === "VALIDATION_FAILED")
          }
        />
      </div>
      <ArtifactWorkspace
        snapshot={snapshot}
        content={content}
        onRegenerate={regenerate}
        busy={busy}
        onStatus={setOperationStatus}
      />
      <p aria-live="polite" role="status" className="operation-status">
        {operationStatus}
      </p>
      <ContextCoveragePanel snapshot={snapshot} />
      <EvidencePanel snapshot={snapshot} />
      <footer>Read-only DataHub · No SQL execution · Human approval required</footer>
    </main>
  );
}
