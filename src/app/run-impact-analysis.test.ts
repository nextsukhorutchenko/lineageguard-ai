import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import type { DataHubCatalog } from "../datahub/catalog.js";
import type { LineageAsset, SchemaField, ToolTraceEntry } from "../domain/evidence.js";
import type { DatasetCandidate } from "../domain/resolve-dataset.js";
import { AppError } from "../errors/app-error.js";
import * as impactAnalysisModule from "./run-impact-analysis.js";
import { runImpactAnalysis } from "./run-impact-analysis.js";

const RUN_ID = "20260722T120000Z-0123abcd";
const REQUEST = "Rename column customer_id to customer_key in dataset snowflake:orders";
const TARGET: DatasetCandidate = {
  urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,orders,PROD)",
  name: "orders",
  platform: "snowflake",
};
const DOWNSTREAM: LineageAsset = {
  urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,customer_orders,PROD)",
  name: "customer_orders",
  platform: "snowflake",
  hop: 1,
  lineageColumns: [],
};
const COLUMN_DOWNSTREAM: LineageAsset = {
  ...DOWNSTREAM,
  lineageColumns: ["customer_id"],
};
const FIELDS: readonly SchemaField[] = [
  { fieldPath: "order_id", nativeDataType: "NUMBER" },
  { fieldPath: "customer_id", nativeDataType: "NUMBER", nullable: false },
];

interface FakeCatalogOptions {
  readonly candidates?: readonly DatasetCandidate[];
  readonly fields?: readonly SchemaField[];
  readonly tableLineage?: readonly LineageAsset[];
  readonly columnLineage?: readonly LineageAsset[];
  readonly failSearch?: boolean;
}

class FakeCatalog implements DataHubCatalog {
  readonly operations: string[] = [];
  readonly #options: FakeCatalogOptions;
  readonly #trace: ToolTraceEntry[] = [];
  closeCount = 0;

  constructor(options: FakeCatalogOptions = {}) {
    this.#options = options;
  }

  async searchDatasets(): Promise<readonly DatasetCandidate[]> {
    this.operations.push("searchDatasets");
    if (this.#options.failSearch) throw new AppError("DATAHUB_UNAVAILABLE", "Unavailable.");
    this.#trace.push({
      callId: "mcp-001",
      tool: "search",
      arguments: { query: "/q orders", num_results: 50, offset: 0 },
      status: "ok",
    });
    return this.#options.candidates ?? [TARGET];
  }

  async listSchemaFields(): Promise<readonly SchemaField[]> {
    this.operations.push("listSchemaFields");
    this.#trace.push({
      callId: "mcp-002",
      tool: "list_schema_fields",
      arguments: { urn: TARGET.urn, limit: 100, offset: 0 },
      status: "ok",
    });
    return this.#options.fields ?? FIELDS;
  }

  async getDownstreamLineage(
    _datasetUrn: string,
    options: { readonly column?: string; readonly maxHops: 2 },
  ): Promise<readonly LineageAsset[]> {
    const mode = options.column ?? "table";
    this.operations.push(`getDownstreamLineage:${mode}`);
    this.#trace.push({
      callId: `mcp-${String(this.#trace.length + 1).padStart(3, "0")}`,
      tool: "get_lineage",
      arguments: {
        urn: TARGET.urn,
        column: options.column ?? null,
        max_hops: options.maxHops,
        max_results: 100,
        offset: 0,
      },
      status: "ok",
    });
    return options.column
      ? (this.#options.columnLineage ?? [COLUMN_DOWNSTREAM])
      : (this.#options.tableLineage ?? [DOWNSTREAM]);
  }

  getTrace(): readonly ToolTraceEntry[] {
    return this.#trace;
  }

  async close(): Promise<void> {
    this.operations.push("close");
    this.closeCount += 1;
  }
}

const temporaryRoots: string[] = [];

async function createRunsRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lineageguard-task-7-"));
  temporaryRoots.push(root);
  return root;
}

async function runWith(catalog: FakeCatalog, runsRoot: string) {
  return runImpactAnalysis({
    request: REQUEST,
    catalog,
    clock: () => new Date("2026-07-22T12:00:00.000Z"),
    runId: RUN_ID,
    runsRoot,
  });
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("runImpactAnalysis", () => {
  it("completes grounded column impact in the required catalog call order", async () => {
    const catalog = new FakeCatalog();
    const runsRoot = await createRunsRoot();

    const run = await runWith(catalog, runsRoot);

    expectTypeOf(run.artifactPath).toEqualTypeOf<string>();
    expect(run).toMatchObject({
      runId: RUN_ID,
      createdAt: "2026-07-22T12:00:00.000Z",
      request: REQUEST,
      status: "COMPLETED",
      artifactPath: join(runsRoot, RUN_ID, "impact-report.md"),
      evidence: {
        evidenceLevel: "column",
        downstreamAssets: [DOWNSTREAM],
        columnAffectedAssets: [COLUMN_DOWNSTREAM],
      },
      assessment: { confidence: "high" },
    });
    expect(catalog.operations).toEqual([
      "searchDatasets",
      "listSchemaFields",
      "getDownstreamLineage:table",
      "getDownstreamLineage:customer_id",
      "close",
    ]);
    expect(catalog.closeCount).toBe(1);
    expect(run.artifactPath).toBeDefined();
    await expect(readFile(run.artifactPath!, "utf8")).resolves.toContain(
      "# LineageGuard AI Impact Report",
    );

    const evidenceUrns = new Set([
      run.evidence.targetDataset.urn,
      ...run.evidence.downstreamAssets.map(({ urn }) => urn),
      ...run.evidence.columnAffectedAssets.map(({ urn }) => urn),
    ]);
    const factUrns = run.facts.flatMap((fact) => fact.match(/urn:li:dataset:\([^\s]+\)/g) ?? []);
    expect(factUrns.length).toBeGreaterThan(0);
    expect(factUrns.every((urn) => evidenceUrns.has(urn))).toBe(true);
  });

  it("reports table-only lineage with explicit limitations", async () => {
    const catalog = new FakeCatalog({ columnLineage: [] });
    const run = await runWith(catalog, await createRunsRoot());

    expect(run.status).toBe("COMPLETED_WITH_LIMITATIONS");
    expect(run.assessment.confidence).toBe("low");
    expect(run.unknowns).toContain(
      "Column-level impact is unknown; only table-level downstream lineage was returned.",
    );
  });

  it("writes a metadata-limited report when no downstream lineage is returned", async () => {
    const catalog = new FakeCatalog({ tableLineage: [], columnLineage: [] });
    const run = await runWith(catalog, await createRunsRoot());

    expect(run.status).toBe("INSUFFICIENT_METADATA");
    expect(run.evidence.evidenceLevel).toBe("none");
    expect(run.unknowns).toContain(
      "No downstream impact is proven because DataHub returned no downstream lineage.",
    );
    expect(run.artifactPath).toBeDefined();
    await expect(stat(run.artifactPath!)).resolves.toMatchObject({ size: expect.any(Number) });
    const report = await readFile(run.artifactPath!, "utf8");
    expect(report).toContain("INSUFFICIENT_METADATA");
    expect(report).toContain(
      "No downstream impact is proven because DataHub returned no downstream lineage.",
    );
    expect(report).not.toMatch(/\bsafe\b/i);
  });

  it("derives pagination and optional metadata unknowns from normalized evidence", async () => {
    const tableLineage = Array.from({ length: 100 }, (_, index): LineageAsset => ({
      urn: `urn:li:dataset:(urn:li:dataPlatform:snowflake,asset_${String(index).padStart(3, "0")},PROD)`,
      hop: 1,
      lineageColumns: [],
    }));
    const catalog = new FakeCatalog({
      candidates: [{ urn: TARGET.urn, name: "snowflake:orders" }],
      tableLineage,
      columnLineage: tableLineage.map((asset) => ({
        ...asset,
        lineageColumns: ["customer_id"],
      })),
    });

    const run = await runWith(catalog, await createRunsRoot());

    expect(run.unknowns).toEqual([
      "Downstream lineage may be truncated at the MCP result limit.",
      "Selected dataset platform metadata was not available.",
      "Selected dataset environment metadata was not available.",
    ]);
  });

  it("does not produce an impact result or artifact for ambiguous candidates", async () => {
    const catalog = new FakeCatalog({
      candidates: [TARGET, { ...TARGET, urn: `${TARGET.urn}-duplicate` }],
    });
    const runsRoot = await createRunsRoot();

    await expect(runWith(catalog, runsRoot)).rejects.toMatchObject({
      code: "NEEDS_USER_CLARIFICATION",
    });
    await expect(stat(join(runsRoot, RUN_ID, "impact-report.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(catalog.operations).toEqual(["searchDatasets", "close"]);
    expect(catalog.closeCount).toBe(1);
  });

  it("stops before lineage calls when the source column is missing", async () => {
    const catalog = new FakeCatalog({ fields: [{ fieldPath: "order_id" }] });

    await expect(runWith(catalog, await createRunsRoot())).rejects.toMatchObject({
      code: "COLUMN_NOT_FOUND",
    });
    expect(catalog.operations).toEqual(["searchDatasets", "listSchemaFields", "close"]);
  });

  it("closes the catalog exactly once when a catalog operation fails", async () => {
    const catalog = new FakeCatalog({ failSearch: true });

    await expect(runWith(catalog, await createRunsRoot())).rejects.toMatchObject({
      code: "DATAHUB_UNAVAILABLE",
    });
    expect(catalog.operations).toEqual(["searchDatasets", "close"]);
    expect(catalog.closeCount).toBe(1);
  });

  it("does not expose the pre-write report builder as public application API", () => {
    expect(impactAnalysisModule).not.toHaveProperty("buildAnalysisRun");
  });
});
