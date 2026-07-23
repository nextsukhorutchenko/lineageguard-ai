import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { CollectionResult, DataHubCatalog } from "../datahub/catalog.js";
import type {
  EntityContext,
  EntityContextIncompleteReasonCode,
  LineageAsset,
  RequiredIncompleteReasonCode,
  SchemaField,
  ToolTraceEntry,
} from "../domain/evidence.js";
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
  readonly searchReasons?: readonly RequiredIncompleteReasonCode[];
  readonly searchPages?: number;
  readonly searchOffsets?: readonly number[];
  readonly schemaReasons?: readonly RequiredIncompleteReasonCode[];
  readonly tableReasons?: readonly RequiredIncompleteReasonCode[];
  readonly columnReasons?: readonly RequiredIncompleteReasonCode[];
  readonly entityContextReasons?: readonly EntityContextIncompleteReasonCode[];
  readonly entityContextError?: Error;
  readonly onEntityContext?: (signal: AbortSignal | undefined) => void;
  readonly onClose?: () => void | Promise<void>;
}

function collection<T, R extends string>(
  items: readonly T[],
  reasonCodes: readonly R[] = [],
): CollectionResult<T, R> {
  return {
    items,
    completeness: {
      complete: reasonCodes.length === 0,
      pages: 1,
      itemCount: items.length,
      offsets: [0],
      reasonCodes,
    },
  };
}

class FakeCatalog implements DataHubCatalog {
  readonly operations: string[] = [];
  readonly #options: FakeCatalogOptions;
  readonly #trace: ToolTraceEntry[] = [];
  closeCount = 0;

  constructor(options: FakeCatalogOptions = {}) {
    this.#options = options;
  }

  async searchDatasets(): Promise<CollectionResult<DatasetCandidate>> {
    this.operations.push("searchDatasets");
    if (this.#options.searchError) throw this.#options.searchError;
    if (this.#options.failSearch) throw new AppError("DATAHUB_UNAVAILABLE", "Unavailable.");
    const offsets = this.#options.searchOffsets ?? [0];
    for (const [index, offset] of offsets.entries()) {
      this.#trace.push({
        callId: `mcp-${String(this.#trace.length + 1).padStart(3, "0")}`,
        tool: "search",
        arguments: { query: "/q orders", num_results: 50, offset },
        status: "ok",
        at: "2026-07-22T12:00:00.000Z",
        page: index + 1,
      });
    }
    const result = collection(this.#options.candidates ?? [TARGET], this.#options.searchReasons);
    return {
      ...result,
      completeness: {
        ...result.completeness,
        pages: this.#options.searchPages ?? result.completeness.pages,
        offsets: this.#options.searchOffsets ?? result.completeness.offsets,
      },
    };
  }

  async listSchemaFields(): Promise<CollectionResult<SchemaField>> {
    this.operations.push("listSchemaFields");
    this.#trace.push({
      callId: "mcp-002",
      tool: "list_schema_fields",
      arguments: { urn: TARGET.urn, limit: 100, offset: 0 },
      status: "ok",
      at: "2026-07-22T12:00:00.000Z",
      page: 1,
    });
    return collection(this.#options.fields ?? FIELDS, this.#options.schemaReasons);
  }

  async getDownstreamLineage(
    _datasetUrn: string,
    options: { readonly column?: string; readonly maxHops: 2 },
  ): Promise<CollectionResult<LineageAsset>> {
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
      at: "2026-07-22T12:00:00.000Z",
      page: 1,
    });
    return options.column
      ? collection(this.#options.columnLineage ?? [COLUMN_DOWNSTREAM], this.#options.columnReasons)
      : collection(this.#options.tableLineage ?? [DOWNSTREAM], this.#options.tableReasons);
  }

  async getEntityContext(
    urns: readonly string[],
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<CollectionResult<EntityContext, EntityContextIncompleteReasonCode>> {
    this.operations.push("getEntityContext");
    this.#options.onEntityContext?.(options.signal);
    options.signal?.throwIfAborted();
    if (this.#options.entityContextError) throw this.#options.entityContextError;
    const entities = urns.map((urn) => ({
      urn,
      entityType: "DATASET",
      owners: [],
      tags: [],
      glossaryTerms: [],
      siblingUrns: [],
      qualitySignals: [],
    }));
    return collection(entities, this.#options.entityContextReasons);
  }

  getServerInfo() {
    return {};
  }

  getTrace(): readonly ToolTraceEntry[] {
    return this.#trace;
  }

  async close(): Promise<void> {
    this.operations.push("close");
    this.closeCount += 1;
    await this.#options.onClose?.();
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
  request: string = REQUEST,
) {
  return runImpactAnalysis({
    request,
    catalog,
    clock: () => new Date("2026-07-22T12:00:00.000Z"),
    runId: RUN_ID,
    runsRoot,
    signal,
    secrets,
  });
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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
      "getEntityContext",
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

  it("closes successfully before the final report becomes visible", async () => {
    const runsRoot = await createRunsRoot();
    const finalPath = join(runsRoot, RUN_ID, "impact-report.md");
    let reportExistedWhenCloseStarted = true;
    const catalog = new FakeCatalog({
      onClose: async () => {
        reportExistedWhenCloseStarted = await access(finalPath).then(
          () => true,
          () => false,
        );
      },
    });

    const run = await runWith(catalog, runsRoot);

    expect(reportExistedWhenCloseStarted).toBe(false);
    expect(catalog.closeCount).toBe(1);
    await expect(readFile(run.artifactPath, "utf8")).resolves.toContain(
      "# LineageGuard AI Impact Report",
    );
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

  it("rejects two exact candidates found across a complete two-page search", async () => {
    const candidates = [TARGET, { ...TARGET, urn: `${TARGET.urn}-second-page` }];
    const catalog = new FakeCatalog({
      candidates,
      searchPages: 2,
      searchOffsets: [0, 50],
    });

    await expect(runWith(catalog, await createRunsRoot())).rejects.toMatchObject({
      code: "NEEDS_USER_CLARIFICATION",
      details: {
        candidates: candidates
          .map(({ urn }) => urn)
          .sort((left, right) => left.localeCompare(right, "en-US")),
      },
    });
    expect(catalog.getTrace().map(({ arguments: args }) => args.offset)).toEqual([0, 50]);
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
    const runsRoot = await createRunsRoot();

    const caught = await runWith(catalog, runsRoot).catch((error: unknown) => error);

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
    await expect(access(join(runsRoot, RUN_ID, "impact-report.md"))).rejects.toThrow();
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

  it("rejects close failure without publishing a final report", async () => {
    const runsRoot = await createRunsRoot();
    const finalPath = join(runsRoot, RUN_ID, "impact-report.md");
    const closeFailure = new AppError(
      "MCP_UNAVAILABLE",
      "The DataHub MCP client could not be closed.",
    );
    const catalog = new FakeCatalog({ closeError: closeFailure });

    await expect(runWith(catalog, runsRoot)).rejects.toBe(closeFailure);
    await expect(access(finalPath)).rejects.toThrow();
    expect(catalog.closeCount).toBe(1);
  });

  it("rejects an owned close deadline without publishing a final report", async () => {
    vi.useFakeTimers();
    const runsRoot = await createRunsRoot();
    const finalPath = join(runsRoot, RUN_ID, "impact-report.md");
    const closeStarted = Promise.withResolvers<void>();
    const timeoutFailure = new AppError(
      "MCP_UNAVAILABLE",
      "The DataHub MCP client could not be closed.",
    );
    const catalog = new FakeCatalog({
      onClose: async () => {
        closeStarted.resolve();
        return new Promise<never>((_, reject) => {
          setTimeout(() => reject(timeoutFailure), 5_000);
        });
      },
    });
    const operation = runWith(catalog, runsRoot);
    const rejected = expect(operation).rejects.toBe(timeoutFailure);

    await closeStarted.promise;
    await vi.advanceTimersByTimeAsync(5_000);
    await rejected;
    await expect(access(finalPath)).rejects.toThrow();
    expect(catalog.closeCount).toBe(1);
  });

  it("preserves the safe in-memory report and attempted path after a real writer failure", async () => {
    const sandbox = await createRunsRoot();
    const blockedRoot = join(sandbox, "runs-file");
    const catalog = new FakeCatalog({
      onClose: async () => {
        await writeFile(blockedRoot, "not a directory", "utf8");
      },
    });

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
    expect(catalog.operations.at(-1)).toBe("close");
    await expect(access(join(blockedRoot, RUN_ID, "impact-report.md"))).rejects.toThrow();
  });

  it("rechecks caller cancellation after successful close and before publication", async () => {
    const controller = new AbortController();
    const runsRoot = await createRunsRoot();
    const finalPath = join(runsRoot, RUN_ID, "impact-report.md");
    const catalog = new FakeCatalog({
      onClose: () => controller.abort(),
    });

    await expect(runWith(catalog, runsRoot, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(access(finalPath)).rejects.toThrow();
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
      "getEntityContext",
      "close",
    ]);
    await expect(access(join(runsRoot, RUN_ID, "impact-report.md"))).rejects.toThrow();
  });

  it("does not expose the pre-write report builder as public application API", () => {
    expect(impactAnalysisModule).not.toHaveProperty("buildAnalysisRun");
  });

  it("marks required lineage truncation incomplete without changing the collected score", async () => {
    const complete = await runWith(new FakeCatalog(), await createRunsRoot());
    const incomplete = await runWith(
      new FakeCatalog({ tableReasons: ["ITEM_LIMIT_REACHED"] }),
      await createRunsRoot(),
    );

    expect(incomplete).toMatchObject({
      status: "INCOMPLETE_EVIDENCE",
      evidence: { completeness: { complete: false } },
    });
    expect(incomplete.assessment.score).toBe(complete.assessment.score);
    expect(incomplete.unknowns).toContain(
      "Table-lineage counts are collected lower bounds because required evidence is incomplete.",
    );
  });

  it("continues through explicit optional entity-context gaps", async () => {
    const run = await runWith(
      new FakeCatalog({ entityContextReasons: ["ENTITY_CONTEXT_UNAVAILABLE"] }),
      await createRunsRoot(),
    );

    expect(run.status).not.toBe("DATAHUB_UNAVAILABLE");
    expect(run.evidence.contextCoverage).toMatchObject({ retrievalComplete: false });
    expect(run.evidence.entityContextRetrieval.reasonCodes).toEqual(["ENTITY_CONTEXT_UNAVAILABLE"]);
  });

  it("treats an aborted get_entities transport call as terminal and closes once", async () => {
    const controller = new AbortController();
    let clockCalls = 0;
    const catalog = new FakeCatalog({
      onEntityContext(signal) {
        expect(signal).toBe(controller.signal);
        controller.abort();
      },
    });
    const runsRoot = await createRunsRoot();

    const operation = runImpactAnalysis({
      request: REQUEST,
      catalog,
      clock: () => {
        clockCalls += 1;
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
      "getEntityContext",
      "close",
    ]);
    expect(catalog.closeCount).toBe(1);
    expect(clockCalls).toBe(0);
    await expect(access(join(runsRoot, RUN_ID, "impact-report.md"))).rejects.toThrow();
  });

  it("treats a non-aborted get_entities transport failure as DATAHUB_UNAVAILABLE", async () => {
    const catalog = new FakeCatalog({
      entityContextError: new AppError("DATAHUB_UNAVAILABLE", "Entity context transport failed."),
    });

    await expect(runWith(catalog, await createRunsRoot())).rejects.toMatchObject({
      code: "DATAHUB_UNAVAILABLE",
    });
    expect(catalog.closeCount).toBe(1);
  });

  const incompleteSearchFailure = {
    code: "DATAHUB_UNAVAILABLE",
    message: "Dataset search was incomplete.",
  };

  async function expectIncompleteSearchFailure(
    catalog: FakeCatalog,
    runsRoot: string,
    request: string,
  ): Promise<void> {
    await expect(
      runWith(catalog, runsRoot, new AbortController().signal, [], request),
    ).rejects.toMatchObject(incompleteSearchFailure);
    expect(catalog.operations).toEqual(["searchDatasets", "close"]);
    expect(catalog.closeCount).toBe(1);
    await expect(access(join(runsRoot, RUN_ID, "impact-report.md"))).rejects.toThrow();
  }

  it("rejects incomplete search with a first-page platform alias before downstream work", async () => {
    const catalog = new FakeCatalog({ searchReasons: ["PAGE_LIMIT_REACHED"] });
    await expectIncompleteSearchFailure(catalog, await createRunsRoot(), REQUEST);
  });

  it("rejects incomplete search with a first-page plain-name alias before downstream work", async () => {
    const catalog = new FakeCatalog({ searchReasons: ["HAS_MORE"] });
    await expectIncompleteSearchFailure(
      catalog,
      await createRunsRoot(),
      "Rename column customer_id to customer_key in dataset orders",
    );
  });

  it("rejects incomplete search when the canonical candidate URN is absent", async () => {
    const catalog = new FakeCatalog({
      candidates: [],
      searchReasons: ["PAGE_LIMIT_REACHED"],
    });
    await expectIncompleteSearchFailure(
      catalog,
      await createRunsRoot(),
      `Rename column customer_id to customer_key in dataset ${TARGET.urn}`,
    );
  });

  it("rejects incomplete search when the canonical candidate URN is duplicated", async () => {
    const catalog = new FakeCatalog({
      candidates: [TARGET, { ...TARGET }],
      searchReasons: ["REPEATED_PAGE"],
    });
    await expectIncompleteSearchFailure(
      catalog,
      await createRunsRoot(),
      `Rename column customer_id to customer_key in dataset ${TARGET.urn}`,
    );
  });

  it("rejects incomplete search when the canonical hint matches only candidate name", async () => {
    const catalog = new FakeCatalog({
      candidates: [
        {
          urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,other,PROD)",
          name: TARGET.urn,
        },
      ],
      searchReasons: ["HAS_MORE"],
    });
    await expectIncompleteSearchFailure(
      catalog,
      await createRunsRoot(),
      `Rename column customer_id to customer_key in dataset ${TARGET.urn}`,
    );
  });

  it("continues incomplete search for one explicit canonical candidate URN", async () => {
    const catalog = new FakeCatalog({
      candidates: [TARGET],
      searchReasons: ["PAGE_LIMIT_REACHED"],
    });
    const runsRoot = await createRunsRoot();
    const run = await runWith(
      catalog,
      runsRoot,
      new AbortController().signal,
      [],
      `Rename column customer_id to customer_key in dataset ${TARGET.urn}`,
    );

    expect(run).toMatchObject({
      status: "INCOMPLETE_EVIDENCE",
      evidence: {
        targetDataset: {
          urn: TARGET.urn,
          platform: "snowflake",
          environment: "PROD",
        },
        completeness: {
          complete: false,
          search: { complete: false },
        },
      },
    });
    expect(catalog.operations).toEqual([
      "searchDatasets",
      "listSchemaFields",
      "getDownstreamLineage:table",
      "getDownstreamLineage:customer_id",
      "getEntityContext",
      "close",
    ]);
    await expect(access(run.artifactPath)).resolves.toBeUndefined();
  });

  it("allows a verified source field from incomplete schema but never infers absence", async () => {
    const continued = await runWith(
      new FakeCatalog({ schemaReasons: ["ITEM_LIMIT_REACHED"] }),
      await createRunsRoot(),
    );
    expect(continued.status).toBe("INCOMPLETE_EVIDENCE");

    await expect(
      runWith(
        new FakeCatalog({ fields: [{ fieldPath: "order_id" }], schemaReasons: ["HAS_MORE"] }),
        await createRunsRoot(),
      ),
    ).rejects.toMatchObject({
      code: "DATAHUB_UNAVAILABLE",
      message: "Dataset schema was incomplete.",
    });
    await expect(
      runWith(new FakeCatalog({ fields: [{ fieldPath: "order_id" }] }), await createRunsRoot()),
    ).rejects.toMatchObject({ code: "COLUMN_NOT_FOUND" });
  });
});
