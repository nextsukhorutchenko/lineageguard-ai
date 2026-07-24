import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { runImpactAnalysis } from "../src/app/run-impact-analysis.js";
import { readImpactReport } from "../src/artifacts/write-run-artifacts.js";
import type { CollectionResult, DataHubCatalog } from "../src/datahub/catalog.js";
import type {
  EntityContext,
  EntityContextIncompleteReasonCode,
  LineageAsset,
  SchemaField,
  ToolTraceEntry,
} from "../src/domain/evidence.js";
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

const completenessSchema = z
  .object({
    complete: z.boolean(),
    pages: z.number().int().nonnegative(),
    itemCount: z.number().int().nonnegative(),
    offsets: z.array(z.number().int().nonnegative()),
    reasonCodes: z.array(z.string()),
  })
  .strict();

const collectionSchema = <T extends z.ZodType>(item: T) =>
  z
    .object({
      items: z.array(item),
      completeness: completenessSchema,
    })
    .strict();

const candidateSchema = z
  .object({
    urn: z.string(),
    name: z.string(),
    platform: z.string().optional(),
    environment: z.string().optional(),
  })
  .strict();
const fieldSchema = z
  .object({
    fieldPath: z.string(),
    nativeDataType: z.string().optional(),
    nullable: z.boolean().optional(),
    description: z.string().optional(),
  })
  .strict();
const lineageSchema = z
  .object({
    urn: z.string(),
    name: z.string().optional(),
    platform: z.string().optional(),
    hop: z.number(),
    lineageColumns: z.array(z.string()),
  })
  .strict();
const entityContextSchema = z
  .object({
    urn: z.string(),
    entityType: z.string(),
    name: z.string().optional(),
    platform: z.string().optional(),
    description: z.string().max(2_000).optional(),
    owners: z.array(z.string()).max(20),
    tags: z.array(z.string()).max(20),
    glossaryTerms: z.array(z.string()).max(20),
    siblingUrns: z.array(z.string()).max(20),
    qualitySignals: z.array(z.string()).max(20),
  })
  .strict();

async function parseFixture<T>(name: string, schema: z.ZodType): Promise<T> {
  return schema.parse(await readFixture<unknown>(name)) as T;
}

class FixtureCatalog implements DataHubCatalog {
  readonly #trace: ToolTraceEntry[] = [];

  async searchDatasets(): Promise<CollectionResult<DatasetCandidate>> {
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
      at: "2026-07-22T12:00:00.000Z",
      page: 1,
    });
    return parseFixture<CollectionResult<DatasetCandidate>>(
      "search-order-details.json",
      collectionSchema(candidateSchema),
    );
  }

  async listSchemaFields(): Promise<CollectionResult<SchemaField>> {
    this.#trace.push({
      callId: "mcp-002",
      tool: "list_schema_fields",
      arguments: { urn: DATASET_URN, limit: 100, offset: 0 },
      status: "ok",
      at: "2026-07-22T12:00:00.000Z",
      page: 1,
    });
    return parseFixture<CollectionResult<SchemaField>>(
      "schema-order-details.json",
      collectionSchema(fieldSchema),
    );
  }

  async getDownstreamLineage(
    _datasetUrn: string,
    options: { readonly column?: string; readonly maxHops: 2 },
  ): Promise<CollectionResult<LineageAsset>> {
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
      at: "2026-07-22T12:00:00.000Z",
      page: 1,
    });
    return parseFixture<CollectionResult<LineageAsset>>(
      options.column
        ? "lineage-order-details-customer-id.json"
        : "lineage-order-details-table.json",
      collectionSchema(lineageSchema),
    );
  }

  async getEntityContext(
    urns: readonly string[],
  ): Promise<CollectionResult<EntityContext, EntityContextIncompleteReasonCode>> {
    const requested = [...new Set(urns)].sort((left, right) => left.localeCompare(right, "en-US"));
    for (let offset = 0; offset < requested.length; offset += 10) {
      this.#trace.push({
        callId: `mcp-${String(this.#trace.length + 1).padStart(3, "0")}`,
        tool: "get_entities",
        arguments: { urns: requested.slice(offset, offset + 10) },
        status: "ok",
        at: "2026-07-22T12:00:00.000Z",
        page: offset / 10 + 1,
      });
    }
    const fixture = await parseFixture<CollectionResult<EntityContext, never>>(
      "entity-context-order-details-impact.json",
      collectionSchema(entityContextSchema),
    );
    const requestedSet = new Set(requested);
    const items = fixture.items.filter(({ urn }) => requestedSet.has(urn));
    const missing = requested.some((urn) => !items.some((item) => item.urn === urn));
    return {
      items,
      completeness: {
        complete: !missing,
        pages: Math.ceil(requested.length / 10),
        itemCount: items.length,
        offsets: Array.from({ length: Math.ceil(requested.length / 10) }, (_, page) => page * 10),
        reasonCodes: missing ? ["ENTITY_CONTEXT_UNAVAILABLE"] : [],
      },
    };
  }

  getServerInfo() {
    return {};
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
  return {
    run,
    markdown: await readImpactReport({ runsRoot, runId: run.runId }),
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("fixture-backed impact analysis", () => {
  it("filters entity context to requested URNs and reports uninspected requests truthfully", async () => {
    const catalog = new FixtureCatalog();
    const missingUrn = "urn:li:dataset:(missing-from-fixture)";

    const result = await catalog.getEntityContext([DATASET_URN, missingUrn]);

    expect(result.items.map(({ urn }) => urn)).toEqual([DATASET_URN]);
    expect(result.completeness).toEqual({
      complete: false,
      pages: 1,
      itemCount: 1,
      offsets: [0],
      reasonCodes: ["ENTITY_CONTEXT_UNAVAILABLE"],
    });
    expect(catalog.getTrace().at(-1)?.arguments).toEqual({
      urns: [DATASET_URN, missingUrn].sort((left, right) => left.localeCompare(right, "en-US")),
    });
  });

  it("repeats the grounded 24/11/90 result and matches the committed example", async () => {
    const first = await runFixturePipeline();
    const second = await runFixturePipeline();

    expect(first.run.evidence.targetDataset).toMatchObject({
      urn: DATASET_URN,
      platform: "snowflake",
      environment: "PROD",
    });
    expect(first.run.evidence.downstreamAssets).toHaveLength(24);
    expect(first.run.evidence.columnAffectedAssets).toHaveLength(11);
    expect(first.run.evidence.searchCandidateUrns).toEqual(
      (
        await parseFixture<CollectionResult<DatasetCandidate>>(
          "search-order-details.json",
          collectionSchema(candidateSchema),
        )
      ).items
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

  it("rejects forbidden raw entity-context fields in replay fixtures", () => {
    const forbidden = ["email", "profile", "relatedDocuments", "rawSql", "token", "diagnostics"];
    for (const field of forbidden) {
      expect(() =>
        entityContextSchema.parse({
          urn: "urn:li:dataset:test",
          entityType: "DATASET",
          owners: [],
          tags: [],
          glossaryTerms: [],
          siblingUrns: [],
          qualitySignals: [],
          [field]: "unsafe",
        }),
      ).toThrow();
    }
  });
});
