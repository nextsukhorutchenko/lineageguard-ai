import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { OpenAIAgentProvider } from "../../src/agent/openai-agent-provider.js";
import { runAgentWorkflow } from "../../src/app/run-agent-workflow.js";
import { loadRuntimeConfig } from "../../src/config/runtime-config.js";
import { createDataHubCatalog } from "../../src/datahub/create-catalog.js";
import { loadRunSnapshot } from "../../src/runs/run-store.js";

const enabled = process.env.RUN_LIVE_OPENAI_TEST === "1";
const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true })));
});

(enabled ? it : it.skip)(
  "uses live DataHub and OpenAI without executing or mutating",
  async () => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey === undefined)
      throw new Error("OPENAI_API_KEY is required for the live smoke test.");
    const runsRoot = await mkdtemp(join(tmpdir(), "lineageguard-openai-live-"));
    roots.push(runsRoot);
    const config = loadRuntimeConfig({
      ...process.env,
      LINEAGEGUARD_RUNS_DIR: runsRoot,
    });
    const result = await runAgentWorkflow({
      request:
        "Rename column customer_id to customer_key in dataset snowflake:b2fd91.order_entry_db.analytics.order_details",
      mode: "LIVE",
      provider: new OpenAIAgentProvider({
        apiKey,
        ...(process.env.OPENAI_MODEL === undefined ? {} : { model: process.env.OPENAI_MODEL }),
      }),
      createCatalog: (scope, recordDeadlineEvent) =>
        createDataHubCatalog(config, scope, recordDeadlineEvent),
      runsRoot,
      runId: "live-openai-smoke",
      clock: () => new Date(),
      signal: new AbortController().signal,
      secrets: [apiKey, config.datahubGmsToken],
    });
    expect(result).toMatchObject({
      mode: "LIVE",
      status: "COMPLETED",
      impact: { score: 90, downstreamAssets: 24, columnAffectedAssets: 11 },
    });
    expect(result.artifacts).toHaveLength(4);
    const snapshot = await loadRunSnapshot({
      runsRoot,
      runId: result.runId,
    });
    expect(JSON.stringify(snapshot)).not.toContain(apiKey);
    expect(JSON.stringify(snapshot)).not.toContain(config.datahubGmsToken);
  },
  120_000,
);
