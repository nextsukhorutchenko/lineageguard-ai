import type { AgentProvider } from "../agent/provider.js";
import { FakeAgentProvider } from "../agent/fake-agent-provider.js";
import { OpenAIAgentProvider } from "../agent/openai-agent-provider.js";
import { assertTrustedRunsRoot } from "../artifacts/run-envelope-files.js";
import { loadRuntimeConfig } from "../config/runtime-config.js";
import { loadWebConfig, type WebConfig } from "../config/web-config.js";
import { createDataHubCatalog } from "../datahub/create-catalog.js";
import { FixtureCatalog } from "../demo/fixture-catalog.js";
import {
  assertEmptyRequestBody,
  MAX_RUN_REQUEST_BYTES,
  readBoundedUtf8Body,
} from "../http/bounded-body.js";
import { createRunId } from "../runs/create-run-id.js";
import { persistFailedRun } from "../runs/run-store.js";
import { DEADLINES_MS } from "../runtime/deadlines.js";
import { encodeWorkflowEvent } from "../ui/read-ndjson.js";
import {
  RunRequestSchema,
  WorkflowSnapshotSchema,
  type RunRequest,
  type WorkflowEvent,
  type WorkflowSnapshot,
} from "../workflow/contracts.js";
import { isTerminalWorkflowStatus } from "../workflow/state-machine.js";
import { regeneratePackage } from "./regenerate-package.js";
import { runAgentWorkflow, type RunAgentWorkflowDependencies } from "./run-agent-workflow.js";

export interface WebWorkflowDependencyInput {
  readonly config: WebConfig;
  readonly runsRoot: string;
  readonly request: string;
  readonly runId: string;
  readonly signal: AbortSignal;
  readonly onEvent: (event: WorkflowEvent) => void;
}

function createProvider(config: WebConfig): AgentProvider {
  return config.mode === "REPLAY"
    ? new FakeAgentProvider()
    : new OpenAIAgentProvider({
        apiKey: config.openaiApiKey,
        model: config.openaiModel,
      });
}

export function createWebWorkflowDependencies(
  input: WebWorkflowDependencyInput,
): RunAgentWorkflowDependencies {
  const shared = {
    request: input.request,
    mode: input.config.mode,
    runsRoot: input.runsRoot,
    runId: input.runId,
    signal: input.signal,
    clock: () => new Date(),
    onEvent: input.onEvent,
  } as const;
  if (input.config.mode === "REPLAY") {
    return {
      ...shared,
      provider: createProvider(input.config),
      createCatalog: async (scope, recordDeadlineEvent) => {
        void scope;
        void recordDeadlineEvent;
        return new FixtureCatalog();
      },
      secrets: [],
    };
  }
  const runtimeConfig = loadRuntimeConfig({
    DATAHUB_GMS_URL: input.config.datahubGmsUrl,
    DATAHUB_GMS_TOKEN: input.config.datahubGmsToken,
    DATAHUB_MCP_UVX_PATH: input.config.uvxPath,
    LINEAGEGUARD_RUNS_DIR: input.runsRoot,
  });
  return {
    ...shared,
    provider: createProvider(input.config),
    createCatalog: (scope, recordDeadlineEvent) =>
      createDataHubCatalog(runtimeConfig, scope, recordDeadlineEvent),
    secrets: [input.config.openaiApiKey, input.config.datahubGmsToken],
  };
}

export function createWebRegenerationDependencies(input: {
  readonly config: WebConfig;
  readonly runsRoot: string;
  readonly parentRunId: string;
  readonly runId: string;
  readonly signal: AbortSignal;
  readonly onEvent: (event: WorkflowEvent) => void;
}) {
  return {
    parentRunId: input.parentRunId,
    runId: input.runId,
    runsRoot: input.runsRoot,
    mode: input.config.mode,
    provider: createProvider(input.config),
    signal: input.signal,
    clock: () => new Date(),
    secrets:
      input.config.mode === "LIVE" ? [input.config.openaiApiKey, input.config.datahubGmsToken] : [],
    onEvent: input.onEvent,
  } as const;
}

function safeFailureSnapshot(
  runId: string,
  mode: WebConfig["mode"],
  status: "GENERATION_FAILED" | "CANCELLED",
  message: string,
): WorkflowSnapshot {
  return WorkflowSnapshotSchema.parse({
    runId,
    mode,
    status,
    activity: [],
    evidence: [],
    facts: [],
    assumptions: [],
    unknowns: [],
    artifacts: [],
    validation: { outcome: "NOT_RUN", findingCount: 0, findingCodes: [] },
    deadlinePolicy: {
      mcpConnectMs: DEADLINES_MS.mcpConnect,
      datahubAnalysisMs: DEADLINES_MS.datahubAnalysis,
      analysisToolMs: DEADLINES_MS.analysisTool,
      generationToolMs: DEADLINES_MS.generationTool,
      agentMs: DEADLINES_MS.agent,
      workflowMs: DEADLINES_MS.workflow,
    },
    deadlineEvents: [],
    failure: { code: status, message },
  });
}

export function safeUnexpectedFailureSnapshot(
  runId: string,
  mode: WebConfig["mode"],
): WorkflowSnapshot {
  return safeFailureSnapshot(runId, mode, "GENERATION_FAILED", "The workflow failed unexpectedly.");
}

export function safeCancellationSnapshot(runId: string, mode: WebConfig["mode"]): WorkflowSnapshot {
  return safeFailureSnapshot(runId, mode, "CANCELLED", "The workflow was cancelled.");
}

export interface PostRunsHandlerOverrides {
  readonly loadConfig?: typeof loadWebConfig;
  readonly assertRunsRoot?: typeof assertTrustedRunsRoot;
  readonly createDependencies?: typeof createWebWorkflowDependencies;
  readonly runWorkflow?: typeof runAgentWorkflow;
  readonly persistFailure?: typeof persistFailedRun;
  readonly createId?: typeof createRunId;
}

export function createPostRunsHandler(overrides: PostRunsHandlerOverrides = {}) {
  const loadConfig = overrides.loadConfig ?? loadWebConfig;
  const assertRunsRoot = overrides.assertRunsRoot ?? assertTrustedRunsRoot;
  const createDependencies = overrides.createDependencies ?? createWebWorkflowDependencies;
  const runWorkflow = overrides.runWorkflow ?? runAgentWorkflow;
  const persistFailure = overrides.persistFailure ?? persistFailedRun;
  const createId = overrides.createId ?? createRunId;

  return async function postRuns(request: Request): Promise<Response> {
    let input: RunRequest;
    try {
      const rawBody = await readBoundedUtf8Body(request, MAX_RUN_REQUEST_BYTES);
      input = RunRequestSchema.parse(JSON.parse(rawBody));
    } catch {
      return Response.json({ error: "Invalid rename request." }, { status: 400 });
    }
    let config: WebConfig;
    try {
      config = loadConfig(process.env);
    } catch {
      return Response.json({ error: "Demo service is not configured." }, { status: 503 });
    }
    let trustedRunsRoot: string;
    try {
      trustedRunsRoot = await assertRunsRoot(config.runsRoot);
    } catch {
      return Response.json({ error: "Demo service storage is unavailable." }, { status: 503 });
    }
    if (input.mode !== config.mode) {
      return Response.json(
        { error: "Requested mode does not match server mode." },
        { status: 409 },
      );
    }

    const runId = createId(new Date());
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    if (request.signal.aborted) abort();
    else request.signal.addEventListener("abort", abort, { once: true });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let terminalSnapshotSent = false;
        const safeEnqueue = (event: WorkflowEvent): boolean => {
          try {
            controller.enqueue(encodeWorkflowEvent(event));
            if (event.type === "snapshot" && isTerminalWorkflowStatus(event.snapshot.status)) {
              terminalSnapshotSent = true;
            }
            return true;
          } catch {
            return false;
          }
        };
        try {
          const snapshot = await runWorkflow(
            createDependencies({
              config,
              runsRoot: trustedRunsRoot,
              request: input.request,
              runId,
              signal: abortController.signal,
              onEvent: (event) => void safeEnqueue(event),
            }),
          );
          if (!terminalSnapshotSent) safeEnqueue({ type: "snapshot", snapshot });
        } catch {
          if (!terminalSnapshotSent) {
            const snapshot = abortController.signal.aborted
              ? safeCancellationSnapshot(runId, config.mode)
              : safeUnexpectedFailureSnapshot(runId, config.mode);
            try {
              await persistFailure({
                runsRoot: trustedRunsRoot,
                runId,
                snapshot,
                secrets:
                  config.mode === "LIVE" ? [config.openaiApiKey, config.datahubGmsToken] : [],
              });
            } catch {
              // The same closed fallback is safe to stream when persistence is unavailable.
            }
            safeEnqueue({ type: "snapshot", snapshot });
          }
        } finally {
          request.signal.removeEventListener("abort", abort);
          try {
            controller.close();
          } catch {
            // A disconnected client is expected to have cancelled the stream.
          }
        }
      },
      cancel() {
        abortController.abort();
      },
    });
    return new Response(stream, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
}

type RegenerateRouteContext = { readonly params: Promise<{ readonly runId: string }> };

export interface RegenerateRunHandlerOverrides {
  readonly loadConfig?: typeof loadWebConfig;
  readonly assertRunsRoot?: typeof assertTrustedRunsRoot;
  readonly createDependencies?: typeof createWebRegenerationDependencies;
  readonly regenerate?: typeof regeneratePackage;
  readonly createId?: typeof createRunId;
}

export function createRegenerateRunHandler(overrides: RegenerateRunHandlerOverrides = {}) {
  const loadConfig = overrides.loadConfig ?? loadWebConfig;
  const assertRunsRoot = overrides.assertRunsRoot ?? assertTrustedRunsRoot;
  const createDependencies = overrides.createDependencies ?? createWebRegenerationDependencies;
  const regenerate = overrides.regenerate ?? regeneratePackage;
  const createId = overrides.createId ?? createRunId;

  return async function regenerateRun(
    request: Request,
    context: RegenerateRouteContext,
  ): Promise<Response> {
    try {
      await assertEmptyRequestBody(request);
    } catch {
      return Response.json({ error: "Invalid regeneration request." }, { status: 400 });
    }

    let config: WebConfig;
    try {
      config = loadConfig(process.env);
    } catch {
      return Response.json({ error: "Demo service is not configured." }, { status: 503 });
    }
    let runsRoot: string;
    try {
      runsRoot = await assertRunsRoot(config.runsRoot);
    } catch {
      return Response.json({ error: "Demo service storage is unavailable." }, { status: 503 });
    }

    const { runId: parentRunId } = await context.params;
    const runId = createId(new Date());
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    if (request.signal.aborted) abort();
    else request.signal.addEventListener("abort", abort, { once: true });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let terminalSnapshotSent = false;
        const safeEnqueue = (event: WorkflowEvent): boolean => {
          try {
            controller.enqueue(encodeWorkflowEvent(event));
            if (event.type === "snapshot" && isTerminalWorkflowStatus(event.snapshot.status)) {
              terminalSnapshotSent = true;
            }
            return true;
          } catch {
            return false;
          }
        };
        try {
          const snapshot = await regenerate(
            createDependencies({
              config,
              runsRoot,
              parentRunId,
              runId,
              signal: abortController.signal,
              onEvent: (event) => void safeEnqueue(event),
            }),
          );
          if (!terminalSnapshotSent) safeEnqueue({ type: "snapshot", snapshot });
        } catch {
          if (!terminalSnapshotSent) {
            const snapshot = abortController.signal.aborted
              ? safeCancellationSnapshot(runId, config.mode)
              : safeUnexpectedFailureSnapshot(runId, config.mode);
            safeEnqueue({ type: "snapshot", snapshot });
          }
        } finally {
          request.signal.removeEventListener("abort", abort);
          try {
            controller.close();
          } catch {
            // A disconnected client is expected to have cancelled the stream.
          }
        }
      },
      cancel() {
        abortController.abort();
      },
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
}
