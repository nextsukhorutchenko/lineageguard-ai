import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runImpactAnalysis } from "../src/app/run-impact-analysis.js";
import { readImpactReport } from "../src/artifacts/write-run-artifacts.js";
import { FixtureCatalog } from "../src/demo/fixture-catalog.js";

const REQUEST =
  "Rename column customer_id to customer_key in dataset snowflake:b2fd91.order_entry_db.analytics.order_details";
const RUN_ID = "20260722T120000Z-0123abcd";
const DATASET_URN =
  "urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details,PROD)";

const temporaryRoots: string[] = [];

async function runFixturePipeline() {
  const runsRoot = await mkdtemp(join(tmpdir(), "lineageguard-fixture-e2e-"));
  temporaryRoots.push(runsRoot);
  const run = await runImpactAnalysis({
    request: REQUEST,
    catalog: new FixtureCatalog(),
    clock: () => new Date("2026-07-22T12:00:00.000Z"),
    runId: RUN_ID,
    runsRoot,
    signal: new AbortController().signal,
    secrets: [],
  });
  return {
    run,
    markdown: await readImpactReport({ runsRoot, runId: run.runId }),
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("fixture-backed impact analysis", () => {
  it("repeats the grounded 24/11/90 result and matches the committed example", async () => {
    const first = await runFixturePipeline();
    const second = await runFixturePipeline();
    const expectedSearchCandidates = await new FixtureCatalog().searchDatasets(
      "snowflake:b2fd91.order_entry_db.analytics.order_details",
    );

    expect(first.run.evidence.targetDataset).toMatchObject({
      urn: DATASET_URN,
      platform: "snowflake",
      environment: "PROD",
    });
    expect(first.run.evidence.downstreamAssets).toHaveLength(24);
    expect(first.run.evidence.columnAffectedAssets).toHaveLength(11);
    expect(first.run.evidence.searchCandidateUrns).toEqual(
      expectedSearchCandidates.items
        .map(({ urn }) => urn)
        .sort((left, right) => left.localeCompare(right, "en-US")),
    );
    expect(first.run.evidence.unmatchedColumnAssets).toEqual([]);
    expect(first.run.evidence.metadataGaps).toContain(
      "Column-level lineage is unavailable for 13 of 24 table-level downstream assets.",
    );
    expect(first.run.assessment).toMatchObject({
      score: 90,
      level: "critical",
      confidence: "medium",
    });
    expect(second.run).toMatchObject({
      evidence: first.run.evidence,
      assessment: first.run.assessment,
      status: first.run.status,
    });
    expect(second.markdown).toBe(first.markdown);
    expect(first.run.evidence.entityContext).toHaveLength(25);
    expect(first.run.evidence.entityContextRetrieval).toEqual({
      complete: true,
      pages: 3,
      itemCount: 25,
      offsets: [0, 10, 20],
      reasonCodes: [],
    });
  });
});
