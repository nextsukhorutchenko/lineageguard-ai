import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { AgentProvider } from "../agent/provider.js";
import { createGoldenDraft, FakeAgentProvider } from "../agent/fake-agent-provider.js";
import { readRunEnvelope } from "../artifacts/run-envelope-files.js";
import {
  cleanupWorkflowRoots,
  makeWorkflowDependencies,
} from "../../tests/helpers/workflow-dependencies.js";
import { runAgentWorkflow } from "./run-agent-workflow.js";
import { regeneratePackage } from "./regenerate-package.js";

afterEach(cleanupWorkflowRoots);

it("regenerates from stored context into one fresh child without DataHub analysis", async () => {
  const parentDependencies = await makeWorkflowDependencies();
  const parent = await runAgentWorkflow(parentDependencies);
  let providerCalls = 0;
  const provider: AgentProvider = {
    async run(input) {
      providerCalls += 1;
      return new FakeAgentProvider().run(input);
    },
  };

  const child = await regeneratePackage({
    parentRunId: parent.runId,
    runId: "run-child",
    runsRoot: parentDependencies.runsRoot,
    mode: "REPLAY",
    provider,
    signal: new AbortController().signal,
    clock: parentDependencies.clock,
    secrets: [],
  });

  expect(providerCalls).toBe(1);
  expect(child).toMatchObject({
    runId: "run-child",
    parentRunId: parent.runId,
    mode: "REPLAY",
    status: "COMPLETED",
    contextHash: parent.contextHash,
    datahub: parent.datahub,
  });
  expect(child.activity[0]?.status).toBe("GENERATING_ARTIFACTS");
  expect(child.deadlineEvents).toEqual([
    { kind: "AGENT_TIMEOUT", durationMs: 90_000, attempt: 1, outcome: "completed" },
    { kind: "WORKFLOW_TIMEOUT", durationMs: 95_000, attempt: 1, outcome: "completed" },
  ]);
  expect(
    await readRunEnvelope({
      runsRoot: parentDependencies.runsRoot,
      runId: child.runId,
    }),
  ).toMatchObject({ generationAttempt: 2, parentRunId: parent.runId });
});

it("rejects a reused run ID before provider execution", async () => {
  const parentDependencies = await makeWorkflowDependencies();
  const parent = await runAgentWorkflow(parentDependencies);
  let providerCalls = 0;

  await expect(
    regeneratePackage({
      parentRunId: parent.runId,
      runId: parent.runId,
      runsRoot: parentDependencies.runsRoot,
      mode: "REPLAY",
      provider: {
        async run() {
          providerCalls += 1;
          throw new Error("must not run");
        },
      },
      signal: new AbortController().signal,
      clock: parentDependencies.clock,
      secrets: [],
    }),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    message: "Regeneration requires a fresh run ID.",
  });
  expect(providerCalls).toBe(0);
});

it("allows only one child reservation for the parent", async () => {
  const parentDependencies = await makeWorkflowDependencies();
  const parent = await runAgentWorkflow(parentDependencies);
  const input = {
    parentRunId: parent.runId,
    runsRoot: parentDependencies.runsRoot,
    mode: "REPLAY" as const,
    provider: new FakeAgentProvider(),
    signal: new AbortController().signal,
    clock: parentDependencies.clock,
    secrets: [],
  };

  await regeneratePackage({ ...input, runId: "run-child-one" });
  await expect(regeneratePackage({ ...input, runId: "run-child-two" })).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    message: "The parent run cannot be regenerated.",
  });
});

it("allows only one concurrent child reservation for the parent", async () => {
  const parentDependencies = await makeWorkflowDependencies();
  const parent = await runAgentWorkflow(parentDependencies);
  const input = {
    parentRunId: parent.runId,
    runsRoot: parentDependencies.runsRoot,
    mode: "REPLAY" as const,
    provider: new FakeAgentProvider(),
    signal: new AbortController().signal,
    clock: parentDependencies.clock,
    secrets: [],
  };

  const outcomes = await Promise.allSettled([
    regeneratePackage({ ...input, runId: "concurrent-child-one" }),
    regeneratePackage({ ...input, runId: "concurrent-child-two" }),
  ]);

  expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
  const rejected = outcomes.find(
    (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
  );
  expect(rejected?.reason).toMatchObject({
    code: "INVALID_REQUEST",
    message: "The parent run cannot be regenerated.",
  });
});

it("rejects mode mismatch before provider execution", async () => {
  const parentDependencies = await makeWorkflowDependencies();
  const parent = await runAgentWorkflow(parentDependencies);
  let providerCalls = 0;

  await expect(
    regeneratePackage({
      parentRunId: parent.runId,
      runId: "run-live-child",
      runsRoot: parentDependencies.runsRoot,
      mode: "LIVE",
      provider: {
        async run() {
          providerCalls += 1;
          throw new Error("must not run");
        },
      },
      signal: new AbortController().signal,
      clock: parentDependencies.clock,
      secrets: [],
    }),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    message: "The parent run cannot be regenerated.",
  });
  expect(providerCalls).toBe(0);
});

it.each(["GENERATION_FAILED", "VALIDATION_FAILED"] as const)(
  "regenerates an eligible %s parent from its integrity-gated private context",
  async (parentStatus) => {
    const parentDependencies = await makeWorkflowDependencies({
      provider:
        parentStatus === "GENERATION_FAILED"
          ? providerThatFailsAfterAnalysis()
          : providerThatRejectsTwoDrafts(),
    });
    const parent = await runAgentWorkflow(parentDependencies);
    expect(parent.status).toBe(parentStatus);

    const child = await regeneratePackage({
      parentRunId: parent.runId,
      runId: `child-${parentStatus.toLocaleLowerCase("en-US")}`,
      runsRoot: parentDependencies.runsRoot,
      mode: "REPLAY",
      provider: new FakeAgentProvider(),
      signal: new AbortController().signal,
      clock: parentDependencies.clock,
      secrets: [],
    });

    expect(child).toMatchObject({
      status: "COMPLETED",
      parentRunId: parent.runId,
      contextHash: parent.contextHash,
      mode: parent.mode,
      datahub: parent.datahub,
    });
  },
);

it("rejects an ineligible parent status before provider execution", async () => {
  const parentDependencies = await makeWorkflowDependencies({
    provider: {
      async run() {
        return {
          status: "failed",
          provider: "fixture",
          model: "ineligible-parent",
          reasoningEffort: "none",
          analysisCalls: 0,
          generationAttempts: 0,
          message: "Analysis was never started.",
        };
      },
    },
  });
  const parent = await runAgentWorkflow(parentDependencies);
  expect(parent.status).toBe("ANALYSIS_FAILED");
  let providerCalls = 0;

  await expect(
    regeneratePackage({
      parentRunId: parent.runId,
      runId: "ineligible-child",
      runsRoot: parentDependencies.runsRoot,
      mode: "REPLAY",
      provider: {
        async run() {
          providerCalls += 1;
          throw new Error("must not run");
        },
      },
      signal: new AbortController().signal,
      clock: parentDependencies.clock,
      secrets: [],
    }),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    message: "The parent run cannot be regenerated.",
  });
  expect(providerCalls).toBe(0);
});

it("rejects a tampered parent envelope before provider execution", async () => {
  const parentDependencies = await makeWorkflowDependencies();
  const parent = await runAgentWorkflow(parentDependencies);
  const envelopePath = join(parentDependencies.runsRoot, `run-${parent.runId}.json`);
  const raw = await readFile(envelopePath, "utf8");
  await writeFile(envelopePath, raw.replace(parent.contextHash!, "0".repeat(64)), "utf8");
  let providerCalls = 0;

  await expect(
    regeneratePackage({
      parentRunId: parent.runId,
      runId: "tampered-child",
      runsRoot: parentDependencies.runsRoot,
      mode: "REPLAY",
      provider: {
        async run() {
          providerCalls += 1;
          throw new Error("must not run");
        },
      },
      signal: new AbortController().signal,
      clock: parentDependencies.clock,
      secrets: [],
    }),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    message: "The parent run cannot be regenerated.",
  });
  expect(providerCalls).toBe(0);
});

it("rejects regeneration of a child so the lineage remains exactly one level", async () => {
  const parentDependencies = await makeWorkflowDependencies();
  const parent = await runAgentWorkflow(parentDependencies);
  const child = await regeneratePackage({
    parentRunId: parent.runId,
    runId: "first-child",
    runsRoot: parentDependencies.runsRoot,
    mode: "REPLAY",
    provider: new FakeAgentProvider(),
    signal: new AbortController().signal,
    clock: parentDependencies.clock,
    secrets: [],
  });

  await expect(
    regeneratePackage({
      parentRunId: child.runId,
      runId: "grandchild",
      runsRoot: parentDependencies.runsRoot,
      mode: "REPLAY",
      provider: new FakeAgentProvider(),
      signal: new AbortController().signal,
      clock: parentDependencies.clock,
      secrets: [],
    }),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    message: "The parent run cannot be regenerated.",
  });
});

it("sanitizes provider output independently for the fresh child run", async () => {
  const secret = "child-provider-secret";
  const parentDependencies = await makeWorkflowDependencies();
  const parent = await runAgentWorkflow(parentDependencies);

  const child = await regeneratePackage({
    parentRunId: parent.runId,
    runId: "sanitized-child",
    runsRoot: parentDependencies.runsRoot,
    mode: "REPLAY",
    provider: {
      async run({ tools, request, signal }) {
        await tools.analyzeRenameChange({ request }, signal);
        return {
          status: "failed",
          provider: "fixture",
          model: `model-${secret}`,
          reasoningEffort: "none",
          analysisCalls: 1,
          generationAttempts: 0,
          message: `generation failed ${secret}`,
        };
      },
    },
    signal: new AbortController().signal,
    clock: parentDependencies.clock,
    secrets: [secret],
  });

  expect(child.status).toBe("GENERATION_FAILED");
  expect(JSON.stringify(child)).not.toContain(secret);
  expect(JSON.stringify(child)).toContain("[REDACTED]");
});

function providerThatFailsAfterAnalysis(): AgentProvider {
  return {
    async run({ tools, request, signal }) {
      await tools.analyzeRenameChange({ request }, signal);
      return {
        status: "failed",
        provider: "fixture",
        model: "generation-failure-parent",
        reasoningEffort: "none",
        analysisCalls: 1,
        generationAttempts: 0,
        message: "Generation intentionally failed.",
      };
    },
  };
}

function providerThatRejectsTwoDrafts(): AgentProvider {
  return {
    async run({ tools, request, signal }) {
      const analysis = await tools.analyzeRenameChange({ request }, signal);
      if (analysis.kind !== "ready") throw new Error("Expected ready analysis.");
      const valid = createGoldenDraft(analysis.context);
      const invalid = {
        ...valid,
        strategy: "DIRECT_RENAME" as const,
        executionClassification: "EXECUTABLE_WITH_REVIEW" as const,
        rationale: "LOW_RISK_CONFIRMED_RENAME" as const,
        stages: ["DIRECT_RENAME" as const],
        rollback: "RENAME_TARGET_BACK_TO_SOURCE" as const,
        warnings: [],
      };
      await tools.generateMigrationPackage(invalid, signal);
      await tools.generateMigrationPackage(invalid, signal);
      return {
        status: "failed",
        provider: "fixture",
        model: "validation-failure-parent",
        reasoningEffort: "none",
        analysisCalls: 1,
        generationAttempts: 2,
        message: "Validation intentionally failed.",
      };
    },
  };
}
