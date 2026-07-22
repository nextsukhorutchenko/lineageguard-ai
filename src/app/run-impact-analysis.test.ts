import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
const UNMATCHED_COLUMN_DOWNSTREAM: LineageAsset = {
  urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,unmatched_customer_rollup,PROD)",
  name: "unmatched_customer_rollup",
  platform: "dbt",
  hop: 2,
  lineageColumns: ["customer_id", "customer_key"],
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
  readonly searchError?: Error;
  readonly closeError?: Error;
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
    if (this.#options.searchError) throw this.#options.searchError;
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
    if (this.#options.closeError) throw this.#options.closeError;
  }
}

const temporaryRoots: string[] = [];

async function createRunsRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lineageguard-task-7-"));
  temporaryRoots.push(root);
  return root;
}

async function runWith(
  catalog: FakeCatalog,
  runsRoot: string,
  signal: AbortSignal = new AbortController().signal,
  secrets: readonly string[] = [],
) {
  return runImpactAnalysis({
    request: REQUEST,
    catalog,
    clock: () => new Date("2026-07-22T12:00:00.000Z"),
    runId: RUN_ID,
    runsRoot,
    signal,
    secrets,
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
    expect(run.evidence.targetDataset).toMatchObject({
      platform: "snowflake",
      environment: "PROD",
    });
    expect(run.facts).toContain("Selected dataset environment is PROD.");
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

  it("preserves search candidates and unmatched column-lineage relationships", async () => {
    const otherCandidate = {
      urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,other_orders,PROD)",
      name: "other_orders",
    };
    const catalog = new FakeCatalog({
      candidates: [otherCandidate, TARGET],
      columnLineage: [COLUMN_DOWNSTREAM, UNMATCHED_COLUMN_DOWNSTREAM],
    });

    const run = await runWith(catalog, await createRunsRoot());
    const report = await readFile(run.artifactPath, "utf8");

    expect(run.evidence.searchCandidateUrns).toEqual([otherCandidate.urn, TARGET.urn].sort());
    expect(run.evidence.unmatchedColumnAssets).toEqual([UNMATCHED_COLUMN_DOWNSTREAM]);
    expect(run.facts).toContain(`DataHub search returned candidate ${otherCandidate.urn}.`);
    expect(run.unknowns).toContain(
      `Column-lineage asset ${UNMATCHED_COLUMN_DOWNSTREAM.urn} was absent from table-level lineage and was not counted as confirmed; returned lineage columns: customer_id, customer_key.`,
    );
    expect(report).toContain(UNMATCHED_COLUMN_DOWNSTREAM.urn.replaceAll("_", "\\_"));
  });

  it("preserves an unnamed exact-URN target in normalized evidence and the report", async () => {
    const unnamedTarget: DatasetCandidate = { urn: TARGET.urn, name: TARGET.urn };
    const catalog = new FakeCatalog({ candidates: [unnamedTarget] });
    const runsRoot = await createRunsRoot();

    const run = await runImpactAnalysis({
      request: `Rename column customer_id to customer_key in dataset ${unnamedTarget.urn}`,
      catalog,
      clock: () => new Date("2026-07-22T12:00:00.000Z"),
      runId: RUN_ID,
      runsRoot,
      signal: new AbortController().signal,
      secrets: [],
    });
    const report = await readFile(run.artifactPath, "utf8");

    expect(run.evidence.targetDataset).toEqual({
      ...unnamedTarget,
      platform: "snowflake",
      environment: "PROD",
    });
    expect(run.evidence.searchCandidateUrns).toEqual([unnamedTarget.urn]);
    expect(run.facts).toContain(`DataHub search returned candidate ${unnamedTarget.urn}.`);
    expect(report).toContain("DataHub search returned candidate");
  });

  it("redacts a known secret from persisted Markdown without mutating analysis identities", async () => {
    const secret = "known-artifact-secret";
    const target: DatasetCandidate = {
      urn: `urn:li:dataset:(urn:li:dataPlatform:snowflake,orders-${secret},PROD)`,
      name: `orders-${secret}`,
      platform: "snowflake",
    };
    const downstream: LineageAsset = {
      urn: `urn:li:dataset:(urn:li:dataPlatform:dbt,customer-${secret},PROD)`,
      name: `customer-${secret}`,
      platform: "dbt",
      hop: 1,
      lineageColumns: [],
    };
    const request = `Rename column customer_id to customer_key in dataset snowflake:orders-${secret}`;
    const catalog = new FakeCatalog({
      candidates: [target],
      tableLineage: [downstream],
      columnLineage: [{ ...downstream, lineageColumns: ["customer_id", secret] }],
    });
    const runsRoot = await createRunsRoot();

    const run = await runImpactAnalysis({
      request,
      catalog,
      clock: () => new Date("2026-07-22T12:00:00.000Z"),
      runId: RUN_ID,
      runsRoot,
      signal: new AbortController().signal,
      secrets: [secret],
    });
    const report = await readFile(run.artifactPath, "utf8");

    expect(run.request).toContain(secret);
    expect(run.evidence.targetDataset.urn).toContain(secret);
    expect(run.evidence.downstreamAssets[0]?.urn).toContain(secret);
    expect(report).not.toContain(secret);
    expect(report).toContain("\\[REDACTED\\]");
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

    expect(run.unknowns).toEqual(["Downstream lineage may be truncated at the MCP result limit."]);
  });

  it("reports platform and environment gaps only when canonical metadata is absent", async () => {
    const catalog = new FakeCatalog({
      candidates: [{ urn: "urn:li:dataset:opaque", name: "snowflake:orders" }],
    });

    const run = await runWith(catalog, await createRunsRoot());

    expect(run.evidence.metadataGaps).toEqual([
      "Selected dataset platform metadata was not available.",
      "Selected dataset environment metadata was not available.",
    ]);
    expect(run.unknowns).toEqual([
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

  it("closes the owned catalog when request parsing fails", async () => {
    const catalog = new FakeCatalog();

    await expect(
      runImpactAnalysis({
        request: "Drop column customer_id from dataset snowflake:orders",
        catalog,
        clock: () => new Date("2026-07-22T12:00:00.000Z"),
        runId: RUN_ID,
        runsRoot: await createRunsRoot(),
        signal: new AbortController().signal,
        secrets: [],
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(catalog.operations).toEqual(["close"]);
    expect(catalog.closeCount).toBe(1);
  });

  it("preserves the primary analysis error and attaches a safe close failure", async () => {
    const primary = new AppError("DATAHUB_UNAVAILABLE", "Primary analysis failure.");
    const catalog = new FakeCatalog({
      searchError: primary,
      closeError: new Error("raw close failure with secret-token"),
    });

    const caught = await runWith(catalog, await createRunsRoot()).catch((error: unknown) => error);

    expect(caught).toBe(primary);
    expect(caught).toMatchObject({
      suppressedFailures: [
        {
          code: "MCP_UNAVAILABLE",
          message: "The DataHub catalog could not be closed after analysis failed.",
        },
      ],
    });
    expect(JSON.stringify(caught)).not.toContain("raw close failure");
    expect(JSON.stringify(caught)).not.toContain("secret-token");
    expect(catalog.closeCount).toBe(1);
  });

  it("never replaces a primary error when suppressed metadata cannot be attached", async () => {
    const primary = new Error("Primary generic failure.");
    Object.defineProperty(primary, "suppressedFailures", {
      configurable: false,
      value: Object.freeze([]),
    });
    const catalog = new FakeCatalog({
      searchError: primary,
      closeError: new Error("Close failure."),
    });

    await expect(runWith(catalog, await createRunsRoot())).rejects.toBe(primary);
    expect(catalog.closeCount).toBe(1);
  });

  it("surfaces a close failure when analysis otherwise succeeds", async () => {
    const closeFailure = new AppError("MCP_UNAVAILABLE", "Safe close failure.");
    const catalog = new FakeCatalog({ closeError: closeFailure });

    await expect(runWith(catalog, await createRunsRoot())).rejects.toBe(closeFailure);
    expect(catalog.closeCount).toBe(1);
  });

  it("preserves the safe in-memory report and attempted path after a real writer failure", async () => {
    const catalog = new FakeCatalog();
    const sandbox = await createRunsRoot();
    const blockedRoot = join(sandbox, "runs-file");
    await writeFile(blockedRoot, "not a directory", "utf8");

    const caught = await runWith(catalog, blockedRoot).catch((error: unknown) => error);

    expect(caught).toMatchObject({
      name: "ImpactReportPersistenceError",
      code: "ARTIFACT_WRITE_FAILED",
      attemptedPath: join(blockedRoot, RUN_ID, "impact-report.md"),
      details: { attemptedPath: join(blockedRoot, RUN_ID, "impact-report.md") },
      report: {
        runId: RUN_ID,
        request: REQUEST,
        status: "COMPLETED",
        evidence: {
          targetDataset: {
            urn: TARGET.urn,
            platform: "snowflake",
            environment: "PROD",
          },
        },
      },
    });
    expect(JSON.stringify(caught)).not.toContain("secret");
    expect(catalog.closeCount).toBe(1);
  });

  it("aborts after all MCP reads and before artifact persistence", async () => {
    const controller = new AbortController();
    const catalog = new FakeCatalog();
    const runsRoot = await createRunsRoot();

    const operation = runImpactAnalysis({
      request: REQUEST,
      catalog,
      clock: () => {
        controller.abort();
        return new Date("2026-07-22T12:00:00.000Z");
      },
      runId: RUN_ID,
      runsRoot,
      signal: controller.signal,
      secrets: [],
    });

    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(catalog.operations).toEqual([
      "searchDatasets",
      "listSchemaFields",
      "getDownstreamLineage:table",
      "getDownstreamLineage:customer_id",
      "close",
    ]);
    await expect(access(join(runsRoot, RUN_ID, "impact-report.md"))).rejects.toThrow();
  });

  it("does not expose the pre-write report builder as public application API", () => {
    expect(impactAnalysisModule).not.toHaveProperty("buildAnalysisRun");
  });
});
