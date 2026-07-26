import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const loadModule = createRequire(import.meta.url);
const { FakeAgentProvider } = loadModule(
  "../src/agent/fake-agent-provider.ts",
) as typeof import("../src/agent/fake-agent-provider.js");
const { runAgentWorkflow } = loadModule(
  "../src/app/run-agent-workflow.ts",
) as typeof import("../src/app/run-agent-workflow.js");
const { FixtureCatalog } = loadModule(
  "../src/demo/fixture-catalog.ts",
) as typeof import("../src/demo/fixture-catalog.js");
const { virtualArtifactFilenames } = loadModule(
  "../src/runs/run-envelope.ts",
) as typeof import("../src/runs/run-envelope.js");
const { readCompletedPackageFile } = loadModule(
  "../src/runs/run-store.ts",
) as typeof import("../src/runs/run-store.js");

const filenames = virtualArtifactFilenames;
const runsRoot = await mkdtemp(join(tmpdir(), "lineageguard-example-"));
const runId = "nextjs-openai-agent-demo";
const destination = resolve("examples", "002-nextjs-openai-agent-demo");

try {
  const snapshot = await runAgentWorkflow({
    request:
      "Rename column customer_id to customer_key in dataset snowflake:b2fd91.order_entry_db.analytics.order_details",
    mode: "REPLAY",
    provider: new FakeAgentProvider(),
    createCatalog: async () => new FixtureCatalog(),
    runsRoot,
    runId,
    clock: () => new Date("2026-07-22T12:00:00.000Z"),
    signal: new AbortController().signal,
    secrets: [],
  });
  if (snapshot.status !== "COMPLETED") throw new Error("Replay example did not complete.");
  await mkdir(destination, { recursive: true });
  await Promise.all(
    filenames.map(async (filename) => {
      const content = await readCompletedPackageFile({ runsRoot, runId, filename });
      await writeFile(join(destination, filename), content, "utf8");
    }),
  );
} finally {
  await rm(runsRoot, { recursive: true, force: true });
}
