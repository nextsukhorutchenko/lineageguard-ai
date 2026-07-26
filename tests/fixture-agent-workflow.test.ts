import { afterEach, expect, it } from "vitest";
import { cleanupWorkflowRoots, makeWorkflowDependencies } from "./helpers/workflow-dependencies.js";
import { runAgentWorkflow } from "../src/app/run-agent-workflow.js";

afterEach(cleanupWorkflowRoots);

it("produces the complete deterministic replay workflow", async () => {
  const result = await runAgentWorkflow(await makeWorkflowDependencies());

  expect(result).toMatchObject({
    mode: "REPLAY",
    status: "COMPLETED",
    impact: {
      downstreamAssets: 24,
      columnAffectedAssets: 11,
      score: 90,
      advisoryDecision: "BLOCK_DIRECT_RENAME",
    },
    executionClassification: "NON_EXECUTABLE_TEMPLATE",
    datahub: {
      source: "fixture",
      verification: "REPLAY_FIXTURE",
    },
  });
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
});
