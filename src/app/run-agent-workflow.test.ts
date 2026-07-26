import { AppError } from "../errors/app-error.js";
import { afterEach, expect, it, vi } from "vitest";
import { readRunEnvelope } from "../artifacts/run-envelope-files.js";
import type { CollectionResult, DataHubCatalog, DataHubServerInfo } from "../datahub/catalog.js";
import type {
  EntityContext,
  EntityContextIncompleteReasonCode,
  LineageAsset,
  SchemaField,
  ToolTraceEntry,
} from "../domain/evidence.js";
import type { DatasetCandidate } from "../domain/resolve-dataset.js";
import { FixtureCatalog } from "../demo/fixture-catalog.js";
import { createBoundedMcpClose } from "../datahub/mcp/mcp-boundary-policy.js";
import { createGoldenDraft } from "../agent/fake-agent-provider.js";
import { migrationAgentInstructions } from "../agent/prompt.js";
import {
  createOpenAIAgentProviderIdentity,
  fixtureAgentProviderIdentity,
  type AgentProvider,
} from "../agent/provider.js";
import type { PackageFinding } from "../migrations/validate-sql.js";
import { loadRunSnapshot, readCompletedPackageFile } from "../runs/run-store.js";
import type { MigrationPackageDraft } from "../workflow/migration-draft.js";
import { WorkflowSnapshotSchema, type WorkflowEvent } from "../workflow/contracts.js";
import {
  cleanupWorkflowRoots,
  GOLDEN_REQUEST,
  makeWorkflowDependencies,
} from "../../tests/helpers/workflow-dependencies.js";
import { runAgentWorkflow } from "./run-agent-workflow.js";

const persistenceControl = vi.hoisted(() => ({
  failCompletedOnce: false,
  failAnalysisPublicationOnce: false,
  beforePublish: undefined as (() => void) | undefined,
  afterPublish: undefined as (() => void) | undefined,
}));

vi.mock("./run-impact-analysis.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./run-impact-analysis.js")>();
  return {
    ...actual,
    analyzeImpact: async (input: Parameters<typeof actual.analyzeImpact>[0]) => {
      const report = await actual.analyzeImpact(input);
      if (persistenceControl.failAnalysisPublicationOnce) {
        persistenceControl.failAnalysisPublicationOnce = false;
        throw new actual.ImpactReportPersistenceError(report);
      }
      return report;
    },
  };
});

vi.mock("../runs/run-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../runs/run-store.js")>();
  const { AppError: RuntimeAppError } = await import("../errors/app-error.js");
  return {
    ...actual,
    persistCompletedRun: async (input: Parameters<typeof actual.persistCompletedRun>[0]) => {
      if (persistenceControl.failCompletedOnce) {
        persistenceControl.failCompletedOnce = false;
        throw new RuntimeAppError(
          "ARTIFACT_WRITE_FAILED",
          "Injected completed-envelope publication failure.",
        );
      }
      return actual.persistCompletedRun({
        ...input,
        hooks: {
          ...(persistenceControl.beforePublish === undefined
            ? {}
            : { beforePublish: persistenceControl.beforePublish }),
          ...(persistenceControl.afterPublish === undefined
            ? {}
            : { afterPublish: persistenceControl.afterPublish }),
        },
      });
    },
  };
});

afterEach(async () => {
  persistenceControl.failCompletedOnce = false;
  persistenceControl.failAnalysisPublicationOnce = false;
  persistenceControl.beforePublish = undefined;
  persistenceControl.afterPublish = undefined;
  vi.restoreAllMocks();
  await cleanupWorkflowRoots();
});

it("emits the valid lifecycle and persists only after validation", async () => {
  const events: WorkflowEvent[] = [];
  const dependencies = await makeWorkflowDependencies();
  const result = await runAgentWorkflow({
    ...dependencies,
    onEvent: (event) => events.push(event),
  });
  expect(
    events.flatMap((event) => (event.type === "activity" ? [event.entry.status] : [])),
  ).toEqual([
    "RESOLVING_CONTEXT",
    "ANALYZING_IMPACT",
    "GENERATING_ARTIFACTS",
    "VALIDATING_ARTIFACTS",
    "COMPLETED",
  ]);
  expect(result.status).toBe("COMPLETED");
  expect(result.impact).toMatchObject({ score: 90, advisoryDecision: "BLOCK_DIRECT_RENAME" });
  expect(result.artifacts).toHaveLength(4);
  expect(result.deadlinePolicy).toEqual({
    mcpConnectMs: 15_000,
    datahubAnalysisMs: 55_000,
    analysisToolMs: 60_000,
    generationToolMs: 30_000,
    agentMs: 90_000,
    workflowMs: 95_000,
  });
  expect(result.deadlineEvents).toEqual([
    {
      kind: "DATAHUB_ANALYSIS_TIMEOUT",
      durationMs: 55_000,
      attempt: 1,
      outcome: "completed",
    },
    { kind: "AGENT_TIMEOUT", durationMs: 90_000, attempt: 1, outcome: "completed" },
    { kind: "WORKFLOW_TIMEOUT", durationMs: 95_000, attempt: 1, outcome: "completed" },
  ]);
  await expect(
    readCompletedPackageFile({
      runsRoot: dependencies.runsRoot,
      runId: result.runId,
      filename: "migration-up.sql",
    }),
  ).resolves.toContain("LineageGuard");
});

it("persists the maximal six-event deadline record without duplicates", async () => {
  const dependencies = await makeWorkflowDependencies({
    createCatalog: async (_scope, recordDeadlineEvent) => {
      recordDeadlineEvent({
        kind: "MCP_CONNECT_TIMEOUT",
        durationMs: 15_000,
        attempt: 1,
        outcome: "completed",
      });
      return new FixtureCatalog();
    },
    provider: {
      identity: fixtureAgentProviderIdentity,
      async run({ tools, request, signal, recordDeadlineEvent }) {
        const analysis = await tools.analyzeRenameChange({ request }, signal);
        if (analysis.kind !== "ready") throw new Error("Expected ready analysis.");
        await tools.generateMigrationPackage(invalidDirectRenameDraft(analysis.context), signal);
        recordDeadlineEvent({
          kind: "GENERATION_TIMEOUT",
          durationMs: 30_000,
          attempt: 1,
          outcome: "completed",
        });
        await tools.generateMigrationPackage(createGoldenDraft(analysis.context), signal);
        recordDeadlineEvent({
          kind: "GENERATION_TIMEOUT",
          durationMs: 30_000,
          attempt: 2,
          outcome: "completed",
        });
        return {
          status: "completed",
          provider: "fixture",
          model: "maximal-deadline-test",
          reasoningEffort: "none",
          analysisCalls: 1,
          generationAttempts: 2,
        };
      },
    },
  });

  const result = await runAgentWorkflow(dependencies);

  expect(result.status).toBe("COMPLETED");
  expect(result.deadlineEvents).toEqual([
    {
      kind: "MCP_CONNECT_TIMEOUT",
      durationMs: 15_000,
      attempt: 1,
      outcome: "completed",
    },
    {
      kind: "DATAHUB_ANALYSIS_TIMEOUT",
      durationMs: 55_000,
      attempt: 1,
      outcome: "completed",
    },
    {
      kind: "GENERATION_TIMEOUT",
      durationMs: 30_000,
      attempt: 1,
      outcome: "completed",
    },
    {
      kind: "GENERATION_TIMEOUT",
      durationMs: 30_000,
      attempt: 2,
      outcome: "completed",
    },
    { kind: "AGENT_TIMEOUT", durationMs: 90_000, attempt: 1, outcome: "completed" },
    { kind: "WORKFLOW_TIMEOUT", durationMs: 95_000, attempt: 1, outcome: "completed" },
  ]);
});

it("returns clarification and never calls package generation", async () => {
  const dependencies = await makeWorkflowDependencies({
    provider: {
      identity: fixtureAgentProviderIdentity,
      async run({ tools, request, signal }) {
        const analysis = await tools.analyzeRenameChange({ request }, signal);
        expect(analysis.kind).toBe("clarification");
        return {
          status: "needs_clarification",
          provider: "fixture",
          model: "clarification-test",
          reasoningEffort: "none",
          analysisCalls: 1,
          generationAttempts: 0,
          candidates: analysis.kind === "clarification" ? analysis.candidates : [],
        };
      },
    },
    createCatalog: async () => new AmbiguousFixtureCatalog(),
  });
  const result = await runAgentWorkflow(dependencies);
  expect(result.status).toBe("NEEDS_USER_CLARIFICATION");
  expect(result.failure?.candidates).toEqual(["urn:li:dataset:(one)", "urn:li:dataset:(two)"]);
  expect(result.activity.some(({ status }) => status === "GENERATING_ARTIFACTS")).toBe(false);
});

it("preserves the impact report when the provider fails", async () => {
  const dependencies = await makeWorkflowDependencies({
    provider: providerThatFailsAfterAnalysis(),
  });
  const result = await runAgentWorkflow(dependencies);
  expect(result.status).toBe("GENERATION_FAILED");
  expect(result.impact).toMatchObject({ score: 90, downstreamAssets: 24 });
  await expect(
    readRunEnvelope({ runsRoot: dependencies.runsRoot, runId: result.runId }),
  ).resolves.toMatchObject({
    kind: "failed",
    snapshot: { status: "GENERATION_FAILED", contextHash: result.contextHash },
  });
  await expect(
    readCompletedPackageFile({
      runsRoot: dependencies.runsRoot,
      runId: result.runId,
      filename: "migration-up.sql",
    }),
  ).rejects.toMatchObject({ code: "ARTIFACT_WRITE_FAILED" });
});

it("maps abort to CANCELLED and never emits COMPLETED afterwards", async () => {
  const controller = new AbortController();
  const events: WorkflowEvent[] = [];
  const dependencies = await makeWorkflowDependencies({
    provider: providerThatWaitsForAbort(),
    signal: controller.signal,
  });
  const work = runAgentWorkflow({
    ...dependencies,
    onEvent: (event) => events.push(event),
  });
  controller.abort();
  const result = await work;
  expect(result.status).toBe("CANCELLED");
  expect(
    events.some((event) => event.type === "activity" && event.entry.status === "COMPLETED"),
  ).toBe(false);
  expect(await loadRunSnapshot({ runsRoot: dependencies.runsRoot, runId: result.runId })).toEqual(
    result,
  );
  expect(result.deadlineEvents).toEqual([
    { kind: "AGENT_TIMEOUT", durationMs: 90_000, attempt: 1, outcome: "cancelled" },
    { kind: "WORKFLOW_TIMEOUT", durationMs: 95_000, attempt: 1, outcome: "cancelled" },
  ]);
});

it("persists the configured non-default live identity when cancellation wins", async () => {
  const controller = new AbortController();
  const provider = Object.assign(providerThatWaitsForAbort(), {
    identity: Object.freeze({
      provider: "openai" as const,
      model: "gpt-5.6-terra",
      reasoningEffort: "medium" as const,
    }),
  });
  const dependencies = await makeWorkflowDependencies({
    mode: "LIVE",
    provider,
    signal: controller.signal,
  });
  const work = runAgentWorkflow(dependencies);

  controller.abort();
  const result = await work;

  expect(result).toMatchObject({
    status: "CANCELLED",
    agent: {
      provider: "openai",
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
    },
  });
  await expect(
    loadRunSnapshot({ runsRoot: dependencies.runsRoot, runId: result.runId }),
  ).resolves.toMatchObject({
    agent: {
      provider: "openai",
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
    },
  });
});

it("classifies the complete DataHub analysis deadline and suppresses a late catalog result", async () => {
  vi.useFakeTimers();
  const events: WorkflowEvent[] = [];
  const catalog = new BlockingAnalysisCatalog();
  const dependencies = await makeWorkflowDependencies({
    createCatalog: async () => catalog,
    onEvent: (event) => events.push(event),
  });
  const work = runAgentWorkflow(dependencies);
  await catalog.started.promise;

  await vi.advanceTimersByTimeAsync(55_000);
  const result = await work;

  expect(result.status).toBe("DATAHUB_UNAVAILABLE");
  expect(catalog.closeCount).toBe(1);
  expect(result.agent?.generationAttempts).toBe(0);
  expect(result.deadlineEvents).toEqual([
    {
      kind: "DATAHUB_ANALYSIS_TIMEOUT",
      durationMs: 55_000,
      attempt: 1,
      outcome: "expired",
    },
    { kind: "AGENT_TIMEOUT", durationMs: 90_000, attempt: 1, outcome: "completed" },
    { kind: "WORKFLOW_TIMEOUT", durationMs: 95_000, attempt: 1, outcome: "completed" },
  ]);
  for (const filename of [
    "migration-up.sql",
    "migration-down.sql",
    "validation.sql",
    "rollout-plan.md",
  ] as const) {
    await expect(
      readCompletedPackageFile({
        runsRoot: dependencies.runsRoot,
        runId: result.runId,
        filename,
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_WRITE_FAILED" });
  }

  catalog.resolveLate();
  await Promise.resolve();
  expect(
    events.some((event) => event.type === "snapshot" && event.snapshot.status === "COMPLETED"),
  ).toBe(false);
});

it("closes a catalog factory result that arrives after the DataHub deadline", async () => {
  vi.useFakeTimers();
  const pendingCatalog = Promise.withResolvers<DataHubCatalog>();
  const catalog = new FixtureCatalog();
  const close = vi.spyOn(catalog, "close");
  const dependencies = await makeWorkflowDependencies({
    createCatalog: async () => pendingCatalog.promise,
  });
  const work = runAgentWorkflow(dependencies);

  await vi.advanceTimersByTimeAsync(55_000);
  pendingCatalog.resolve(catalog);
  const result = await work;

  expect(result.status).toBe("DATAHUB_UNAVAILABLE");
  expect(close).toHaveBeenCalledOnce();
  expect(result.deadlineEvents).toEqual([
    {
      kind: "DATAHUB_ANALYSIS_TIMEOUT",
      durationMs: 55_000,
      attempt: 1,
      outcome: "expired",
    },
    { kind: "AGENT_TIMEOUT", durationMs: 90_000, attempt: 1, outcome: "completed" },
    { kind: "WORKFLOW_TIMEOUT", durationMs: 95_000, attempt: 1, outcome: "completed" },
  ]);
});

it.each([
  { name: "rejects", catalog: () => new ClosingFixtureCatalog("reject") },
  { name: "expires", catalog: () => new ClosingFixtureCatalog("hang") },
] as const)(
  "maps a catalog close that $name to MCP_UNAVAILABLE",
  async ({ catalog: makeCatalog }) => {
    vi.useFakeTimers();
    const catalog = makeCatalog();
    const dependencies = await makeWorkflowDependencies({
      createCatalog: async () => catalog,
    });
    const work = runAgentWorkflow(dependencies);
    await catalog.closeStarted.promise;
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await work;
    const envelope = await readRunEnvelope({
      runsRoot: dependencies.runsRoot,
      runId: result.runId,
    });

    expect(result.status).toBe("MCP_UNAVAILABLE");
    expect(catalog.closeCount).toBe(1);
    expect(result.contextHash).toBeUndefined();
    expect(result.agent?.generationAttempts).toBe(0);
    expect(envelope).toMatchObject({
      kind: "failed",
      snapshot: { status: "MCP_UNAVAILABLE", artifacts: [] },
    });
    expect(envelope).not.toHaveProperty("impactReport");
    expect(envelope).not.toHaveProperty("package");
  },
);

it("persists one agent-deadline failure and never requires a route fallback", async () => {
  vi.useFakeTimers();
  const events: WorkflowEvent[] = [];
  const dependencies = await makeWorkflowDependencies({
    provider: providerThatWaitsForAbort(),
    onEvent: (event) => events.push(event),
  });
  const work = runAgentWorkflow(dependencies);

  await vi.advanceTimersByTimeAsync(90_000);
  const result = await work;

  expect(result.status).toBe("GENERATION_FAILED");
  expect(result.deadlineEvents).toEqual([
    { kind: "AGENT_TIMEOUT", durationMs: 90_000, attempt: 1, outcome: "expired" },
    { kind: "WORKFLOW_TIMEOUT", durationMs: 95_000, attempt: 1, outcome: "completed" },
  ]);
  expect(await loadRunSnapshot({ runsRoot: dependencies.runsRoot, runId: result.runId })).toEqual(
    result,
  );
  expect(events.filter((event) => event.type === "snapshot")).toHaveLength(1);
});

it("persists the configured non-default live identity when the agent deadline expires", async () => {
  vi.useFakeTimers();
  const provider = Object.assign(providerThatWaitsForAbort(), {
    identity: Object.freeze({
      provider: "openai" as const,
      model: "gpt-5.6-terra",
      reasoningEffort: "medium" as const,
    }),
  });
  const dependencies = await makeWorkflowDependencies({
    mode: "LIVE",
    provider,
  });
  const work = runAgentWorkflow(dependencies);

  await vi.advanceTimersByTimeAsync(90_000);
  const result = await work;

  expect(result).toMatchObject({
    status: "GENERATION_FAILED",
    agent: {
      provider: "openai",
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
    },
  });
  await expect(
    loadRunSnapshot({ runsRoot: dependencies.runsRoot, runId: result.runId }),
  ).resolves.toMatchObject({
    agent: {
      provider: "openai",
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
    },
  });
});

it("expires the workflow deadline at the pre-link barrier and publishes only CANCELLED", async () => {
  vi.useFakeTimers();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const events: WorkflowEvent[] = [];
  persistenceControl.beforePublish = async () => {
    entered.resolve();
    await release.promise;
  };
  const dependencies = await makeWorkflowDependencies({
    onEvent: (event) => events.push(event),
  });
  const work = runAgentWorkflow(dependencies);
  await entered.promise;

  await vi.advanceTimersByTimeAsync(95_000);
  release.resolve();
  const result = await work;

  expect(result.status).toBe("CANCELLED");
  expect(result.deadlineEvents).toEqual([
    {
      kind: "DATAHUB_ANALYSIS_TIMEOUT",
      durationMs: 55_000,
      attempt: 1,
      outcome: "completed",
    },
    { kind: "AGENT_TIMEOUT", durationMs: 90_000, attempt: 1, outcome: "completed" },
    { kind: "WORKFLOW_TIMEOUT", durationMs: 95_000, attempt: 1, outcome: "expired" },
  ]);
  expect(await loadRunSnapshot({ runsRoot: dependencies.runsRoot, runId: result.runId })).toEqual(
    result,
  );
  expect(
    events.some((event) => event.type === "snapshot" && event.snapshot.status === "COMPLETED"),
  ).toBe(false);
});

it.each([
  {
    name: "application-owned failure",
    createCatalog: async () => new FailingFixtureCatalog(),
    expectedStatus: "DATAHUB_UNAVAILABLE",
  },
  {
    name: "application-owned clarification",
    createCatalog: async () => new AmbiguousFixtureCatalog(),
    expectedStatus: "NEEDS_USER_CLARIFICATION",
  },
] as const)(
  "ignores a provider completion lie after $name",
  async ({ createCatalog, expectedStatus }) => {
    let generationCalls = 0;
    const dependencies = await makeWorkflowDependencies({
      createCatalog,
      provider: {
        identity: fixtureAgentProviderIdentity,
        async run({ tools, request, signal }) {
          await tools.analyzeRenameChange({ request }, signal);
          const generated = await tools.generateMigrationPackage(
            minimalDraft("datahub:target-dataset", "datahub:source-column:customer_id"),
            signal,
          );
          expect(generated).toMatchObject({
            kind: "rejected",
            findings: [{ code: "MISSING_CONTEXT" }],
          });
          generationCalls += 1;
          return completedProviderResult();
        },
      },
    });

    const result = await runAgentWorkflow(dependencies);

    expect(result.status).toBe(expectedStatus);
    expect(result.agent?.generationAttempts).toBe(0);
    expect(result.agent?.toolCalls[1]).toEqual({
      name: "generate_migration_package",
      calls: 0,
      outcome: "not_called",
    });
    expect(generationCalls).toBe(1);
    expect(result.activity.some(({ status }) => status === "GENERATING_ARTIFACTS")).toBe(false);
    expect(WorkflowSnapshotSchema.parse(result)).toEqual(result);
  },
);

it("ignores a model-authored request copy and analyzes only the server-owned request", async () => {
  const catalog = new RequestCaptureCatalog();
  const alternate = "Rename column hidden to leaked in dataset snowflake:attacker";
  const dependencies = await makeWorkflowDependencies({
    createCatalog: async () => catalog,
    provider: {
      identity: fixtureAgentProviderIdentity,
      async run({ tools, signal }) {
        const analysis = await tools.analyzeRenameChange({ request: alternate }, signal);
        return analysis.kind === "ready"
          ? {
              ...completedProviderResult(),
              status: "failed",
              generationAttempts: 0,
              message: "Stop after analysis.",
            }
          : completedProviderResult();
      },
    },
  });

  const result = await runAgentWorkflow(dependencies);

  expect(catalog.searchHints).toEqual(["snowflake:b2fd91.order_entry_db.analytics.order_details"]);
  expect(JSON.stringify(result)).not.toContain(alternate);
  expect(
    JSON.stringify(
      await readRunEnvelope({
        runsRoot: dependencies.runsRoot,
        runId: result.runId,
      }),
    ),
  ).not.toContain(alternate);
});

it("does not count or validate a generation call made after an accepted package", async () => {
  let afterAccepted:
    | Awaited<ReturnType<Parameters<AgentProvider["run"]>[0]["tools"]["generateMigrationPackage"]>>
    | undefined;
  const dependencies = await makeWorkflowDependencies({
    provider: {
      identity: fixtureAgentProviderIdentity,
      async run({ tools, request, signal }) {
        const analysis = await tools.analyzeRenameChange({ request }, signal);
        if (analysis.kind !== "ready") throw new Error("Expected ready context.");
        const draft = createGoldenDraft(analysis.context);
        expect(await tools.generateMigrationPackage(draft, signal)).toMatchObject({
          kind: "accepted",
        });
        afterAccepted = await tools.generateMigrationPackage(draft, signal);
        return { ...completedProviderResult(), generationAttempts: 99 };
      },
    },
  });

  const result = await runAgentWorkflow(dependencies);

  expect(afterAccepted).toMatchObject({
    kind: "rejected",
    findings: [{ code: "ATTEMPT_AFTER_ACCEPTED" }],
  });
  expect(result.status).toBe("COMPLETED");
  expect(result.agent?.generationAttempts).toBe(1);
  expect(result.activity.filter(({ status }) => status === "VALIDATING_ARTIFACTS")).toHaveLength(1);
});

it("enforces two application-owned rejected attempts and persists only the last rejected draft", async () => {
  let lastRejectedDraft: MigrationPackageDraft | undefined;
  const observedCodes: string[][] = [];
  const dependencies = await makeWorkflowDependencies({
    provider: {
      identity: fixtureAgentProviderIdentity,
      async run({ tools, request, signal }) {
        const analysis = await tools.analyzeRenameChange({ request }, signal);
        if (analysis.kind !== "ready") throw new Error("Expected ready context.");
        const invalid = invalidDirectRenameDraft(analysis.context);
        for (let attempt = 0; attempt < 2; attempt += 1) {
          lastRejectedDraft = {
            ...invalid,
            rationale:
              attempt === 0 ? "LOW_RISK_CONFIRMED_RENAME" : "DOWNSTREAM_COORDINATION_REQUIRED",
          };
          const rejected = await tools.generateMigrationPackage(lastRejectedDraft, signal);
          if (rejected.kind !== "rejected") throw new Error("Expected rejection.");
          observedCodes.push(rejected.findings.map(({ code }) => code));
        }
        const limited = await tools.generateMigrationPackage(invalid, signal);
        expect(limited).toMatchObject({
          kind: "rejected",
          findings: [{ code: "ATTEMPT_LIMIT" }],
        });
        return {
          ...completedProviderResult(),
          status: "failed",
          analysisCalls: 0,
          generationAttempts: 500,
          message: "provider telemetry is not authoritative",
        };
      },
    },
  });

  const result = await runAgentWorkflow(dependencies);
  const envelope = await readRunEnvelope({
    runsRoot: dependencies.runsRoot,
    runId: result.runId,
  });

  expect(result.status).toBe("VALIDATION_FAILED");
  expect(result.agent?.generationAttempts).toBe(2);
  expect(result.validation).toMatchObject({
    outcome: "REJECTED",
    findingCount: expect.any(Number),
  });
  expect(observedCodes).toHaveLength(2);
  expect(envelope).toMatchObject({
    kind: "failed",
    snapshot: { status: "VALIDATION_FAILED", artifacts: [] },
    draft: lastRejectedDraft,
    findings: expect.arrayContaining([
      expect.objectContaining({ code: "DIRECT_RENAME_BLOCKED" }),
      expect.objectContaining({ code: "RISK_CLASSIFICATION_MISMATCH" }),
    ]),
  });
  expect(envelope).not.toHaveProperty("package");
  for (const filename of [
    "migration-up.sql",
    "migration-down.sql",
    "validation.sql",
    "rollout-plan.md",
  ] as const) {
    await expect(
      readCompletedPackageFile({
        runsRoot: dependencies.runsRoot,
        runId: result.runId,
        filename,
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_WRITE_FAILED" });
  }
});

it("rejects a malformed runtime draft without persisting provider data", async () => {
  const secret = "malformed-draft-secret";
  const dependencies = await makeWorkflowDependencies({
    secrets: [secret],
    provider: {
      identity: fixtureAgentProviderIdentity,
      async run({ tools, request, signal }) {
        const analysis = await tools.analyzeRenameChange({ request }, signal);
        expect(analysis.kind).toBe("ready");
        const rejection = await tools.generateMigrationPackage(
          {
            schemaVersion: "1",
            evidenceIds: null,
            privateTrace: secret,
          } as unknown as MigrationPackageDraft,
          signal,
        );
        expect(rejection).toEqual({
          kind: "rejected",
          findings: [
            {
              code: "INVALID_DRAFT",
              message: "Migration draft did not match the required schema.",
            },
          ],
        });
        return {
          status: "failed",
          provider: "fixture",
          model: "malformed-draft-test",
          reasoningEffort: "none",
          analysisCalls: 88,
          generationAttempts: 88,
          message: "Generation stopped after malformed draft rejection.",
        };
      },
    },
  });

  const result = await runAgentWorkflow(dependencies);
  const envelope = await readRunEnvelope({
    runsRoot: dependencies.runsRoot,
    runId: result.runId,
  });

  expect(result).toMatchObject({
    status: "GENERATION_FAILED",
    validation: {
      outcome: "REJECTED",
      findingCount: 1,
      findingCodes: ["INVALID_DRAFT"],
    },
    agent: { generationAttempts: 1 },
  });
  expect(envelope).toMatchObject({
    kind: "failed",
    findings: [
      {
        code: "INVALID_DRAFT",
        message: "Migration draft did not match the required schema.",
      },
    ],
  });
  expect(envelope).not.toHaveProperty("draft");
  expect(JSON.stringify({ result, envelope })).not.toContain(secret);
});

it("normalizes ungrounded evidence IDs before validation and failed-envelope persistence", async () => {
  const secret = "active-draft-secret";
  const nativePathEvidence = "datahub:C:\\Users\\owner\\private-key.pem";
  const events: WorkflowEvent[] = [];
  const logs: unknown[] = [];
  for (const method of ["log", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((...values: unknown[]) => {
      logs.push(...values);
    });
  }
  let rejectionFindings: readonly PackageFinding[] = [];
  const dependencies = await makeWorkflowDependencies({
    secrets: [secret],
    onEvent: (event) => events.push(event),
    provider: {
      identity: fixtureAgentProviderIdentity,
      async run({ tools, request, signal }) {
        const analysis = await tools.analyzeRenameChange({ request }, signal);
        if (analysis.kind !== "ready") throw new Error("Expected ready analysis.");
        const invalid = invalidDirectRenameDraft(analysis.context);
        const rejection = await tools.generateMigrationPackage(
          {
            ...invalid,
            evidenceIds: [...invalid.evidenceIds, `datahub:provider:${secret}`, nativePathEvidence],
          },
          signal,
        );
        if (rejection.kind !== "rejected") throw new Error("Expected rejected draft.");
        rejectionFindings = rejection.findings;
        return {
          status: "failed",
          provider: "fixture",
          model: "hostile-evidence-test",
          reasoningEffort: "none",
          analysisCalls: 1,
          generationAttempts: 1,
          message: "Generation intentionally stopped.",
        };
      },
    },
  });

  const result = await runAgentWorkflow(dependencies);
  const envelope = await readRunEnvelope({
    runsRoot: dependencies.runsRoot,
    runId: result.runId,
  });
  const serialized = JSON.stringify({ result, envelope, events, logs, rejectionFindings });

  expect(envelope).toMatchObject({
    kind: "failed",
    draft: {
      evidenceIds: expect.arrayContaining([
        "datahub:untrusted-evidence:[REDACTED]:1",
        "datahub:untrusted-evidence:[REDACTED]:2",
      ]),
    },
    findings: expect.arrayContaining([
      {
        code: "UNKNOWN_EVIDENCE_REFERENCE",
        message:
          "Evidence reference datahub:untrusted-evidence:[REDACTED]:1 is not present in ChangeContext.",
      },
      {
        code: "UNKNOWN_EVIDENCE_REFERENCE",
        message:
          "Evidence reference datahub:untrusted-evidence:[REDACTED]:2 is not present in ChangeContext.",
      },
    ]),
  });
  expect(serialized).toContain("[REDACTED]");
  expect(serialized).not.toContain(secret);
  expect(serialized).not.toContain("private-key.pem");
  for (const filename of [
    "migration-up.sql",
    "migration-down.sql",
    "validation.sql",
    "rollout-plan.md",
  ] as const) {
    await expect(
      readCompletedPackageFile({
        runsRoot: dependencies.runsRoot,
        runId: result.runId,
        filename,
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_WRITE_FAILED" });
  }
});

it("bounds and canonically sorts one thousand clarification candidates", async () => {
  const candidates = Array.from(
    { length: 1_000 },
    (_, index) => `urn:li:dataset:(${String(999 - index).padStart(3, "0")})`,
  );
  const dependencies = await makeWorkflowDependencies({
    createCatalog: async () => new ManyCandidateCatalog(candidates),
  });

  const result = await runAgentWorkflow(dependencies);

  expect(result.status).toBe("NEEDS_USER_CLARIFICATION");
  expect(result.failure?.candidates).toEqual(
    candidates
      .slice()
      .sort((a, b) => a.localeCompare(b, "en"))
      .slice(0, 20),
  );
  expect(result.failure?.omittedCandidateCount).toBe(980);
  expect(result.failure?.message).toContain("980 additional candidates were omitted");
  expect(result.agent?.generationAttempts).toBe(0);
});

it("uses one stable canonical order for mixed-case, encoded, punctuation, and non-ASCII URNs", async () => {
  const candidates = [
    "urn:li:dataset:(alpha)",
    "urn:li:dataset:(雪)",
    "urn:li:dataset:(Alpha)",
    "urn:li:dataset:([x])",
    "urn:li:dataset:(%41)",
    "urn:li:dataset:(alpha)",
  ];
  const dependencies = await makeWorkflowDependencies({
    createCatalog: async () => new ManyCandidateCatalog(candidates),
  });

  const result = await runAgentWorkflow(dependencies);

  expect(result.failure?.candidates).toEqual([
    "urn:li:dataset:([x])",
    "urn:li:dataset:(%41)",
    "urn:li:dataset:(alpha)",
    "urn:li:dataset:(Alpha)",
    "urn:li:dataset:(雪)",
  ]);
});

it("sanitizes, deduplicates, sorts, and bounds COLUMN_NOT_FOUND fields", async () => {
  const rawFields = Array.from(
    { length: 150 },
    (_, index) => `field_${String(149 - index).padStart(3, "0")}`,
  );
  rawFields.push(rawFields[0]!, `${"x".repeat(600)}`);
  const dependencies = await makeWorkflowDependencies({
    createCatalog: async () => new MissingColumnCatalog(rawFields),
  });

  const result = await runAgentWorkflow(dependencies);

  expect(result.status).toBe("COLUMN_NOT_FOUND");
  expect(result.failure?.knownFields).toHaveLength(100);
  expect(result.failure?.knownFields).toEqual(
    [...new Set(result.failure?.knownFields)].sort((a, b) => a.localeCompare(b, "en")),
  );
  expect(result.failure?.knownFields?.every((field) => field.length <= 500)).toBe(true);
});

it("redacts active secrets from DataHub context, provider output, events, and the failed envelope", async () => {
  const secret = "active-secret-value";
  const events: WorkflowEvent[] = [];
  let capturedContext = "";
  const dependencies = await makeWorkflowDependencies({
    secrets: [secret],
    createCatalog: async () => new SecretBearingCatalog(secret),
    provider: {
      identity: fixtureAgentProviderIdentity,
      async run({ request: safeRequest, tools, signal }) {
        expect(safeRequest).toBe(GOLDEN_REQUEST);
        expect(safeRequest).not.toContain(secret);
        const analysis = await tools.analyzeRenameChange({ request: safeRequest }, signal);
        if (analysis.kind !== "ready") throw new Error("Expected ready context.");
        capturedContext = JSON.stringify(analysis.context);
        return {
          ...completedProviderResult(),
          status: "failed",
          generationAttempts: 0,
          message: `provider failed ${secret}`,
        };
      },
    },
    onEvent: (event) => events.push(event),
  });

  const result = await runAgentWorkflow(dependencies);
  const envelope = await readRunEnvelope({
    runsRoot: dependencies.runsRoot,
    runId: result.runId,
  });
  const serialized = JSON.stringify({ result, envelope, events, capturedContext });

  expect(serialized).not.toContain(secret);
  expect(serialized).toContain("[REDACTED]");
  expect(envelope).not.toHaveProperty("package");
  expect(serialized).not.toContain(migrationAgentInstructions);
});

it("fails closed when request redaction would make the dataset identity unsafe", async () => {
  const secret = "active-request-secret";
  const events: WorkflowEvent[] = [];
  const dependencies = await makeWorkflowDependencies({
    request: `${GOLDEN_REQUEST} ${secret}`,
    secrets: [secret],
    createCatalog: async () => new RedactedIdentityCatalog(),
    provider: {
      identity: fixtureAgentProviderIdentity,
      async run({ request, tools, signal }) {
        expect(request).toContain("[REDACTED]");
        expect(request).not.toContain(secret);
        const analysis = await tools.analyzeRenameChange({ request }, signal);
        expect(analysis).toMatchObject({
          kind: "failed",
          code: "ANALYSIS_FAILED",
        });
        return {
          status: "failed",
          provider: "fixture",
          model: "request-redaction-test",
          reasoningEffort: "none",
          analysisCalls: 1,
          generationAttempts: 0,
          message: analysis.kind === "failed" ? analysis.message : "Unexpected result.",
        };
      },
    },
    onEvent: (event) => events.push(event),
  });

  const result = await runAgentWorkflow(dependencies);
  const envelope = await readRunEnvelope({
    runsRoot: dependencies.runsRoot,
    runId: result.runId,
  });

  expect(result.status).toBe("ANALYSIS_FAILED");
  expect(JSON.stringify({ result, envelope, events })).not.toContain(secret);
  expect(result.failure?.message).toBe("Deterministic impact analysis failed.");
});

it("preserves the validated draft in one failed envelope when completed publication fails", async () => {
  persistenceControl.failCompletedOnce = true;
  const dependencies = await makeWorkflowDependencies();

  const result = await runAgentWorkflow(dependencies);
  const envelope = await readRunEnvelope({
    runsRoot: dependencies.runsRoot,
    runId: result.runId,
  });

  expect(result).toMatchObject({
    status: "ARTIFACT_WRITE_FAILED",
    validation: { outcome: "PASSED", findingCount: 0, findingCodes: [] },
    artifacts: [],
  });
  expect(envelope).toMatchObject({
    kind: "failed",
    snapshot: { status: "ARTIFACT_WRITE_FAILED", artifacts: [] },
    draft: {
      strategy: "NON_EXECUTABLE_TEMPLATE",
      executionClassification: "NON_EXECUTABLE_TEMPLATE",
    },
    findings: [],
  });
  expect(envelope).not.toHaveProperty("package");
  await expect(
    readCompletedPackageFile({
      runsRoot: dependencies.runsRoot,
      runId: result.runId,
      filename: "rollout-plan.md",
    }),
  ).rejects.toMatchObject({ code: "ARTIFACT_WRITE_FAILED" });
});

it("preserves sanitized deterministic analysis when legacy impact publication reports failure", async () => {
  persistenceControl.failAnalysisPublicationOnce = true;
  const dependencies = await makeWorkflowDependencies();

  const result = await runAgentWorkflow(dependencies);
  const envelope = await readRunEnvelope({
    runsRoot: dependencies.runsRoot,
    runId: result.runId,
  });

  expect(result).toMatchObject({
    status: "ARTIFACT_WRITE_FAILED",
    contextHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    impact: {
      score: 90,
      downstreamAssets: 24,
      columnAffectedAssets: 11,
    },
    artifacts: [],
  });
  expect(envelope).toMatchObject({
    kind: "failed",
    snapshot: {
      status: "ARTIFACT_WRITE_FAILED",
      contextHash: result.contextHash,
      artifacts: [],
    },
    context: { contextHash: result.contextHash },
    findings: [],
  });
  expect(envelope).not.toHaveProperty("package");
});

it("does not emit completion or expose artifacts when cancellation wins before the final link", async () => {
  const controller = new AbortController();
  const events: WorkflowEvent[] = [];
  persistenceControl.beforePublish = () => controller.abort(new Error("private abort reason"));
  const dependencies = await makeWorkflowDependencies({
    signal: controller.signal,
    onEvent: (event) => events.push(event),
  });

  const result = await runAgentWorkflow(dependencies);

  expect(result.status).toBe("CANCELLED");
  expect(result.agent?.generationAttempts).toBe(1);
  expect(
    events.some((event) => event.type === "activity" && event.entry.status === "COMPLETED"),
  ).toBe(false);
  expect(
    await readRunEnvelope({
      runsRoot: dependencies.runsRoot,
      runId: result.runId,
    }),
  ).toMatchObject({
    kind: "failed",
    snapshot: { status: "CANCELLED", artifacts: [] },
    findings: [],
    draft: expect.any(Object),
  });
  expect(
    events.filter((event) => event.type === "snapshot" && event.snapshot.status === "CANCELLED"),
  ).toHaveLength(1);
  expect(result.deadlineEvents?.at(-1)).toEqual({
    kind: "WORKFLOW_TIMEOUT",
    durationMs: 95_000,
    attempt: 1,
    outcome: "cancelled",
  });
});

it("keeps the completed envelope authoritative when cancellation happens after the final link", async () => {
  const controller = new AbortController();
  const events: WorkflowEvent[] = [];
  persistenceControl.afterPublish = () => controller.abort(new Error("private late abort"));
  const dependencies = await makeWorkflowDependencies({
    signal: controller.signal,
    onEvent: (event) => events.push(event),
  });

  const result = await runAgentWorkflow(dependencies);

  expect(result.status).toBe("COMPLETED");
  expect(
    events.some((event) => event.type === "activity" && event.entry.status === "CANCELLED"),
  ).toBe(false);
  expect(
    await readRunEnvelope({
      runsRoot: dependencies.runsRoot,
      runId: result.runId,
    }),
  ).toMatchObject({
    kind: "completed",
    snapshot: { status: "COMPLETED" },
  });
  expect(result.deadlineEvents?.at(-1)).toEqual({
    kind: "WORKFLOW_TIMEOUT",
    durationMs: 95_000,
    attempt: 1,
    outcome: "completed",
  });
});

it("treats event delivery failure after publication as a disconnected response, not cancellation", async () => {
  const dependencies = await makeWorkflowDependencies({
    onEvent: (event) => {
      if (
        (event.type === "activity" && event.entry.status === "COMPLETED") ||
        event.type === "snapshot"
      ) {
        throw new Error("response closed");
      }
    },
  });

  const result = await runAgentWorkflow(dependencies);

  expect(result.status).toBe("COMPLETED");
  expect(
    await readRunEnvelope({
      runsRoot: dependencies.runsRoot,
      runId: result.runId,
    }),
  ).toMatchObject({ kind: "completed", snapshot: { status: "COMPLETED" } });
});

it("serializes only the closed verified DataHub metadata surface", async () => {
  const secret = "metadata-secret";
  const dependencies = await makeWorkflowDependencies({
    secrets: [secret],
    createCatalog: async () => new SecretBearingCatalog(secret),
    provider: providerThatFailsAfterAnalysis(),
  });

  const result = await runAgentWorkflow(dependencies);

  expect(result.datahub).toEqual({
    source: "fixture",
    verification: "REPLAY_FIXTURE",
    configuredMcpPackage: "mcp-server-datahub@0.6.0",
    allowedTools: ["search", "list_schema_fields", "get_lineage", "get_entities"],
    reportedServerName: "fixture-[REDACTED]",
  });
  expect(JSON.stringify(result.datahub)).not.toContain(secret);
  expect(JSON.stringify(result.datahub)).not.toContain("save_document");
});

it("omits legitimately absent optional DataHub server identity", async () => {
  const dependencies = await makeWorkflowDependencies({
    createCatalog: async () => new ServerInfoCatalog({}),
    provider: providerThatFailsAfterAnalysis(),
  });

  const result = await runAgentWorkflow(dependencies);

  expect(result.datahub).toEqual({
    source: "fixture",
    verification: "REPLAY_FIXTURE",
    configuredMcpPackage: "mcp-server-datahub@0.6.0",
    allowedTools: ["search", "list_schema_fields", "get_lineage", "get_entities"],
  });
});

it("bounds optional DataHub server identity before persistence", async () => {
  const dependencies = await makeWorkflowDependencies({
    createCatalog: async () =>
      new ServerInfoCatalog({
        reportedServerName: "n".repeat(150),
        reportedServerVersion: "v".repeat(150),
      }),
    provider: providerThatFailsAfterAnalysis(),
  });

  const result = await runAgentWorkflow(dependencies);

  expect(result.datahub?.reportedServerName).toBe("n".repeat(100));
  expect(result.datahub?.reportedServerVersion).toBe("v".repeat(100));
});

it("omits unverified DataHub metadata when the live capability gate fails", async () => {
  const dependencies = await makeWorkflowDependencies({
    mode: "LIVE",
    createCatalog: async () => {
      throw new AppError("MCP_UNAVAILABLE", "raw lower-level capability detail");
    },
    provider: liveProviderThatStopsAfterAnalysis(),
  });

  const result = await runAgentWorkflow(dependencies);

  expect(result.status).toBe("MCP_UNAVAILABLE");
  expect(result.datahub).toBeUndefined();
  expect(result.agent?.provider).toBe("openai");
});

it("maps a verified live catalog to the closed MCP proof", async () => {
  const dependencies = await makeWorkflowDependencies({
    mode: "LIVE",
    createCatalog: async () => new RequestCaptureCatalog(),
    provider: liveProviderThatStopsAfterAnalysis(),
  });

  const result = await runAgentWorkflow(dependencies);

  expect(result.status).toBe("GENERATION_FAILED");
  expect(result.datahub).toEqual({
    source: "mcp",
    verification: "CAPABILITY_GATE_PASSED",
    configuredMcpPackage: "mcp-server-datahub@0.6.0",
    allowedTools: ["search", "list_schema_fields", "get_lineage", "get_entities"],
    reportedServerName: "fixture",
    reportedServerVersion: "replay-v1",
  });
  expect(WorkflowSnapshotSchema.safeParse({ ...result, mode: "REPLAY" }).success).toBe(false);
});

it("rejects generation before analysis without consuming an application attempt", async () => {
  const dependencies = await makeWorkflowDependencies({
    provider: {
      identity: fixtureAgentProviderIdentity,
      async run({ tools, signal }) {
        expect(
          await tools.generateMigrationPackage(
            minimalDraft("datahub:target-dataset", "datahub:source-column:customer_id"),
            signal,
          ),
        ).toMatchObject({
          kind: "rejected",
          findings: [{ code: "MISSING_CONTEXT" }],
        });
        return {
          status: "failed",
          provider: "fixture",
          model: "order-test",
          reasoningEffort: "none",
          analysisCalls: 0,
          generationAttempts: 99,
          message: "Stopped before analysis.",
        };
      },
    },
  });

  const result = await runAgentWorkflow(dependencies);

  expect(result.status).toBe("ANALYSIS_FAILED");
  expect(result.agent?.toolCalls).toEqual([
    { name: "analyze_rename_change", calls: 0, outcome: "not_called" },
    { name: "generate_migration_package", calls: 0, outcome: "not_called" },
  ]);
});

it("preserves an already-started analysis call when cancellation interrupts DataHub", async () => {
  const controller = new AbortController();
  const dependencies = await makeWorkflowDependencies({
    signal: controller.signal,
    createCatalog: async () => new CancellingCatalog(controller),
  });

  const result = await runAgentWorkflow(dependencies);

  expect(result.status).toBe("CANCELLED");
  expect(result.agent?.toolCalls[0]).toEqual({
    name: "analyze_rename_change",
    calls: 1,
    outcome: "failed",
  });
});

it("preserves an already-started generation attempt when cancellation interrupts validation", async () => {
  const controller = new AbortController();
  const dependencies = await makeWorkflowDependencies({
    signal: controller.signal,
    provider: {
      identity: fixtureAgentProviderIdentity,
      async run({ tools, request, signal }) {
        const analysis = await tools.analyzeRenameChange({ request }, signal);
        if (analysis.kind !== "ready") throw new Error("Expected ready context.");
        const draft = createGoldenDraft(analysis.context);
        const cancellingDraft = {
          ...draft,
          get evidenceIds() {
            controller.abort(new Error("private validation abort"));
            return draft.evidenceIds;
          },
        };
        await tools.generateMigrationPackage(cancellingDraft, signal);
        return completedProviderResult();
      },
    },
  });

  const result = await runAgentWorkflow(dependencies);

  expect(result.status).toBe("CANCELLED");
  expect(result.agent?.generationAttempts).toBe(1);
  expect(result.agent?.toolCalls[1]).toEqual({
    name: "generate_migration_package",
    calls: 1,
    outcome: "failed",
  });
});

class AmbiguousFixtureCatalog implements DataHubCatalog {
  async searchDatasets(): Promise<CollectionResult<DatasetCandidate>> {
    return complete([
      {
        urn: "urn:li:dataset:(two)",
        name: "b2fd91.order_entry_db.analytics.order_details",
        platform: "snowflake",
      },
      {
        urn: "urn:li:dataset:(one)",
        name: "b2fd91.order_entry_db.analytics.order_details",
        platform: "snowflake",
      },
    ]);
  }
  async listSchemaFields(): Promise<CollectionResult<SchemaField>> {
    throw new Error("Schema must not be called.");
  }
  async getDownstreamLineage(): Promise<CollectionResult<LineageAsset>> {
    throw new Error("Lineage must not be called.");
  }
  async getEntityContext(): Promise<
    CollectionResult<EntityContext, EntityContextIncompleteReasonCode>
  > {
    throw new Error("Entity context must not be called.");
  }
  getServerInfo(): DataHubServerInfo {
    return { reportedServerName: "fixture", reportedServerVersion: "replay-v1" };
  }
  getTrace(): readonly ToolTraceEntry[] {
    return [];
  }
  async close(): Promise<void> {}
}

class BlockingAnalysisCatalog extends FixtureCatalog {
  readonly started = Promise.withResolvers<void>();
  readonly #late = Promise.withResolvers<CollectionResult<DatasetCandidate>>();
  closeCount = 0;

  override async searchDatasets(
    _hint: string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<CollectionResult<DatasetCandidate>> {
    this.started.resolve();
    const signal = options.signal;
    if (signal === undefined) throw new Error("Expected the application-owned analysis signal.");
    return Promise.race([
      this.#late.promise,
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
          once: true,
        });
      }),
    ]);
  }

  resolveLate(): void {
    this.#late.resolve(complete([]));
  }

  override async close(): Promise<void> {
    this.closeCount += 1;
  }
}

class ClosingFixtureCatalog extends FixtureCatalog {
  readonly closeStarted = Promise.withResolvers<void>();
  closeCount = 0;
  readonly #close: () => Promise<void>;

  constructor(outcome: "reject" | "hang") {
    super();
    this.#close = createBoundedMcpClose(async () => {
      this.closeCount += 1;
      this.closeStarted.resolve();
      if (outcome === "reject") throw new Error("raw close failure");
      return new Promise<never>(() => undefined);
    });
  }

  override close(): Promise<void> {
    return this.#close();
  }
}

class ManyCandidateCatalog extends AmbiguousFixtureCatalog {
  constructor(private readonly candidates: readonly string[]) {
    super();
  }
  override async searchDatasets(): Promise<CollectionResult<DatasetCandidate>> {
    return complete(
      this.candidates.map((urn) => ({
        urn,
        name: "b2fd91.order_entry_db.analytics.order_details",
        platform: "snowflake",
      })),
    );
  }
}

class FailingFixtureCatalog extends AmbiguousFixtureCatalog {
  override async searchDatasets(): Promise<CollectionResult<DatasetCandidate>> {
    throw new AppError("DATAHUB_UNAVAILABLE", "raw transport detail");
  }
}

class RequestCaptureCatalog implements DataHubCatalog {
  readonly searchHints: string[] = [];
  async searchDatasets(hint: string): Promise<CollectionResult<DatasetCandidate>> {
    this.searchHints.push(hint);
    return complete([
      {
        urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details,PROD)",
        name: "b2fd91.order_entry_db.analytics.order_details",
        platform: "snowflake",
        environment: "PROD",
      },
    ]);
  }
  async listSchemaFields(): Promise<CollectionResult<SchemaField>> {
    return complete([
      { fieldPath: "customer_id", nativeDataType: "NUMBER(38,0)" },
      { fieldPath: "order_id", nativeDataType: "NUMBER(38,0)" },
    ]);
  }
  async getDownstreamLineage(
    _urn: string,
    options: { readonly column?: string; readonly maxHops: 2 },
  ): Promise<CollectionResult<LineageAsset>> {
    return complete(
      options.column === undefined
        ? [
            {
              urn: "urn:li:dataset:(downstream)",
              hop: 1,
              lineageColumns: [],
            },
          ]
        : [
            {
              urn: "urn:li:dataset:(downstream)",
              hop: 1,
              lineageColumns: ["customer_id"],
            },
          ],
    );
  }
  async getEntityContext(
    urns: readonly string[],
  ): Promise<CollectionResult<EntityContext, EntityContextIncompleteReasonCode>> {
    return complete(
      urns.map((urn) => ({
        urn,
        entityType: "DATASET",
        owners: [],
        tags: [],
        glossaryTerms: [],
        siblingUrns: [],
        qualitySignals: [],
      })),
    );
  }
  getServerInfo(): DataHubServerInfo {
    return { reportedServerName: "fixture", reportedServerVersion: "replay-v1" };
  }
  getTrace(): readonly ToolTraceEntry[] {
    return [];
  }
  async close(): Promise<void> {}
}

class CancellingCatalog extends RequestCaptureCatalog {
  constructor(private readonly controller: AbortController) {
    super();
  }
  override async searchDatasets(): Promise<CollectionResult<DatasetCandidate>> {
    this.controller.abort(new Error("private DataHub abort"));
    this.controller.signal.throwIfAborted();
    throw new Error("unreachable");
  }
}

class MissingColumnCatalog extends RequestCaptureCatalog {
  constructor(private readonly knownFields: readonly string[]) {
    super();
  }
  override async listSchemaFields(): Promise<CollectionResult<SchemaField>> {
    return complete(this.knownFields.map((fieldPath) => ({ fieldPath })));
  }
}

class ServerInfoCatalog extends RequestCaptureCatalog {
  constructor(private readonly serverInfo: DataHubServerInfo) {
    super();
  }
  override getServerInfo(): DataHubServerInfo {
    return this.serverInfo;
  }
}

class SecretBearingCatalog extends RequestCaptureCatalog {
  constructor(private readonly secret: string) {
    super();
  }
  override async getEntityContext(
    urns: readonly string[],
  ): Promise<CollectionResult<EntityContext, EntityContextIncompleteReasonCode>> {
    return complete(
      urns.map((urn) => ({
        urn,
        entityType: "DATASET",
        description: `description ${this.secret}`,
        owners: [],
        tags: [],
        glossaryTerms: [],
        siblingUrns: [],
        qualitySignals: [`quality ${this.secret}`],
      })),
    );
  }
  override getServerInfo(): DataHubServerInfo {
    return {
      reportedServerName: `fixture-${this.secret}`,
      reportedServerVersion: this.secret,
    };
  }
}

class RedactedIdentityCatalog extends RequestCaptureCatalog {
  override async searchDatasets(hint: string): Promise<CollectionResult<DatasetCandidate>> {
    this.searchHints.push(hint);
    return complete([
      {
        urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,redacted-identity,PROD)",
        name: "b2fd91.order_entry_db.analytics.order_details [REDACTED]",
        platform: "snowflake",
        environment: "PROD",
      },
    ]);
  }
}

function complete<T>(items: readonly T[]): CollectionResult<T, never> {
  return {
    items,
    completeness: {
      complete: true,
      pages: 1,
      itemCount: items.length,
      offsets: [0],
      reasonCodes: [],
    },
  };
}

function completedProviderResult() {
  return {
    status: "completed" as const,
    provider: "fixture" as const,
    model: "adversarial-test",
    reasoningEffort: "none" as const,
    analysisCalls: 99,
    generationAttempts: 99,
  };
}

function providerThatFailsAfterAnalysis(): AgentProvider {
  return {
    identity: fixtureAgentProviderIdentity,
    async run({ tools, request, signal }) {
      const analysis = await tools.analyzeRenameChange({ request }, signal);
      expect(analysis.kind).toBe("ready");
      return {
        status: "failed",
        provider: "fixture",
        model: "failure-test",
        reasoningEffort: "none",
        analysisCalls: 1,
        generationAttempts: 1,
        message: "Sanitized generation failure.",
        failure: {
          code: "GENERATION_FAILED",
          message: "Sanitized generation failure.",
        },
      };
    },
  };
}

function providerThatWaitsForAbort(): AgentProvider {
  return {
    identity: fixtureAgentProviderIdentity,
    run({ signal }) {
      return new Promise((_, reject) => {
        const rejectFromAbort = () => reject(signal.reason);
        if (signal.aborted) {
          rejectFromAbort();
          return;
        }
        signal.addEventListener("abort", rejectFromAbort, { once: true });
      });
    },
  };
}

function liveProviderThatStopsAfterAnalysis(): AgentProvider {
  return {
    identity: createOpenAIAgentProviderIdentity("gpt-5.6-sol"),
    async run({ tools, request, signal }) {
      const analysis = await tools.analyzeRenameChange({ request }, signal);
      return {
        status: "failed",
        provider: "openai",
        model: "gpt-5.6-sol",
        reasoningEffort: "medium",
        analysisCalls: 1,
        generationAttempts: 0,
        message:
          analysis.kind === "failed" ? analysis.message : "Generation intentionally stopped.",
        ...(analysis.kind === "failed"
          ? { failure: { code: analysis.code, message: analysis.message } }
          : {
              failure: {
                code: "GENERATION_FAILED" as const,
                message: "Generation intentionally stopped.",
              },
            }),
      };
    },
  };
}

function minimalDraft(targetId: string, sourceId: string): MigrationPackageDraft {
  return {
    schemaVersion: "1",
    strategy: "STAGED_COMPATIBILITY",
    executionClassification: "ADVISORY_ONLY",
    rationale: "CRITICAL_DOWNSTREAM_IMPACT",
    evidenceIds: [targetId, sourceId],
    stages: [
      "PREPARE",
      "ADD_COMPATIBLE_COLUMN",
      "BACKFILL",
      "MIGRATE_DOWNSTREAM",
      "VALIDATE",
      "RETIRE_SOURCE_COLUMN",
    ],
    validationChecks: ["SOURCE_COLUMN_EXISTS", "TARGET_COLUMN_EXISTS"],
    rollback: "KEEP_SOURCE_AND_REMOVE_TARGET_AFTER_REVIEW",
    warnings: ["DIRECT_RENAME_BLOCKED", "HUMAN_APPROVAL_REQUIRED"],
  };
}

function invalidDirectRenameDraft(
  context: Parameters<typeof createGoldenDraft>[0],
): MigrationPackageDraft {
  return {
    ...createGoldenDraft(context),
    strategy: "DIRECT_RENAME",
    executionClassification: "EXECUTABLE_WITH_REVIEW",
    rationale: "LOW_RISK_CONFIRMED_RENAME",
    stages: ["DIRECT_RENAME"],
    rollback: "RENAME_TARGET_BACK_TO_SOURCE",
    warnings: [],
  };
}
