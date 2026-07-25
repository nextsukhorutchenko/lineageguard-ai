import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeAgentProvider } from "../../src/agent/fake-agent-provider.js";
import type { RunAgentWorkflowDependencies } from "../../src/app/run-agent-workflow.js";
import { FixtureCatalog } from "../../src/demo/fixture-catalog.js";

export const GOLDEN_REQUEST =
  "Rename column customer_id to customer_key in dataset snowflake:b2fd91.order_entry_db.analytics.order_details";

const workflowRoots: string[] = [];

export async function makeWorkflowDependencies(
  overrides: Partial<RunAgentWorkflowDependencies> = {},
): Promise<RunAgentWorkflowDependencies> {
  const runsRoot = await mkdtemp(join(tmpdir(), "lineageguard-workflow-test-"));
  workflowRoots.push(runsRoot);
  return {
    request: GOLDEN_REQUEST,
    mode: "REPLAY",
    provider: new FakeAgentProvider(),
    createCatalog: async (scope, recordDeadlineEvent) => {
      void scope;
      void recordDeadlineEvent;
      return new FixtureCatalog();
    },
    runsRoot,
    runId: "run-test",
    clock: () => new Date("2026-07-22T12:00:00.000Z"),
    signal: new AbortController().signal,
    secrets: [],
    ...overrides,
  };
}

export async function cleanupWorkflowRoots(): Promise<void> {
  await Promise.all(
    workflowRoots.splice(0).map((root) =>
      rm(root, {
        recursive: true,
        force: true,
      }),
    ),
  );
}
