import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { OpenAIAgentProvider } from "../../src/agent/openai-agent-provider.js";
import { runAgentWorkflow } from "../../src/app/run-agent-workflow.js";
import { loadRuntimeConfig } from "../../src/config/runtime-config.js";
import { createDataHubCatalog } from "../../src/datahub/create-catalog.js";
import { loadRunSnapshot } from "../../src/runs/run-store.js";
import { readPersistedRunEnvelopeBytes } from "../helpers/read-persisted-run-envelope.js";

const enabled = process.env.RUN_LIVE_OPENAI_TEST === "1";
const liveRunId = "live-openai-smoke";
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
      runId: liveRunId,
      clock: () => new Date(),
      signal: new AbortController().signal,
      secrets: [apiKey, config.datahubGmsToken],
    });
    expect(result).toMatchObject({
      mode: "LIVE",
      status: "COMPLETED",
      runId: liveRunId,
      impact: { score: 90, downstreamAssets: 24, columnAffectedAssets: 11 },
    });
    expect(result.artifacts).toHaveLength(4);
    const snapshot = await loadRunSnapshot({
      runsRoot,
      runId: result.runId,
    });
    const serializedPublicSnapshot = JSON.stringify(snapshot);
    expect(serializedPublicSnapshot.includes(apiKey)).toBe(false);
    expect(serializedPublicSnapshot.includes(config.datahubGmsToken)).toBe(false);

    const persistedEnvelopeBytes = await readPersistedRunEnvelopeBytes({
      runsRoot,
      runId: result.runId,
    });
    expect(persistedEnvelopeBytes.includes(Buffer.from(apiKey, "utf8"))).toBe(false);
    expect(persistedEnvelopeBytes.includes(Buffer.from(config.datahubGmsToken, "utf8"))).toBe(
      false,
    );
  },
  120_000,
);
