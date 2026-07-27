import { link, lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as downloadArtifact } from "../../app/api/runs/[runId]/artifacts/[filename]/route.js";
import { POST as regenerateRun } from "../../app/api/runs/[runId]/regenerate/route.js";
import { GET as reloadRun } from "../../app/api/runs/[runId]/route.js";
import { POST as startRun } from "../../app/api/runs/route.js";
import { FakeAgentProvider } from "../../src/agent/fake-agent-provider.js";
import {
  createOpenAIAgentProviderIdentity,
  type AgentProvider,
  type AgentProviderResult,
} from "../../src/agent/provider.js";
import { runAgentWorkflow } from "../../src/app/run-agent-workflow.js";
import { regeneratePackage } from "../../src/app/regenerate-package.js";
import {
  createDownloadArtifactHandler,
  createPostRunsHandler,
  createRegenerateRunHandler,
  createReloadRunHandler,
  createWebRegenerationDependencies,
  createWebWorkflowDependencies,
  safeUnexpectedFailureSnapshot,
} from "../../src/app/web-dependencies.js";
import {
  __testOnly as runEnvelopeFilesTestOnly,
  readRunEnvelope,
} from "../../src/artifacts/run-envelope-files.js";
import type { WebConfig } from "../../src/config/web-config.js";
import type { CollectionResult } from "../../src/datahub/catalog.js";
import { FixtureCatalog } from "../../src/demo/fixture-catalog.js";
import type {
  EntityContext,
  EntityContextIncompleteReasonCode,
} from "../../src/domain/evidence.js";
import {
  createPublicReplayAdmission,
  type PublicReplayAdmission,
} from "../../src/hosting/public-replay-admission.js";
import { PUBLIC_REPLAY_REQUEST } from "../../src/hosting/public-replay-contracts.js";
import type { VirtualArtifactFilename } from "../../src/runs/run-envelope.js";
import { persistCompletedRun } from "../../src/runs/run-store.js";
import { readNdjson } from "../../src/ui/read-ndjson.js";
import {
  WorkflowEventSchema,
  WorkflowSnapshotSchema,
  type WorkflowSnapshot,
  type WorkflowEvent,
} from "../../src/workflow/contracts.js";
import { isTerminalWorkflowStatus } from "../../src/workflow/state-machine.js";

const REQUEST =
  "Rename column customer_id to customer_key in dataset snowflake:b2fd91.order_entry_db.analytics.order_details";

let runsRoot = "";
let originalEnvironment: NodeJS.ProcessEnv;

beforeEach(async () => {
  originalEnvironment = { ...process.env };
  runsRoot = await mkdtemp(join(tmpdir(), "lineageguard-api-"));
  process.env = {
    ...originalEnvironment,
    LINEAGEGUARD_DEMO_MODE: "REPLAY",
    LINEAGEGUARD_RUNS_DIR: runsRoot,
  };
});

afterEach(async () => {
  process.env = originalEnvironment;
  await rm(runsRoot, { recursive: true, force: true });
});

const runRequest = (body: unknown, signal?: AbortSignal): Request =>
  new Request("http://localhost/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });

function streamedPostRequest(
  url: string,
  chunks: readonly Uint8Array[],
  options: {
    readonly contentLength?: string;
    readonly signal?: AbortSignal;
    readonly cancel?: () => void;
  } = {},
): Request {
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[offset];
      if (chunk === undefined) {
        controller.close();
        return;
      }
      offset += 1;
      controller.enqueue(chunk);
    },
    ...(options.cancel === undefined ? {} : { cancel: options.cancel }),
  });
  const headers = new Headers();
  if (options.contentLength !== undefined) headers.set("Content-Length", options.contentLength);
  return new Request(url, {
    method: "POST",
    body,
    headers,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function terminalSnapshots(events: readonly WorkflowEvent[]): readonly WorkflowSnapshot[] {
  return events.flatMap((event) =>
    event.type === "snapshot" && isTerminalWorkflowStatus(event.snapshot.status)
      ? [event.snapshot]
      : [],
  );
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const rejectCancelled = () => reject(new Error("workflow observed cancellation"));
    if (signal.aborted) rejectCancelled();
    else signal.addEventListener("abort", rejectCancelled, { once: true });
  });
}

type LiveWebConfig = Extract<WebConfig, { readonly mode: "LIVE" }>;

const liveConfig = (root: string): LiveWebConfig => ({
  mode: "LIVE",
  runsRoot: root,
  deploymentProfile: "LOCAL",
  openaiApiKey: "test-openai-key",
  openaiModel: "gpt-5.6-sol",
  datahubGmsUrl: "http://localhost:8080",
  datahubGmsToken: "test-datahub-token",
  uvxPath: resolve("test-uvx"),
});

const replayConfig = (root: string): WebConfig => ({
  mode: "REPLAY",
  runsRoot: root,
  deploymentProfile: "LOCAL",
});

const publicReplayConfig = (root: string): WebConfig => ({
  mode: "REPLAY",
  runsRoot: root,
  deploymentProfile: "PUBLIC_REPLAY",
});

function completedRouteSnapshot(runId: string): WorkflowSnapshot {
  return WorkflowSnapshotSchema.parse({
    ...safeUnexpectedFailureSnapshot(runId, "REPLAY"),
    status: "COMPLETED",
    validation: { outcome: "PASSED", findingCount: 0, findingCodes: [] },
    failure: undefined,
  });
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function observeLeaseReleases(delegate: PublicReplayAdmission): {
  readonly admission: PublicReplayAdmission;
  readonly releaseCount: () => number;
} {
  let count = 0;
  return {
    admission: {
      async acquire(root) {
        const decision = await delegate.acquire(root);
        if (decision.kind === "rejected") return decision;
        let released = false;
        return {
          kind: "accepted",
          lease: {
            release() {
              if (!released) {
                released = true;
                count += 1;
              }
              decision.lease.release();
            },
          },
        };
      },
    },
    releaseCount: () => count,
  };
}

class LiveFixtureProvider implements AgentProvider {
  readonly identity = createOpenAIAgentProviderIdentity("test-live-model");

  async run(input: Parameters<AgentProvider["run"]>[0]): Promise<AgentProviderResult> {
    const result = await new FakeAgentProvider().run(input);
    return {
      ...result,
      provider: "openai",
      model: "test-live-model",
      reasoningEffort: "medium",
    };
  }
}

class SecretBearingFixtureCatalog extends FixtureCatalog {
  constructor(private readonly sentinel: string) {
    super();
  }

  override async getEntityContext(
    urns: readonly string[],
    options?: { readonly signal?: AbortSignal },
  ): Promise<CollectionResult<EntityContext, EntityContextIncompleteReasonCode>> {
    const result = await super.getEntityContext(urns, options);
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        description: `untrusted description ${this.sentinel}`,
        qualitySignals: [...item.qualitySignals, `untrusted quality ${this.sentinel}`],
      })),
    };
  }

  override getServerInfo(): {
    readonly reportedServerName: string;
    readonly reportedServerVersion: string;
  } {
    return {
      reportedServerName: `fixture-${this.sentinel}`,
      reportedServerVersion: this.sentinel,
    };
  }
}

async function createParent(mode: "LIVE" | "REPLAY", runId: string): Promise<WorkflowSnapshot> {
  const config = mode === "LIVE" ? liveConfig(runsRoot) : replayConfig(runsRoot);
  const dependencies = createWebWorkflowDependencies({
    config,
    runsRoot,
    request: REQUEST,
    runId,
    signal: new AbortController().signal,
    onEvent: () => {},
  });
  return runAgentWorkflow({
    ...dependencies,
    provider: mode === "LIVE" ? new LiveFixtureProvider() : new FakeAgentProvider(),
    createCatalog: async () => new FixtureCatalog(),
  });
}

async function collectEvents(response: Response): Promise<WorkflowEvent[]> {
  const received: WorkflowEvent[] = [];
  await readNdjson(response, (event) => received.push(WorkflowEventSchema.parse(event)));
  return received;
}

async function createCompletedRun(): Promise<{
  readonly runId: string;
  readonly events: readonly WorkflowEvent[];
}> {
  const response = await startRun(runRequest({ mode: "REPLAY", request: REQUEST }));
  const events = await collectEvents(response);
  const terminal = events.at(-1);
  if (terminal?.type !== "snapshot") throw new Error("Expected a terminal snapshot.");
  expect(terminal.snapshot.status).toBe("COMPLETED");
  return { runId: terminal.snapshot.runId, events };
}

async function createCompletedRunWithId(runId: string): Promise<WorkflowSnapshot> {
  const response = await createPostRunsHandler({ createId: () => runId })(
    runRequest({ mode: "REPLAY", request: REQUEST }),
  );
  const events = await collectEvents(response);
  const terminal = terminalSnapshots(events);
  expect(terminal).toHaveLength(1);
  expect(terminal[0]?.status).toBe("COMPLETED");
  return WorkflowSnapshotSchema.parse(terminal[0]);
}

it("rejects unknown request fields with HTTP 400", async () => {
  const response = await startRun(
    runRequest({ mode: "REPLAY", request: REQUEST, apiKey: "must-not-be-accepted" }),
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid rename request." });
});

it("streams NDJSON and ends with one validated terminal snapshot", async () => {
  const response = await startRun(runRequest({ mode: "REPLAY", request: REQUEST }));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("x-frame-options")).toBe("DENY");

  const events = await collectEvents(response);
  const terminal = events.filter(
    (event) => event.type === "snapshot" && event.snapshot.status === "COMPLETED",
  );
  expect(terminal).toHaveLength(1);
  const completed = terminal[0];
  if (completed?.type !== "snapshot") throw new Error("Expected a completed snapshot.");
  expect(() => WorkflowSnapshotSchema.parse(completed.snapshot)).not.toThrow();
});

it("preflights storage before constructing workflow dependencies", async () => {
  const createDependencies = vi.fn(() => {
    throw new Error("must not be reached");
  });
  const handler = createPostRunsHandler({ createDependencies });
  process.env.LINEAGEGUARD_RUNS_DIR = resolve(runsRoot, "missing");

  const response = await handler(runRequest({ mode: "REPLAY", request: REQUEST }));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Demo service storage is unavailable." });
  expect(createDependencies).not.toHaveBeenCalled();
});

it("rejects an initial request above 8192 bytes before dependencies are constructed", async () => {
  const cancelled = vi.fn();
  const createDependencies = vi.fn(() => {
    throw new Error("dependencies must not be constructed");
  });
  const runWorkflow = vi.fn(async () => {
    throw new Error("workflow must not run");
  });
  const persistFailure = vi.fn(async () => {});
  const provider = vi.fn();
  const catalog = vi.fn();
  const handler = createPostRunsHandler({
    createDependencies,
    runWorkflow,
    persistFailure,
  });
  const response = await handler(
    streamedPostRequest(
      "http://localhost/api/runs",
      [new TextEncoder().encode("x".repeat(8_192)), Uint8Array.of(0x78)],
      { contentLength: "1", cancel: cancelled },
    ),
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid rename request." });
  expect(cancelled).toHaveBeenCalledOnce();
  expect(createDependencies).not.toHaveBeenCalled();
  expect(runWorkflow).not.toHaveBeenCalled();
  expect(provider).not.toHaveBeenCalled();
  expect(catalog).not.toHaveBeenCalled();
  expect(persistFailure).not.toHaveBeenCalled();
});

it("maps pre-abort and post-stream abort to one terminal cancellation snapshot", async () => {
  for (const timing of ["pre", "post"] as const) {
    const controller = new AbortController();
    const runId = `cancel-${timing}`;
    if (timing === "pre") controller.abort();
    const handler = createPostRunsHandler({
      createId: () => runId,
      runWorkflow: ({ signal }) => waitForAbort(signal),
    });
    const response = await handler(
      runRequest({ mode: "REPLAY", request: REQUEST }, controller.signal),
    );
    if (timing === "post") controller.abort();

    const events = await collectEvents(response);
    expect(terminalSnapshots(events)).toEqual([
      expect.objectContaining({ runId, status: "CANCELLED" }),
    ]);
    const reload = await reloadRun(new Request(`http://localhost/api/runs/${runId}`), {
      params: Promise.resolve({ runId }),
    });
    expect(WorkflowSnapshotSchema.parse(await reload.json())).toMatchObject({
      runId,
      status: "CANCELLED",
    });
  }
});

it("persists cancellation when the response reader disconnects", async () => {
  const runId = "cancel-disconnected";
  const handler = createPostRunsHandler({
    createId: () => runId,
    runWorkflow: ({ signal }) => waitForAbort(signal),
  });
  const response = await handler(runRequest({ mode: "REPLAY", request: REQUEST }));
  await response.body?.getReader().cancel();

  await vi.waitFor(
    async () => {
      const reload = await reloadRun(new Request(`http://localhost/api/runs/${runId}`), {
        params: Promise.resolve({ runId }),
      });
      expect(reload.status).toBe(200);
      expect(WorkflowSnapshotSchema.parse(await reload.json()).status).toBe("CANCELLED");
    },
    { timeout: 2_000 },
  );
});

it("persists and reloads the same closed fallback for an unclassified workflow error", async () => {
  const sentinel = "ACTIVE_SECRET_SENTINEL";
  const runId = "unclassified-fallback";
  const handler = createPostRunsHandler({
    createId: () => runId,
    runWorkflow: async () => {
      throw new Error(`provider trace ${sentinel}`);
    },
  });

  const response = await handler(runRequest({ mode: "REPLAY", request: REQUEST }));
  const events = await collectEvents(response);
  const [streamed] = terminalSnapshots(events);
  expect(streamed).toMatchObject({ runId, status: "GENERATION_FAILED" });
  const reload = await reloadRun(new Request(`http://localhost/api/runs/${runId}`), {
    params: Promise.resolve({ runId }),
  });
  const reopened = WorkflowSnapshotSchema.parse(await reload.json());
  expect(reopened).toEqual(streamed);
  expect(JSON.stringify({ events, reopened })).not.toContain(sentinel);
});

it("streams only the closed fallback when failure persistence is unavailable", async () => {
  const sentinel = "ACTIVE_SECRET_SENTINEL";
  const handler = createPostRunsHandler({
    createId: () => "unpersisted-fallback",
    runWorkflow: async () => {
      throw new Error(`workflow ${sentinel}`);
    },
    persistFailure: async () => {
      throw new Error(`storage ${sentinel}`);
    },
  });

  const events = await collectEvents(
    await handler(runRequest({ mode: "REPLAY", request: REQUEST })),
  );
  const terminal = terminalSnapshots(events);
  expect(terminal).toHaveLength(1);
  expect(WorkflowSnapshotSchema.parse(terminal[0])).toMatchObject({
    status: "GENERATION_FAILED",
    failure: { message: "The workflow failed unexpectedly." },
  });
  expect(JSON.stringify(events)).not.toContain(sentinel);
});

it("reloads authoritative COMPLETED after abort races with final hard-link publication", async () => {
  const runId = "completed-before-abort";
  const sourceRoot = await mkdtemp(join(tmpdir(), "lineageguard-completed-source-"));
  const requestController = new AbortController();
  try {
    await runAgentWorkflow({
      ...createWebWorkflowDependencies({
        config: replayConfig(sourceRoot),
        runsRoot: sourceRoot,
        request: REQUEST,
        runId,
        signal: new AbortController().signal,
        onEvent: () => {},
      }),
      provider: new FakeAgentProvider(),
      createCatalog: async () => new FixtureCatalog(),
    });
    const sourceEnvelope = await readRunEnvelope({ runsRoot: sourceRoot, runId });
    if (sourceEnvelope.kind !== "completed") {
      throw new Error("Expected a completed source envelope.");
    }

    const handler = createPostRunsHandler({
      createId: () => runId,
      runWorkflow: async (dependencies) => {
        await persistCompletedRun({
          runsRoot: dependencies.runsRoot,
          runId,
          context: sourceEnvelope.context,
          draft: sourceEnvelope.draft,
          rendered: sourceEnvelope.package,
          snapshot: sourceEnvelope.snapshot,
          signal: dependencies.signal,
          hooks: { afterPublish: () => requestController.abort() },
        });
        throw new Error("publication completed before terminal delivery");
      },
    });

    const events = await collectEvents(
      await handler(runRequest({ mode: "REPLAY", request: REQUEST }, requestController.signal)),
    );
    expect(terminalSnapshots(events)).toEqual([
      expect.objectContaining({ runId, status: "COMPLETED" }),
    ]);
    const reload = await reloadRun(new Request(`http://localhost/api/runs/${runId}`), {
      params: Promise.resolve({ runId }),
    });
    expect(WorkflowSnapshotSchema.parse(await reload.json())).toMatchObject({
      runId,
      status: "COMPLETED",
    });
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
  }
});

it("reloads sanitized snapshots, regenerates without DataHub, and downloads only public artifacts", async () => {
  const { runId } = await createCompletedRun();
  const reload = await reloadRun(new Request(`http://localhost/api/runs/${runId}`), {
    params: Promise.resolve({ runId }),
  });
  const parent = WorkflowSnapshotSchema.parse(await reload.json());
  expect(JSON.stringify(parent)).not.toContain(runsRoot);
  expect(reload.headers.get("cache-control")).toBe("no-store");
  expect(reload.headers.get("referrer-policy")).toBe("no-referrer");
  expect(reload.headers.get("x-content-type-options")).toBe("nosniff");
  expect(reload.headers.get("x-frame-options")).toBe("DENY");

  const regenerationRequest = new Request(`http://localhost/api/runs/${runId}/regenerate`, {
    method: "POST",
  });
  expect(await regenerationRequest.clone().text()).toBe("");
  const regenerated = await regenerateRun(regenerationRequest, {
    params: Promise.resolve({ runId }),
  });
  expect(regenerated.headers.get("cache-control")).toBe("no-store");
  expect(regenerated.headers.get("referrer-policy")).toBe("no-referrer");
  expect(regenerated.headers.get("x-content-type-options")).toBe("nosniff");
  expect(regenerated.headers.get("x-frame-options")).toBe("DENY");
  const regenerationEvents = await collectEvents(regenerated);
  const child = regenerationEvents.at(-1);
  if (child?.type !== "snapshot") throw new Error("Expected a terminal child snapshot.");
  expect(child.snapshot).toMatchObject({
    status: "COMPLETED",
    parentRunId: runId,
    contextHash: parent.contextHash,
  });

  for (const filename of [
    "migration-up.sql",
    "migration-down.sql",
    "validation.sql",
    "rollout-plan.md",
  ] as const) {
    const download = await downloadArtifact(
      new Request(`http://localhost/api/runs/${runId}/artifacts/${filename}`),
      { params: Promise.resolve({ runId, filename }) },
    );
    expect(download.status).toBe(200);
    expect(await download.text()).not.toContain(runsRoot);
    expect(download.headers.get("content-disposition")).toBe(`attachment; filename="${filename}"`);
    expect(download.headers.get("content-type")).toBe(
      filename.endsWith(".sql") ? "text/sql; charset=utf-8" : "text/markdown; charset=utf-8",
    );
    expect(download.headers.get("cache-control")).toBe("no-store");
    expect(download.headers.get("referrer-policy")).toBe("no-referrer");
    expect(download.headers.get("x-content-type-options")).toBe("nosniff");
    expect(download.headers.get("x-frame-options")).toBe("DENY");
  }

  for (const filename of ["secret.txt", "../migration-up.sql", "%2e%2e"] as const) {
    const download = await downloadArtifact(
      new Request(`http://localhost/api/runs/${runId}/artifacts/${filename}`),
      { params: Promise.resolve({ runId, filename }) },
    );
    expect(download.status).toBe(404);
    expect(await download.text()).not.toContain(runsRoot);
  }
});

it("does not fall back when a final envelope is missing or tampered", async () => {
  const missing = await reloadRun(new Request("http://localhost/api/runs/missing"), {
    params: Promise.resolve({ runId: "missing" }),
  });
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: "Run not found." });
  expect(missing.headers.get("cache-control")).toBe("no-store");
  expect(missing.headers.get("x-content-type-options")).toBe("nosniff");

  const missingArtifact = await downloadArtifact(
    new Request("http://localhost/api/runs/missing/artifacts/migration-up.sql"),
    { params: Promise.resolve({ runId: "missing", filename: "migration-up.sql" }) },
  );
  expect(missingArtifact.status).toBe(404);
  expect(await missingArtifact.json()).toEqual({ error: "Artifact not found." });
  expect(missingArtifact.headers.get("cache-control")).toBe("no-store");
  expect(missingArtifact.headers.get("x-content-type-options")).toBe("nosniff");

  const { runId } = await createCompletedRun();
  const envelopePath = join(runsRoot, `run-${runId}.json`);
  const envelope = JSON.parse(await readFile(envelopePath, "utf8")) as {
    hashes: { snapshot: string };
  };
  envelope.hashes.snapshot = "0".repeat(64);
  await writeFile(envelopePath, JSON.stringify(envelope));

  const reload = await reloadRun(new Request(`http://localhost/api/runs/${runId}`), {
    params: Promise.resolve({ runId }),
  });
  const download = await downloadArtifact(
    new Request(`http://localhost/api/runs/${runId}/artifacts/migration-up.sql`),
    { params: Promise.resolve({ runId, filename: "migration-up.sql" }) },
  );
  expect(reload.status).toBe(404);
  expect(download.status).toBe(404);
  expect(await reload.json()).toEqual({ error: "Run not found." });
  expect(await download.json()).toEqual({ error: "Artifact not found." });
});

it("rejects invariant-tampered, malformed, linked, and traversal final entries", async () => {
  const invariantRunId = "invariant-tampered";
  await createCompletedRunWithId(invariantRunId);
  const invariantPath = join(runsRoot, `run-${invariantRunId}.json`);
  const invariantEnvelope = JSON.parse(await readFile(invariantPath, "utf8")) as {
    runId: string;
  };
  invariantEnvelope.runId = "different-run-id";
  await writeFile(invariantPath, JSON.stringify(invariantEnvelope));
  await writeFile(join(runsRoot, "run-malformed.json"), "{not-json");

  const outside = await mkdtemp(join(tmpdir(), "lineageguard-outside-"));
  try {
    const linkedRunId = "linked";
    await runAgentWorkflow({
      ...createWebWorkflowDependencies({
        config: replayConfig(outside),
        runsRoot: outside,
        request: REQUEST,
        runId: linkedRunId,
        signal: new AbortController().signal,
        onEvent: () => {},
      }),
      provider: new FakeAgentProvider(),
      createCatalog: async () => new FixtureCatalog(),
    });
    const outsideEnvelopePath = join(outside, `run-${linkedRunId}.json`);
    const linkedFinalPath = join(runsRoot, `run-${linkedRunId}.json`);
    await link(outsideEnvelopePath, linkedFinalPath);
    await expect(readRunEnvelope({ runsRoot, runId: linkedRunId })).resolves.toMatchObject({
      kind: "completed",
      runId: linkedRunId,
    });

    const strictLinkedBoundary = runEnvelopeFilesTestOnly.createRunEnvelopeFileBoundary({
      operations: {
        lstat: async (path) => {
          const stats = await lstat(path);
          if (resolve(path) !== resolve(linkedFinalPath)) return stats;
          return {
            dev: stats.dev,
            ino: stats.ino,
            size: stats.size,
            isDirectory: () => false,
            isFile: () => true,
            isSymbolicLink: () => true,
          };
        },
      },
    });

    const linkedReload = createReloadRunHandler({
      loadSnapshot: async (input: { readonly runsRoot: string; readonly runId: string }) => {
        const envelope = await strictLinkedBoundary.readRunEnvelope(input);
        if (envelope.kind === "impact-report") throw new Error("Workflow run unavailable.");
        return envelope.snapshot;
      },
    });
    const linkedDownload = createDownloadArtifactHandler({
      readArtifact: async (input: {
        readonly runsRoot: string;
        readonly runId: string;
        readonly filename: VirtualArtifactFilename;
      }) => {
        const envelope = await strictLinkedBoundary.readRunEnvelope(input);
        if (envelope.kind !== "completed") throw new Error("Package unavailable.");
        return envelope.package.files[input.filename];
      },
    });
    const linkedReloadResponse = await linkedReload(
      new Request(`http://localhost/api/runs/${linkedRunId}`),
      { params: Promise.resolve({ runId: linkedRunId }) },
    );
    const linkedDownloadResponse = await linkedDownload(
      new Request(`http://localhost/api/runs/${linkedRunId}/artifacts/migration-up.sql`),
      {
        params: Promise.resolve({
          runId: linkedRunId,
          filename: "migration-up.sql",
        }),
      },
    );
    expect(linkedReloadResponse.status).toBe(404);
    expect(await linkedReloadResponse.json()).toEqual({ error: "Run not found." });
    expect(linkedDownloadResponse.status).toBe(404);
    expect(await linkedDownloadResponse.json()).toEqual({
      error: "Artifact not found.",
    });

    for (const runId of [invariantRunId, "malformed", "../outside"]) {
      const reload = await reloadRun(new Request("http://localhost/api/runs"), {
        params: Promise.resolve({ runId }),
      });
      expect(reload.status).toBe(404);
      expect(await reload.json()).toEqual({ error: "Run not found." });

      const download = await downloadArtifact(new Request("http://localhost/api/runs/artifacts"), {
        params: Promise.resolve({ runId, filename: "migration-up.sql" }),
      });
      expect(download.status).toBe(404);
      expect(await download.json()).toEqual({ error: "Artifact not found." });
    }
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

describe("trusted-root preflight", () => {
  it.each(["missing", "relative", "nonexistent", "file"])(
    "fails closed for a %s runs root before workflow construction",
    async (kind) => {
      const target = await mkdtemp(join(tmpdir(), "lineageguard-root-target-"));
      const candidate = join(tmpdir(), `lineageguard-root-${kind}-${process.pid}`);
      try {
        if (kind === "missing") delete process.env.LINEAGEGUARD_RUNS_DIR;
        if (kind === "relative") process.env.LINEAGEGUARD_RUNS_DIR = "relative-runs";
        if (kind === "nonexistent") process.env.LINEAGEGUARD_RUNS_DIR = candidate;
        if (kind === "file") {
          await writeFile(candidate, "not a directory");
          process.env.LINEAGEGUARD_RUNS_DIR = candidate;
        }
        const createDependencies = vi.fn(() => {
          throw new Error("must not be reached");
        });
        const response = await createPostRunsHandler({ createDependencies })(
          runRequest({ mode: "REPLAY", request: REQUEST }),
        );
        expect(response.status).toBe(503);
        expect(await response.text()).not.toContain(candidate);
        expect(createDependencies).not.toHaveBeenCalled();
      } finally {
        await rm(candidate, { recursive: true, force: true });
        await rm(target, { recursive: true, force: true });
      }
    },
  );

  it("rejects a directory-symlink runs root before workflow construction", async () => {
    const target = await mkdtemp(join(tmpdir(), "lineageguard-symlink-target-"));
    const candidate = `${target}-link`;
    try {
      process.env.LINEAGEGUARD_RUNS_DIR = candidate;
      const createDependencies = vi.fn();
      const symlinkBoundary = runEnvelopeFilesTestOnly.createRunEnvelopeFileBoundary({
        operations: {
          lstat: async (path) => {
            if (resolve(path) !== resolve(candidate)) return lstat(path);
            const stats = await lstat(target);
            return {
              dev: stats.dev,
              ino: stats.ino,
              size: stats.size,
              isDirectory: () => true,
              isFile: () => false,
              isSymbolicLink: () => true,
            };
          },
        },
      });
      const response = await createPostRunsHandler({
        assertRunsRoot: symlinkBoundary.assertTrustedRunsRoot,
        createDependencies,
      })(runRequest({ mode: "REPLAY", request: REQUEST }));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "Demo service storage is unavailable.",
      });
      expect(createDependencies).not.toHaveBeenCalled();
    } finally {
      await rm(candidate, { recursive: true, force: true });
      await rm(target, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === "win32")(
    "rejects a Windows-junction runs root before workflow construction",
    async () => {
      const target = await mkdtemp(join(tmpdir(), "lineageguard-junction-target-"));
      const candidate = `${target}-junction`;
      try {
        await symlink(target, candidate, "junction");
        expect((await lstat(candidate)).isSymbolicLink()).toBe(true);
        process.env.LINEAGEGUARD_RUNS_DIR = candidate;
        const createDependencies = vi.fn();
        const response = await createPostRunsHandler({ createDependencies })(
          runRequest({ mode: "REPLAY", request: REQUEST }),
        );
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({
          error: "Demo service storage is unavailable.",
        });
        expect(createDependencies).not.toHaveBeenCalled();
      } finally {
        await rm(candidate, { recursive: true, force: true });
        await rm(target, { recursive: true, force: true });
      }
    },
  );
});

it("rejects any regeneration body byte before configuration or storage access", async () => {
  const loadConfig = vi.fn();
  const assertRunsRoot = vi.fn();
  const createId = vi.fn();
  const createDependencies = vi.fn();
  const regenerate = vi.fn();
  const datahub = vi.fn();
  const handler = createRegenerateRunHandler({
    loadConfig,
    assertRunsRoot,
    createId,
    createDependencies,
    regenerate,
  });
  const response = await handler(
    streamedPostRequest("http://localhost/api/runs/parent/regenerate", [Uint8Array.of(0x20)], {
      contentLength: "1",
    }),
    { params: Promise.resolve({ runId: "parent" }) },
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid regeneration request." });
  expect(loadConfig).not.toHaveBeenCalled();
  expect(assertRunsRoot).not.toHaveBeenCalled();
  expect(createId).not.toHaveBeenCalled();
  expect(createDependencies).not.toHaveBeenCalled();
  expect(regenerate).not.toHaveBeenCalled();
  expect(datahub).not.toHaveBeenCalled();
});

it("maps a pre-aborted regeneration to one terminal cancellation snapshot", async () => {
  const parent = await createParent("REPLAY", "regeneration-cancel-parent");
  const controller = new AbortController();
  controller.abort();
  const datahub = vi.fn();
  const handler = createRegenerateRunHandler({
    loadConfig: () => replayConfig(runsRoot),
    createId: () => "regeneration-cancel-child",
    createDependencies: (input: Parameters<typeof createWebRegenerationDependencies>[0]) =>
      createWebRegenerationDependencies(input),
  });

  const events = await collectEvents(
    await handler(
      new Request(`http://localhost/api/runs/${parent.runId}/regenerate`, {
        method: "POST",
        signal: controller.signal,
      }),
      { params: Promise.resolve({ runId: parent.runId }) },
    ),
  );

  expect(terminalSnapshots(events)).toEqual([
    expect.objectContaining({
      runId: "regeneration-cancel-child",
      status: "CANCELLED",
    }),
  ]);
  expect(datahub).not.toHaveBeenCalled();
});

it.each(["REPLAY", "LIVE"] as const)(
  "regenerates in server-owned %s mode without DataHub",
  async (mode) => {
    const parent = await createParent(mode, `parent-${mode.toLowerCase()}`);
    expect(parent.status).toBe("COMPLETED");
    const childRunId = `child-${mode.toLowerCase()}`;
    const datahub = vi.fn();
    let capturedDependencies: ReturnType<typeof createWebRegenerationDependencies> | undefined;
    const handler = createRegenerateRunHandler({
      loadConfig: () => (mode === "LIVE" ? liveConfig(runsRoot) : replayConfig(runsRoot)),
      createId: () => childRunId,
      createDependencies: (input: Parameters<typeof createWebRegenerationDependencies>[0]) => {
        const dependencies = createWebRegenerationDependencies(input);
        capturedDependencies = {
          ...dependencies,
          provider: mode === "LIVE" ? new LiveFixtureProvider() : new FakeAgentProvider(),
        };
        return capturedDependencies;
      },
    });
    const request = new Request(`http://localhost/api/runs/${parent.runId}/regenerate`, {
      method: "POST",
    });
    expect((await request.clone().arrayBuffer()).byteLength).toBe(0);

    const events = await collectEvents(
      await handler(request, {
        params: Promise.resolve({ runId: parent.runId }),
      }),
    );
    const [child] = terminalSnapshots(events);
    expect(child).toMatchObject({
      runId: childRunId,
      parentRunId: parent.runId,
      mode,
      status: "COMPLETED",
      contextHash: parent.contextHash,
    });
    expect(child?.runId).not.toBe(parent.runId);
    expect(capturedDependencies).not.toHaveProperty("createCatalog");
    expect(datahub).not.toHaveBeenCalled();
  },
);

it("rejects regeneration configuration and storage preflight failures before application work", async () => {
  const applicationWork = {
    createId: vi.fn(),
    createDependencies: vi.fn(),
    regenerate: vi.fn(),
    datahub: vi.fn(),
  };
  const configurationFailure = createRegenerateRunHandler({
    loadConfig: () => {
      throw new Error("secret configuration detail");
    },
    ...applicationWork,
  });
  const configurationResponse = await configurationFailure(
    new Request("http://localhost/api/runs/parent/regenerate", { method: "POST" }),
    { params: Promise.resolve({ runId: "parent" }) },
  );
  expect(configurationResponse.status).toBe(503);
  expect(await configurationResponse.json()).toEqual({
    error: "Demo service is not configured.",
  });

  const rootPreflight = vi.fn(async () => {
    throw new Error(`native path ${runsRoot}`);
  });
  const storageFailure = createRegenerateRunHandler({
    loadConfig: () => replayConfig(runsRoot),
    assertRunsRoot: rootPreflight,
    ...applicationWork,
  });
  const storageResponse = await storageFailure(
    new Request("http://localhost/api/runs/parent/regenerate", { method: "POST" }),
    { params: Promise.resolve({ runId: "parent" }) },
  );
  expect(storageResponse.status).toBe(503);
  expect(await storageResponse.json()).toEqual({
    error: "Demo service storage is unavailable.",
  });
  expect(rootPreflight).toHaveBeenCalledOnce();
  expect(applicationWork.createId).not.toHaveBeenCalled();
  expect(applicationWork.createDependencies).not.toHaveBeenCalled();
  expect(applicationWork.regenerate).not.toHaveBeenCalled();
  expect(applicationWork.datahub).not.toHaveBeenCalled();
});

it("rejects regeneration when persisted parent mode differs from server mode", async () => {
  const parent = await createParent("REPLAY", "mode-mismatch-parent");
  const childRunId = "mode-mismatch-child";
  const datahub = vi.fn();
  const handler = createRegenerateRunHandler({
    loadConfig: () => liveConfig(runsRoot),
    createId: () => childRunId,
    createDependencies: (input: Parameters<typeof createWebRegenerationDependencies>[0]) => ({
      ...createWebRegenerationDependencies(input),
      provider: new LiveFixtureProvider(),
    }),
  });

  const events = await collectEvents(
    await handler(
      new Request(`http://localhost/api/runs/${parent.runId}/regenerate`, {
        method: "POST",
      }),
      { params: Promise.resolve({ runId: parent.runId }) },
    ),
  );
  expect(terminalSnapshots(events)).toEqual([
    expect.objectContaining({ runId: childRunId, status: "GENERATION_FAILED" }),
  ]);
  const childReload = await reloadRun(new Request(`http://localhost/api/runs/${childRunId}`), {
    params: Promise.resolve({ runId: childRunId }),
  });
  expect(childReload.status).toBe(404);
  expect(datahub).not.toHaveBeenCalled();
});

it("passes live secrets only to the sanitizer boundary and performs zero DataHub calls", async () => {
  const config = liveConfig(runsRoot);
  const datahub = vi.fn();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  let captured: ReturnType<typeof createWebRegenerationDependencies> | undefined;
  try {
    const handler = createRegenerateRunHandler({
      loadConfig: () => config,
      createId: () => "live-secret-child",
      createDependencies: (input: Parameters<typeof createWebRegenerationDependencies>[0]) => {
        captured = {
          ...createWebRegenerationDependencies(input),
          provider: new LiveFixtureProvider(),
        };
        return captured;
      },
      regenerate: async (input: Parameters<typeof regeneratePackage>[0]) =>
        safeUnexpectedFailureSnapshot(input.runId, input.mode),
    });
    const response = await handler(
      new Request("http://localhost/api/runs/parent/regenerate", { method: "POST" }),
      { params: Promise.resolve({ runId: "parent" }) },
    );
    const responseText = await response.text();
    expect(captured?.secrets).toEqual([config.openaiApiKey, config.datahubGmsToken]);
    const publicDependencyView = {
      ...captured,
      provider: undefined,
      secrets: undefined,
    };
    const publicText = JSON.stringify({
      publicDependencyView,
      responseText,
      logs: [...log.mock.calls, ...errorLog.mock.calls],
    });
    expect(publicText).not.toContain(config.openaiApiKey);
    expect(publicText).not.toContain(config.datahubGmsToken);
    expect(datahub).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
    errorLog.mockRestore();
  }
});

it("redacts adversarial catalog and provider secrets from every route surface", async () => {
  const sentinel = "ROUTE_SECRET_SENTINEL_7284";
  const runId = "adversarial-secret-run";
  const config: LiveWebConfig = {
    ...liveConfig(runsRoot),
    openaiApiKey: sentinel,
    datahubGmsToken: `${sentinel}-token`,
  };
  let providerRequest = "";
  let providerContext = "";
  const provider: AgentProvider = {
    identity: createOpenAIAgentProviderIdentity("adversarial-test-live"),
    async run({ request, tools, signal }): Promise<AgentProviderResult> {
      providerRequest = request;
      const analysis = await tools.analyzeRenameChange({ request }, signal);
      if (analysis.kind !== "ready") throw new Error("Expected ready analysis.");
      providerContext = JSON.stringify(analysis.context);
      return {
        status: "failed",
        provider: "openai",
        model: `adversarial-${sentinel}`,
        reasoningEffort: "medium",
        analysisCalls: 1,
        generationAttempts: 0,
        message: `provider diagnostic ${sentinel} ${"x".repeat(700)}`,
        failure: {
          code: "GENERATION_FAILED",
          message: `provider failure ${sentinel}`,
        },
      };
    },
  };
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const handler = createPostRunsHandler({
      loadConfig: () => config,
      createId: () => runId,
      createDependencies: (input: Parameters<typeof createWebWorkflowDependencies>[0]) => ({
        ...createWebWorkflowDependencies(input),
        provider,
        createCatalog: async () => new SecretBearingFixtureCatalog(sentinel),
      }),
    });
    const streamText = await (await handler(runRequest({ mode: "LIVE", request: REQUEST }))).text();
    const events: WorkflowEvent[] = [];
    for (const line of streamText.trim().split("\n")) {
      events.push(WorkflowEventSchema.parse(JSON.parse(line)));
    }
    const [terminal] = terminalSnapshots(events);
    expect(terminal).toMatchObject({ runId, status: "GENERATION_FAILED" });
    expect(terminal?.failure?.message.length).toBeLessThanOrEqual(500);

    const envelopeText = await readFile(join(runsRoot, `run-${runId}.json`), "utf8");
    const envelope = await readRunEnvelope({ runsRoot, runId });
    if (envelope.kind !== "failed") throw new Error("Expected a failed envelope.");
    expect(envelope.snapshot).toEqual(terminal);
    const reload = await reloadRun(new Request(`http://localhost/api/runs/${runId}`), {
      params: Promise.resolve({ runId }),
    });
    const reloadText = await reload.text();
    const downloadTexts: string[] = [];
    for (const filename of [
      "migration-up.sql",
      "migration-down.sql",
      "validation.sql",
      "rollout-plan.md",
    ] as const) {
      const download = await downloadArtifact(
        new Request(`http://localhost/api/runs/${runId}/artifacts/${filename}`),
        { params: Promise.resolve({ runId, filename }) },
      );
      expect(download.status).toBe(404);
      downloadTexts.push(await download.text());
    }

    const allPublicAndInternalSurfaces = JSON.stringify({
      providerRequest,
      providerContext,
      streamText,
      envelopeText,
      reloadText,
      downloadTexts,
      logs: [...log.mock.calls, ...errorLog.mock.calls],
    });
    expect(allPublicAndInternalSurfaces).not.toContain(sentinel);
    expect(allPublicAndInternalSurfaces).toContain("[REDACTED]");
  } finally {
    log.mockRestore();
    errorLog.mockRestore();
  }
});

it("rejects a regeneration request body", async () => {
  const { runId } = await createCompletedRun();
  const response = await regenerateRun(
    new Request(`http://localhost/api/runs/${runId}/regenerate`, {
      method: "POST",
      body: "{}",
    }),
    { params: Promise.resolve({ runId }) },
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid regeneration request." });
});

it("rejects a non-golden public request before storage, admission, run ID, or persistence", async () => {
  const assertRunsRoot = vi.fn();
  const publicAdmission: PublicReplayAdmission = { acquire: vi.fn() };
  const createId = vi.fn();
  const createDependencies = vi.fn();
  const runWorkflow = vi.fn();
  const persistFailure = vi.fn();
  const handler = createPostRunsHandler({
    loadConfig: () => publicReplayConfig(runsRoot),
    assertRunsRoot,
    publicAdmission,
    createId,
    createDependencies,
    runWorkflow,
    persistFailure,
  });

  const response = await handler(
    runRequest({
      mode: "REPLAY",
      request: "Rename column another_column to another_name in dataset another.dataset",
    }),
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: {
      code: "INVALID_REQUEST",
      message: "Only the certified public replay request is supported.",
    },
  });
  expect(assertRunsRoot).not.toHaveBeenCalled();
  expect(publicAdmission.acquire).not.toHaveBeenCalled();
  expect(createId).not.toHaveBeenCalled();
  expect(createDependencies).not.toHaveBeenCalled();
  expect(runWorkflow).not.toHaveBeenCalled();
  expect(persistFailure).not.toHaveBeenCalled();
  expect(await readdir(runsRoot)).toEqual([]);
});

it.each([
  ["leading non-breaking space", `\u00a0${PUBLIC_REPLAY_REQUEST}`],
  ["trailing em space", `${PUBLIC_REPLAY_REQUEST}\u2003`],
] as const)(
  "rejects the golden public request with %s before normalized downstream use",
  async (_name, rawRequest) => {
    const assertRunsRoot = vi.fn(async () => runsRoot);
    const admissionDelegate = createPublicReplayAdmission({ countPublished: async () => 0 });
    const acquire = vi.fn((root: string) => admissionDelegate.acquire(root));
    const publicAdmission: PublicReplayAdmission = { acquire };
    const createId = vi.fn(() => "unicode-whitespace-must-not-run");
    const runWorkflow = vi.fn(async ({ runId }) => completedRouteSnapshot(runId));
    const handler = createPostRunsHandler({
      loadConfig: () => publicReplayConfig(runsRoot),
      assertRunsRoot,
      publicAdmission,
      createId,
      runWorkflow,
    });

    const response = await handler(runRequest({ mode: "REPLAY", request: rawRequest }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    expect(assertRunsRoot).not.toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled();
    expect(createId).not.toHaveBeenCalled();
    expect(runWorkflow).not.toHaveBeenCalled();
  },
);

it("returns DEMO_BUSY before allocating or persisting a third concurrent public root run", async () => {
  const publicAdmission = createPublicReplayAdmission({ countPublished: async () => 0 });
  const workflows: Array<ReturnType<typeof deferred<WorkflowSnapshot>>> = [];
  let runNumber = 0;
  const createId = vi.fn(() => `concurrent-root-${(runNumber += 1)}`);
  const handler = createPostRunsHandler({
    loadConfig: () => publicReplayConfig(runsRoot),
    publicAdmission,
    createId,
    runWorkflow: () => {
      const workflow = deferred<WorkflowSnapshot>();
      workflows.push(workflow);
      return workflow.promise;
    },
    persistFailure: async () => {},
  });

  const first = await handler(runRequest({ mode: "REPLAY", request: PUBLIC_REPLAY_REQUEST }));
  const second = await handler(runRequest({ mode: "REPLAY", request: PUBLIC_REPLAY_REQUEST }));
  const rejected = await handler(runRequest({ mode: "REPLAY", request: PUBLIC_REPLAY_REQUEST }));

  expect(rejected.status).toBe(429);
  expect(await rejected.json()).toEqual({
    error: {
      code: "DEMO_BUSY",
      message: "Public replay is busy. Try again shortly.",
    },
  });
  expect(createId).toHaveBeenCalledTimes(2);
  expect(workflows).toHaveLength(2);

  workflows[0]?.resolve(completedRouteSnapshot("concurrent-root-1"));
  workflows[1]?.resolve(completedRouteSnapshot("concurrent-root-2"));
  await Promise.all([collectEvents(first), collectEvents(second)]);
  expect(await readdir(runsRoot)).toEqual([]);
});

it("keeps a cancelled public root slot until the underlying workflow settles", async () => {
  const publicAdmission = createPublicReplayAdmission({ countPublished: async () => 0 });
  const workflows: Array<ReturnType<typeof deferred<WorkflowSnapshot>>> = [];
  let runNumber = 0;
  const handler = createPostRunsHandler({
    loadConfig: () => publicReplayConfig(runsRoot),
    publicAdmission,
    createId: () => `cancel-pending-root-${(runNumber += 1)}`,
    runWorkflow: () => {
      const workflow = deferred<WorkflowSnapshot>();
      workflows.push(workflow);
      return workflow.promise;
    },
    persistFailure: async () => {},
  });

  const first = await handler(runRequest({ mode: "REPLAY", request: PUBLIC_REPLAY_REQUEST }));
  const second = await handler(runRequest({ mode: "REPLAY", request: PUBLIC_REPLAY_REQUEST }));
  await first.body?.cancel();

  const whileCancelledWorkflowIsPending = await handler(
    runRequest({ mode: "REPLAY", request: PUBLIC_REPLAY_REQUEST }),
  );
  expect(whileCancelledWorkflowIsPending.status).toBe(429);
  expect(await whileCancelledWorkflowIsPending.json()).toMatchObject({
    error: { code: "DEMO_BUSY" },
  });

  workflows[0]?.resolve(completedRouteSnapshot("cancel-pending-root-1"));
  await workflows[0]?.promise;
  const afterSettlement = await handler(
    runRequest({ mode: "REPLAY", request: PUBLIC_REPLAY_REQUEST }),
  );
  expect(afterSettlement.status).toBe(200);

  workflows[1]?.resolve(completedRouteSnapshot("cancel-pending-root-2"));
  workflows[2]?.resolve(completedRouteSnapshot("cancel-pending-root-3"));
  await Promise.all([collectEvents(second), collectEvents(afterSettlement)]);
});

it("keeps a cancelled public regeneration slot until regeneration settles", async () => {
  const publicAdmission = createPublicReplayAdmission({ countPublished: async () => 0 });
  const rootWorkflows: Array<ReturnType<typeof deferred<WorkflowSnapshot>>> = [];
  const regenerationWorkflow = deferred<WorkflowSnapshot>();
  let rootRunNumber = 0;
  const rootHandler = createPostRunsHandler({
    loadConfig: () => publicReplayConfig(runsRoot),
    publicAdmission,
    createId: () => `cancel-pending-shared-root-${(rootRunNumber += 1)}`,
    runWorkflow: () => {
      const workflow = deferred<WorkflowSnapshot>();
      rootWorkflows.push(workflow);
      return workflow.promise;
    },
    persistFailure: async () => {},
  });
  const regenerationHandler = createRegenerateRunHandler({
    loadConfig: () => publicReplayConfig(runsRoot),
    publicAdmission,
    createId: () => "cancel-pending-child",
    regenerate: () => regenerationWorkflow.promise,
  });

  const root = await rootHandler(runRequest({ mode: "REPLAY", request: PUBLIC_REPLAY_REQUEST }));
  const regeneration = await regenerationHandler(
    new Request("http://localhost/api/runs/parent/regenerate", { method: "POST" }),
    { params: Promise.resolve({ runId: "parent" }) },
  );
  await regeneration.body?.cancel();

  const whileRegenerationIsPending = await rootHandler(
    runRequest({ mode: "REPLAY", request: PUBLIC_REPLAY_REQUEST }),
  );
  expect(whileRegenerationIsPending.status).toBe(429);
  expect(await whileRegenerationIsPending.json()).toMatchObject({
    error: { code: "DEMO_BUSY" },
  });

  regenerationWorkflow.resolve(completedRouteSnapshot("cancel-pending-child"));
  await regenerationWorkflow.promise;
  const afterSettlement = await rootHandler(
    runRequest({ mode: "REPLAY", request: PUBLIC_REPLAY_REQUEST }),
  );
  expect(afterSettlement.status).toBe(200);

  rootWorkflows[0]?.resolve(completedRouteSnapshot("cancel-pending-shared-root-1"));
  rootWorkflows[1]?.resolve(completedRouteSnapshot("cancel-pending-shared-root-2"));
  await Promise.all([collectEvents(root), collectEvents(afterSettlement)]);
});

it("shares the default two-slot public controller between root and regeneration workflows", async () => {
  const rootWorkflow = deferred<WorkflowSnapshot>();
  const regenerationWorkflow = deferred<WorkflowSnapshot>();
  const rootCreateId = vi.fn(() => "shared-root");
  const childCreateId = vi.fn(() => "shared-child");
  const rootHandler = createPostRunsHandler({
    loadConfig: () => publicReplayConfig(runsRoot),
    createId: rootCreateId,
    runWorkflow: () => rootWorkflow.promise,
    persistFailure: async () => {},
  });
  const regenerationHandler = createRegenerateRunHandler({
    loadConfig: () => publicReplayConfig(runsRoot),
    createId: childCreateId,
    regenerate: () => regenerationWorkflow.promise,
  });

  const rootResponse = await rootHandler(
    runRequest({ mode: "REPLAY", request: PUBLIC_REPLAY_REQUEST }),
  );
  const regenerationResponse = await regenerationHandler(
    new Request("http://localhost/api/runs/parent/regenerate", { method: "POST" }),
    { params: Promise.resolve({ runId: "parent" }) },
  );
  const rejected = await rootHandler(
    runRequest({ mode: "REPLAY", request: PUBLIC_REPLAY_REQUEST }),
  );

  expect(rejected.status).toBe(429);
  expect(await rejected.json()).toEqual({
    error: {
      code: "DEMO_BUSY",
      message: "Public replay is busy. Try again shortly.",
    },
  });
  expect(rootCreateId).toHaveBeenCalledOnce();
  expect(childCreateId).toHaveBeenCalledOnce();

  rootWorkflow.resolve(completedRouteSnapshot("shared-root"));
  regenerationWorkflow.resolve(completedRouteSnapshot("shared-child"));
  await Promise.all([collectEvents(rootResponse), collectEvents(regenerationResponse)]);
});

it("returns DEMO_CAPACITY_REACHED before a sixty-fifth public run ID or persistence entry", async () => {
  const publicAdmission = createPublicReplayAdmission({
    envelopeLimit: 64,
    countPublished: async () => 63,
  });
  const createId = vi.fn(() => "last-public-envelope");
  const persistFailure = vi.fn();
  const handler = createPostRunsHandler({
    loadConfig: () => publicReplayConfig(runsRoot),
    publicAdmission,
    createId,
    runWorkflow: async ({ runId }) => completedRouteSnapshot(runId),
    persistFailure,
  });

  const accepted = await handler(runRequest({ mode: "REPLAY", request: PUBLIC_REPLAY_REQUEST }));
  await collectEvents(accepted);
  const rejected = await handler(runRequest({ mode: "REPLAY", request: PUBLIC_REPLAY_REQUEST }));

  expect(rejected.status).toBe(503);
  expect(await rejected.json()).toEqual({
    error: {
      code: "DEMO_CAPACITY_REACHED",
      message: "Public replay capacity was reached. Try again after the service restarts.",
    },
  });
  expect(createId).toHaveBeenCalledOnce();
  expect(persistFailure).not.toHaveBeenCalled();
  expect(await readdir(runsRoot)).toEqual([]);
});

it("releases public root admission when run ID allocation fails before stream ownership", async () => {
  const publicAdmission = createPublicReplayAdmission({
    concurrencyLimit: 1,
    envelopeLimit: 4,
    countPublished: async () => 0,
  });
  let createAttempt = 0;
  const handler = createPostRunsHandler({
    loadConfig: () => publicReplayConfig(runsRoot),
    publicAdmission,
    createId: () => {
      createAttempt += 1;
      if (createAttempt === 1) throw new Error("run ID allocation failed");
      return "root-after-pre-stream-failure";
    },
    runWorkflow: async ({ runId }) => completedRouteSnapshot(runId),
    persistFailure: async () => {},
  });

  await expect(
    handler(runRequest({ mode: "REPLAY", request: PUBLIC_REPLAY_REQUEST })),
  ).rejects.toThrow();

  const afterFailure = await handler(
    runRequest({ mode: "REPLAY", request: PUBLIC_REPLAY_REQUEST }),
  );
  expect(afterFailure.status).toBe(200);
  expect(terminalSnapshots(await collectEvents(afterFailure))).toEqual([
    expect.objectContaining({ runId: "root-after-pre-stream-failure", status: "COMPLETED" }),
  ]);
});

it("releases public regeneration admission when route params reject before stream ownership", async () => {
  const publicAdmission = createPublicReplayAdmission({
    concurrencyLimit: 1,
    envelopeLimit: 4,
    countPublished: async () => 0,
  });
  const handler = createRegenerateRunHandler({
    loadConfig: () => publicReplayConfig(runsRoot),
    publicAdmission,
    createId: () => "child-after-param-failure",
    regenerate: async ({ runId }) => completedRouteSnapshot(runId),
  });
  const paramsFailure = new Error("route params failed");
  const rejectingParams = {
    then(
      _resolve: (value: { readonly runId: string }) => void,
      reject: (reason: unknown) => void,
    ): void {
      reject(paramsFailure);
    },
  } as unknown as Promise<{ readonly runId: string }>;

  await expect(
    handler(new Request("http://localhost/api/runs/parent/regenerate", { method: "POST" }), {
      params: rejectingParams,
    }),
  ).rejects.toThrow();

  const afterFailure = await handler(
    new Request("http://localhost/api/runs/parent/regenerate", { method: "POST" }),
    { params: Promise.resolve({ runId: "parent" }) },
  );
  expect(afterFailure.status).toBe(200);
  expect(terminalSnapshots(await collectEvents(afterFailure))).toEqual([
    expect.objectContaining({ runId: "child-after-param-failure", status: "COMPLETED" }),
  ]);
});

it("releases public regeneration admission when child run ID allocation fails", async () => {
  const publicAdmission = createPublicReplayAdmission({
    concurrencyLimit: 1,
    envelopeLimit: 4,
    countPublished: async () => 0,
  });
  let createAttempt = 0;
  const handler = createRegenerateRunHandler({
    loadConfig: () => publicReplayConfig(runsRoot),
    publicAdmission,
    createId: () => {
      createAttempt += 1;
      if (createAttempt === 1) throw new Error("child run ID allocation failed");
      return "child-after-id-failure";
    },
    regenerate: async ({ runId }) => completedRouteSnapshot(runId),
  });

  await expect(
    handler(new Request("http://localhost/api/runs/parent/regenerate", { method: "POST" }), {
      params: Promise.resolve({ runId: "parent" }),
    }),
  ).rejects.toThrow();

  const afterFailure = await handler(
    new Request("http://localhost/api/runs/parent/regenerate", { method: "POST" }),
    { params: Promise.resolve({ runId: "parent" }) },
  );
  expect(afterFailure.status).toBe(200);
  expect(terminalSnapshots(await collectEvents(afterFailure))).toEqual([
    expect.objectContaining({ runId: "child-after-id-failure", status: "COMPLETED" }),
  ]);
});

it.each(["success", "failure", "cancellation"] as const)(
  "releases only the concurrency slot after public workflow %s",
  async (outcome) => {
    const observed = observeLeaseReleases(
      createPublicReplayAdmission({
        concurrencyLimit: 1,
        envelopeLimit: 2,
        countPublished: async () => 0,
      }),
    );
    let runNumber = 0;
    const createId = vi.fn(() => `${outcome}-${(runNumber += 1)}`);
    const handler = createPostRunsHandler({
      loadConfig: () => publicReplayConfig(runsRoot),
      publicAdmission: observed.admission,
      createId,
      persistFailure: async () => {},
      runWorkflow:
        outcome === "success"
          ? async ({ runId }) => completedRouteSnapshot(runId)
          : outcome === "failure"
            ? async () => {
                throw new Error("classified route test failure");
              }
            : ({ signal }) => waitForAbort(signal),
    });

    for (let reservation = 1; reservation <= 2; reservation += 1) {
      const response = await handler(
        runRequest({ mode: "REPLAY", request: PUBLIC_REPLAY_REQUEST }),
      );
      if (outcome === "cancellation") await response.body?.cancel();
      else await collectEvents(response);
      await vi.waitFor(() => expect(observed.releaseCount()).toBe(reservation));
    }

    const rejected = await handler(runRequest({ mode: "REPLAY", request: PUBLIC_REPLAY_REQUEST }));
    expect(rejected.status).toBe(503);
    expect(await rejected.json()).toEqual({
      error: {
        code: "DEMO_CAPACITY_REACHED",
        message: "Public replay capacity was reached. Try again after the service restarts.",
      },
    });
    expect(createId).toHaveBeenCalledTimes(2);
  },
);

it("keeps local REPLAY outside the public admission boundary", async () => {
  const publicAdmission: PublicReplayAdmission = {
    acquire: vi.fn(async () => {
      throw new Error("Local replay must not acquire public admission.");
    }),
  };
  const handler = createPostRunsHandler({
    loadConfig: () => replayConfig(runsRoot),
    publicAdmission,
    createId: () => "local-bypass",
    runWorkflow: async ({ runId }) => completedRouteSnapshot(runId),
  });

  const response = await handler(runRequest({ mode: "REPLAY", request: REQUEST }));
  expect(response.status).toBe(200);
  expect(terminalSnapshots(await collectEvents(response))).toEqual([
    expect.objectContaining({ runId: "local-bypass", status: "COMPLETED" }),
  ]);
  expect(publicAdmission.acquire).not.toHaveBeenCalled();
});
