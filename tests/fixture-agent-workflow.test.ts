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
});
