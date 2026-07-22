import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runImpactAnalysis } from "../src/app/run-impact-analysis.js";
import type { DataHubCatalog } from "../src/datahub/catalog.js";
import type { LineageAsset, SchemaField, ToolTraceEntry } from "../src/domain/evidence.js";
import type { DatasetCandidate } from "../src/domain/resolve-dataset.js";

const REQUEST =
  "Rename column customer_id to customer_key in dataset snowflake:b2fd91.order_entry_db.analytics.order_details";
const RUN_ID = "20260722T120000Z-0123abcd";
const DATASET_URN =
  "urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details,PROD)";

async function readFixture<T>(name: string): Promise<T> {
  return JSON.parse(
    await readFile(new URL(`./fixtures/datahub/${name}`, import.meta.url), "utf8"),
  ) as T;
}

class FixtureCatalog implements DataHubCatalog {
  readonly #trace: ToolTraceEntry[] = [];

  async searchDatasets(): Promise<readonly DatasetCandidate[]> {
    this.#trace.push({
      callId: "mcp-001",
      tool: "search",
      arguments: {
        query: "/q snowflake+b2fd91+order_entry_db+analytics+order_details",
        filter: "entity_type = dataset",
        num_results: 50,
        offset: 0,
      },
      status: "ok",
    });
    return readFixture<readonly DatasetCandidate[]>("search-order-details.json");
  }

  async listSchemaFields(): Promise<readonly SchemaField[]> {
    this.#trace.push({
      callId: "mcp-002",
      tool: "list_schema_fields",
      arguments: { urn: DATASET_URN, limit: 100, offset: 0 },
      status: "ok",
    });
    return readFixture<readonly SchemaField[]>("schema-order-details.json");
  }

  async getDownstreamLineage(
    _datasetUrn: string,
    options: { readonly column?: string; readonly maxHops: 2 },
  ): Promise<readonly LineageAsset[]> {
    this.#trace.push({
      callId: `mcp-${String(this.#trace.length + 1).padStart(3, "0")}`,
      tool: "get_lineage",
      arguments: {
        urn: DATASET_URN,
        column: options.column ?? null,
        upstream: false,
        max_hops: options.maxHops,
        max_results: 100,
        offset: 0,
      },
      status: "ok",
    });
    return readFixture<readonly LineageAsset[]>(
      options.column
        ? "lineage-order-details-customer-id.json"
        : "lineage-order-details-table.json",
    );
  }

  getTrace(): readonly ToolTraceEntry[] {
    return this.#trace;
  }

  async close(): Promise<void> {}
}

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
  return { run, markdown: await readFile(run.artifactPath, "utf8") };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("fixture-backed impact analysis", () => {
  it("repeats the grounded 24/11/90 result and matches the committed example", async () => {
    const first = await runFixturePipeline();
    const second = await runFixturePipeline();
    const committedExample = await readFile(
      new URL("../examples/001-customer-id-rename/impact-report.md", import.meta.url),
      "utf8",
    );

    expect(first.run.evidence.targetDataset).toMatchObject({
      urn: DATASET_URN,
      platform: "snowflake",
      environment: "PROD",
    });
    expect(first.run.evidence.downstreamAssets).toHaveLength(24);
    expect(first.run.evidence.columnAffectedAssets).toHaveLength(11);
    expect(first.run.evidence.searchCandidateUrns).toEqual(
      (await readFixture<readonly DatasetCandidate[]>("search-order-details.json"))
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
    expect(first.markdown).toBe(committedExample);
  });
});
