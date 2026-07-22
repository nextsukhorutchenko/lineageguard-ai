import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createHash } from "node:crypto";
import { describe, expect, expectTypeOf, it } from "vitest";
import { calculateContextCoverage } from "../../domain/context-coverage.js";
import { loadRuntimeConfig } from "../../config/runtime-config.js";
import { AppError } from "../../errors/app-error.js";
import {
  DataHubMcpCatalog,
  type McpToolClient,
  type ToolCallRequest,
} from "./datahub-mcp-catalog.js";
import {
  appendBoundedRedactedStderr,
  assertRequiredReadOnlyTools,
  connectDataHubMcp,
  dataHubMcpServerParameters,
  listAndAssertRequiredReadOnlyTools,
  toDataHubMcpToolClient,
} from "./mcp-client.js";

const DATASET_URN =
  "urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details,PROD)";
const DOWNSTREAM_URN =
  "urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.analytics.customer_orders,PROD)";

function jsonResult(payload: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

class RecordingMcpClient implements McpToolClient {
  readonly calls: ToolCallRequest[] = [];
  closeCount = 0;

  constructor(private readonly results: readonly CallToolResult[]) {}

  async callTool(request: ToolCallRequest): Promise<CallToolResult> {
    this.calls.push(request);
    const result = this.results[this.calls.length - 1];
    if (!result) throw new Error("The fake has no result for this call.");
    return result;
  }

  async close(): Promise<void> {
    this.closeCount += 1;
  }

  getServerInfo() {
    return {};
  }
}

describe("Task 1A bounded evidence collection", () => {
  it("collects exact-name candidates across search pages", async () => {
    const client = new RecordingMcpClient([
      jsonResult({
        start: 0,
        count: 50,
        total: 51,
        searchResults: Array.from({ length: 50 }, (_, index) => ({
          entity: {
            urn: `urn:li:dataset:(first-${index})`,
            name: index === 0 ? "order_details" : `other_${index}`,
          },
        })),
      }),
      jsonResult({
        start: 50,
        count: 1,
        total: 51,
        searchResults: [{ entity: { urn: `${DATASET_URN}-duplicate`, name: "order_details" } }],
      }),
    ]);

    const result = await new DataHubMcpCatalog(client).searchDatasets("order_details");

    expect(result.completeness).toMatchObject({ complete: true, pages: 2, itemCount: 51 });
    expect(result.items.filter(({ name }) => name === "order_details")).toHaveLength(2);
    expect(client.calls.at(-1)?.arguments.offset).toBe(50);
  });

  it.each([
    ["missing start", { count: 0, total: 0, searchResults: [] }],
    ["missing count", { start: 0, total: 0, searchResults: [] }],
    ["missing total", { start: 0, count: 0, searchResults: [] }],
    ["mismatched start", { start: 1, count: 0, total: 1, searchResults: [] }],
    ["mismatched count", { start: 0, count: 1, total: 1, searchResults: [] }],
    [
      "range past total",
      { start: 1, count: 1, total: 1, searchResults: [{ entity: { urn: DATASET_URN } }] },
    ],
  ])("rejects malformed search pagination: %s", async (_label, page) => {
    await expect(
      new DataHubMcpCatalog(new RecordingMcpClient([jsonResult(page)])).searchDatasets("orders"),
    ).rejects.toMatchObject({ code: "DATAHUB_UNAVAILABLE", details: {} });
  });

  it("marks a token-truncated lineage collection incomplete without discarding valid assets", async () => {
    const client = new RecordingMcpClient([
      jsonResult({
        downstreams: {
          searchResults: [{ entity: { urn: DOWNSTREAM_URN }, degree: 1 }],
          offset: 0,
          returned: 1,
          hasMore: true,
          truncatedDueToTokenBudget: true,
        },
      }),
      jsonResult({
        downstreams: {
          searchResults: [],
          offset: 1,
          returned: 0,
          hasMore: false,
          truncatedDueToTokenBudget: false,
        },
      }),
    ]);

    const result = await new DataHubMcpCatalog(client).getDownstreamLineage(DATASET_URN, {
      maxHops: 2,
    });

    expect(result.items).toHaveLength(1);
    expect(result.completeness).toMatchObject({
      complete: false,
      reasonCodes: expect.arrayContaining(["TOKEN_BUDGET_TRUNCATION"]),
    });
  });

  it("treats the pinned one-hundred-result lineage ceiling as incomplete", async () => {
    const results = Array.from({ length: 100 }, (_, index) => ({
      entity: { urn: `urn:li:dataset:(asset-${index})` },
      degree: 1,
    }));
    const result = await new DataHubMcpCatalog(
      new RecordingMcpClient([
        jsonResult({
          downstreams: {
            searchResults: results,
            offset: 0,
            returned: 100,
            hasMore: false,
            truncatedDueToTokenBudget: false,
          },
        }),
      ]),
    ).getDownstreamLineage(DATASET_URN, { maxHops: 2 });

    expect(result.completeness).toMatchObject({
      complete: false,
      itemCount: 100,
      reasonCodes: ["ITEM_LIMIT_REACHED"],
    });
  });

  it("normalizes get_entities in batches of ten and records missing optional metadata", async () => {
    const urns = Array.from({ length: 11 }, (_, index) => `urn:li:dataset:(asset-${index})`);
    const sortedUrns = [...urns].sort((left, right) => left.localeCompare(right, "en-US"));
    const client = new RecordingMcpClient([
      jsonResult(
        sortedUrns.slice(0, 10).map((urn, index) => ({
          urn,
          type: "DATASET",
          properties: index === 0 ? { description: "Untrusted metadata text" } : {},
          ownership: { owners: [] },
        })),
      ),
      jsonResult([{ urn: sortedUrns[10], type: "DATASET", ownership: { owners: [] } }]),
    ]);

    const result = await new DataHubMcpCatalog(client).getEntityContext(urns);

    expect(client.calls.map(({ arguments: args }) => (args.urns as string[]).length)).toEqual([
      10, 1,
    ]);
    expect(result.items[0]).toMatchObject({
      urn: sortedUrns[0],
      description: "Untrusted metadata text",
      owners: [],
      tags: [],
      glossaryTerms: [],
    });
  });

  it("caps entity context at fifty unique URNs and leaves the remainder unknown", async () => {
    const urns = Array.from(
      { length: 51 },
      (_, index) => `urn:li:dataset:(asset-${String(index).padStart(2, "0")})`,
    );
    const client = new RecordingMcpClient(
      Array.from({ length: 5 }, (_, page) =>
        jsonResult(urns.slice(page * 10, page * 10 + 10).map((urn) => ({ urn, type: "DATASET" }))),
      ),
    );

    const result = await new DataHubMcpCatalog(client).getEntityContext(urns);
    const coverage = calculateContextCoverage({
      relevantUrns: urns,
      retrievalComplete: result.completeness.complete,
      entities: result.items,
    });

    expect(client.calls.map(({ arguments: args }) => (args.urns as string[]).length)).toEqual([
      10, 10, 10, 10, 10,
    ]);
    expect(result.completeness).toEqual({
      complete: false,
      pages: 5,
      itemCount: 50,
      offsets: [0, 10, 20, 30, 40],
      reasonCodes: ["ENTITY_CONTEXT_TRUNCATED"],
    });
    expect(coverage.unknownMetadataUrns).toEqual([urns[50]]);
    expect(coverage.missingMetadataUrns).not.toContain(urns[50]);
  });

  it("enforces the UTF-8 entity-context budget on whole normalized records", async () => {
    const urns = Array.from(
      { length: 50 },
      (_, index) => `urn:li:dataset:(large-${String(index).padStart(2, "0")})`,
    );
    const rawEntity = (urn: string) => ({
      urn,
      type: "DATASET",
      properties: { description: "Ж".repeat(2_000) },
      ownership: {
        owners: Array.from({ length: 30 }, (_, index) => ({
          owner: { urn: `urn:li:corpuser:owner-${index}` },
        })),
      },
      tags: {
        tags: Array.from({ length: 30 }, (_, index) => ({
          tag: { urn: `urn:li:tag:tag-${index}` },
        })),
      },
    });
    const client = new RecordingMcpClient(
      Array.from({ length: 5 }, (_, page) =>
        jsonResult(urns.slice(page * 10, page * 10 + 10).map(rawEntity)),
      ),
    );

    const result = await new DataHubMcpCatalog(client).getEntityContext(urns);
    const coverage = calculateContextCoverage({
      relevantUrns: urns,
      retrievalComplete: result.completeness.complete,
      entities: result.items,
    });

    expect(Buffer.byteLength(JSON.stringify(result.items), "utf8")).toBeLessThanOrEqual(100_000);
    expect(result.items.every((entity) => entity.owners.length === 20)).toBe(true);
    expect(result.items.every((entity) => entity.tags.length === 20)).toBe(true);
    expect(result.completeness.reasonCodes).toContain("ENTITY_CONTEXT_TRUNCATED");
    expect(coverage.unknownMetadataUrns.length).toBeGreaterThan(0);
    expect(
      coverage.unknownMetadataUrns.every((urn) => !coverage.missingMetadataUrns.includes(urn)),
    ).toBe(true);
  });

  it("normalizes entity order, coverage, and context hash deterministically", async () => {
    const urns = ["urn:li:dataset:(b)", "urn:li:dataset:(a)"];
    const entities = urns.map((urn) => ({
      urn,
      type: "DATASET",
      properties: { description: urn },
    }));
    const first = await new DataHubMcpCatalog(
      new RecordingMcpClient([jsonResult(entities)]),
    ).getEntityContext(urns);
    const second = await new DataHubMcpCatalog(
      new RecordingMcpClient([jsonResult([...entities].reverse())]),
    ).getEntityContext([...urns].reverse());
    const coverage = (items: typeof first.items) =>
      calculateContextCoverage({ relevantUrns: urns, retrievalComplete: true, entities: items });
    const hash = (value: unknown) =>
      createHash("sha256").update(JSON.stringify(value)).digest("hex");

    expect(second).toEqual(first);
    expect(coverage(second.items)).toEqual(coverage(first.items));
    expect(hash(second.items)).toBe(hash(first.items));
  });

  it("selects the same whole records at the UTF-8 budget under response reordering", async () => {
    const urns = Array.from(
      { length: 30 },
      (_, index) => `urn:li:dataset:(budget-${String(index).padStart(2, "0")})`,
    );
    const entity = (urn: string) => ({
      urn,
      type: "DATASET",
      properties: { description: `${urn}${"Ж".repeat(1_990)}` },
    });
    const results = [0, 10, 20].map((offset) => urns.slice(offset, offset + 10).map(entity));
    const forward = await new DataHubMcpCatalog(
      new RecordingMcpClient(results.map(jsonResult)),
    ).getEntityContext(urns);
    const reordered = await new DataHubMcpCatalog(
      new RecordingMcpClient(results.map((batch) => jsonResult([...batch].reverse()))),
    ).getEntityContext(urns);

    expect(reordered).toEqual(forward);
    expect(forward.completeness.reasonCodes).toContain("ENTITY_CONTEXT_TRUNCATED");
  });

  it.each([
    [
      [
        { urn: DATASET_URN, type: "DATASET" },
        { urn: DATASET_URN, type: "DATASET" },
      ],
    ],
    [[{ urn: DOWNSTREAM_URN, type: "DATASET" }]],
  ])("rejects duplicate or unrequested get_entities identities", async (entries) => {
    await expect(
      new DataHubMcpCatalog(new RecordingMcpClient([jsonResult(entries)])).getEntityContext([
        DATASET_URN,
      ]),
    ).rejects.toMatchObject({ code: "DATAHUB_UNAVAILABLE", details: {} });
  });
});

describe("Task 1A capability boundary", () => {
  const requiredTools = ["search", "list_schema_fields", "get_lineage", "get_entities"];

  it("accepts exactly the required read-only tools and ignores extras", () => {
    expect(() =>
      assertRequiredReadOnlyTools(
        requiredTools.map((name) => ({ name, annotations: { readOnlyHint: true } })),
      ),
    ).not.toThrow();
    expect(() =>
      assertRequiredReadOnlyTools([
        ...requiredTools.map((name) => ({ name, annotations: { readOnlyHint: true } })),
        { name: "save_document", annotations: { readOnlyHint: false } },
        { name: "add_owners", annotations: { readOnlyHint: false } },
        { name: "future_tool", annotations: { readOnlyHint: false } },
      ]),
    ).not.toThrow();
  });

  it("rejects a missing or non-read-only required tool", () => {
    expect(() =>
      assertRequiredReadOnlyTools(
        requiredTools
          .filter((name) => name !== "get_entities")
          .map((name) => ({ name, annotations: { readOnlyHint: true } })),
      ),
    ).toThrow("Required read-only DataHub MCP tools are unavailable.");
    expect(() =>
      assertRequiredReadOnlyTools(
        requiredTools.map((name) => ({
          name,
          annotations: { readOnlyHint: name !== "get_lineage" },
        })),
      ),
    ).toThrow("Required read-only DataHub MCP tools are unavailable.");
  });

  it("keeps mutation tool names outside the exact catalog call boundary", () => {
    expectTypeOf<ToolCallRequest["name"]>().toEqualTypeOf<
      "search" | "list_schema_fields" | "get_lineage" | "get_entities"
    >();
    expect(new DataHubMcpCatalog(new RecordingMcpClient([]))).not.toHaveProperty("save_document");
  });

  it("collects required capabilities across cursor pages with one connection signal", async () => {
    const signal = new AbortController().signal;
    const received: Array<{ cursor?: string; signal?: AbortSignal }> = [];
    const pageOne = requiredTools.slice(0, 3).map((name) => ({
      name,
      annotations: { readOnlyHint: true },
    }));
    const client = {
      async listTools(params?: { cursor?: string }, options?: { signal?: AbortSignal }) {
        received.push({
          ...(params?.cursor ? { cursor: params.cursor } : {}),
          ...(options?.signal === undefined ? {} : { signal: options.signal }),
        });
        return params?.cursor === "next"
          ? { tools: [{ name: "get_entities", annotations: { readOnlyHint: true } }] }
          : { tools: pageOne, nextCursor: "next" };
      },
    };

    await expect(listAndAssertRequiredReadOnlyTools(client, signal)).resolves.toBeUndefined();
    expect(received).toEqual([{ signal }, { cursor: "next", signal }]);
  });

  it("rejects repeated cursors and more than five capability pages", async () => {
    const repeated = {
      async listTools() {
        return { tools: [], nextCursor: "same" };
      },
    };
    await expect(
      listAndAssertRequiredReadOnlyTools(repeated, new AbortController().signal),
    ).rejects.toMatchObject({ code: "MCP_UNAVAILABLE" });

    let page = 0;
    const unbounded = {
      async listTools() {
        page += 1;
        return { tools: [], nextCursor: `cursor-${page}` };
      },
    };
    await expect(
      listAndAssertRequiredReadOnlyTools(unbounded, new AbortController().signal),
    ).rejects.toMatchObject({ code: "MCP_UNAVAILABLE" });
    expect(page).toBe(5);
  });

  it("propagates cancellation from a hung later capability page", async () => {
    const controller = new AbortController();
    const client = {
      async listTools(params?: { cursor?: string }, options?: { signal?: AbortSignal }) {
        if (!params?.cursor) return { tools: [], nextCursor: "next" };
        return new Promise<never>((_, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
            once: true,
          });
        });
      },
    };
    const operation = listAndAssertRequiredReadOnlyTools(client, controller.signal);
    controller.abort();
    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
  });

  it("snapshots only bounded credential-safe optional handshake identity", () => {
    const secret = "active-datahub-token";
    const sdkClient = {
      async callTool() {
        return jsonResult({});
      },
      getServerVersion() {
        return {
          name: `DataHub ${secret} ${"n".repeat(200)}`,
          version: "Bearer abcdefghijklmnop",
          capabilities: { unsafe: true },
        };
      },
      async close() {},
    };
    const client = toDataHubMcpToolClient(sdkClient, [secret]);

    expect(client.getServerInfo().reportedServerName?.startsWith("DataHub [REDACTED] ")).toBe(true);
    expect(client.getServerInfo().reportedServerName).toHaveLength(100);
    expect(JSON.stringify(client.getServerInfo())).not.toContain(secret);
    expect(client.getServerInfo()).not.toHaveProperty("capabilities");
  });

  it("omits absent or redacted-only handshake identity", () => {
    const absent = toDataHubMcpToolClient({
      async callTool() {
        return jsonResult({});
      },
      getServerVersion() {
        return undefined;
      },
      async close() {},
    });
    const redacted = toDataHubMcpToolClient(
      {
        async callTool() {
          return jsonResult({});
        },
        getServerVersion() {
          return { name: "secret", version: "secret" };
        },
        async close() {},
      },
      ["secret"],
    );

    expect(absent.getServerInfo()).toEqual({});
    expect(redacted.getServerInfo()).toEqual({});
  });
});

describe("DataHubMcpCatalog", () => {
  it("normalizes search, schema, table lineage, and column lineage through exact read calls", async () => {
    const client = new RecordingMcpClient([
      jsonResult({
        start: 0,
        count: 1,
        total: 1,
        searchResults: [
          {
            entity: {
              urn: DATASET_URN,
              name: "b2fd91.order_entry_db.analytics.order_details",
              type: "DATASET",
              platform: { name: "snowflake", ignored: "raw-platform-value" },
              ignored: "raw-search-value",
            },
            ignored: "raw-result-value",
          },
        ],
        ignored: "raw-search-response",
      }),
      jsonResult({
        urn: DATASET_URN,
        offset: 0,
        fields: [
          {
            fieldPath: "customer_id",
            nativeDataType: "NUMBER(38,0)",
            nullable: false,
            description: "Customer identifier",
            ignored: "raw-field-value",
          },
        ],
        totalFields: 1,
        returned: 1,
        remainingCount: 0,
        ignored: "raw-schema-response",
      }),
      jsonResult({
        downstreams: {
          offset: 0,
          returned: 1,
          hasMore: false,
          truncatedDueToTokenBudget: false,
          searchResults: [
            {
              entity: {
                urn: DOWNSTREAM_URN,
                name: "customer_orders",
                platform: { name: "snowflake", ignored: "raw-platform-value" },
                ignored: "raw-lineage-entity",
              },
              degree: 1,
              lineageColumns: [],
              ignored: "raw-table-lineage-value",
            },
          ],
        },
        ignored: "raw-table-response",
      }),
      jsonResult({
        downstreams: {
          offset: 0,
          returned: 1,
          hasMore: false,
          truncatedDueToTokenBudget: false,
          searchResults: [
            {
              entity: {
                urn: DOWNSTREAM_URN,
                name: "customer_orders",
                platform: { name: "snowflake" },
              },
              degree: 1,
              lineageColumns: ["customer_id"],
              ignored: "raw-column-lineage-value",
            },
          ],
        },
        ignored: "raw-column-response",
      }),
    ]);
    const catalog = new DataHubMcpCatalog(client, ["customer_id"]);

    await expect(
      catalog.searchDatasets("b2fd91.order_entry_db.analytics.order_details"),
    ).resolves.toEqual({
      items: [
        {
          urn: DATASET_URN,
          name: "b2fd91.order_entry_db.analytics.order_details",
          platform: "snowflake",
        },
      ],
      completeness: { complete: true, pages: 1, itemCount: 1, offsets: [0], reasonCodes: [] },
    });
    await expect(catalog.listSchemaFields(DATASET_URN)).resolves.toEqual({
      items: [
        {
          fieldPath: "customer_id",
          nativeDataType: "NUMBER(38,0)",
          nullable: false,
          description: "Customer identifier",
        },
      ],
      completeness: { complete: true, pages: 1, itemCount: 1, offsets: [0], reasonCodes: [] },
    });
    await expect(catalog.getDownstreamLineage(DATASET_URN, { maxHops: 2 })).resolves.toEqual({
      items: [
        {
          urn: DOWNSTREAM_URN,
          name: "customer_orders",
          platform: "snowflake",
          hop: 1,
          lineageColumns: [],
        },
      ],
      completeness: { complete: true, pages: 1, itemCount: 1, offsets: [0], reasonCodes: [] },
    });
    await expect(
      catalog.getDownstreamLineage(DATASET_URN, {
        column: "customer_id",
        maxHops: 2,
      }),
    ).resolves.toEqual({
      items: [
        {
          urn: DOWNSTREAM_URN,
          name: "customer_orders",
          platform: "snowflake",
          hop: 1,
          lineageColumns: ["customer_id"],
        },
      ],
      completeness: { complete: true, pages: 1, itemCount: 1, offsets: [0], reasonCodes: [] },
    });

    expect(client.calls).toEqual([
      {
        name: "search",
        arguments: {
          query: "/q b2fd91+order_entry_db+analytics+order_details",
          filter: "entity_type = dataset",
          num_results: 50,
          offset: 0,
        },
      },
      {
        name: "list_schema_fields",
        arguments: { urn: DATASET_URN, limit: 100, offset: 0 },
      },
      {
        name: "get_lineage",
        arguments: {
          urn: DATASET_URN,
          column: null,
          upstream: false,
          max_hops: 2,
          max_results: 100,
          offset: 0,
        },
      },
      {
        name: "get_lineage",
        arguments: {
          urn: DATASET_URN,
          column: "customer_id",
          upstream: false,
          max_hops: 2,
          max_results: 100,
          offset: 0,
        },
      },
    ]);

    expect(catalog.getTrace()).toMatchObject([
      {
        callId: "mcp-001",
        tool: "search",
        arguments: client.calls[0]!.arguments,
        status: "ok",
      },
      {
        callId: "mcp-002",
        tool: "list_schema_fields",
        arguments: client.calls[1]!.arguments,
        status: "ok",
      },
      {
        callId: "mcp-003",
        tool: "get_lineage",
        arguments: client.calls[2]!.arguments,
        status: "ok",
      },
      {
        callId: "mcp-004",
        tool: "get_lineage",
        arguments: { ...client.calls[3]!.arguments, column: "[REDACTED]" },
        status: "ok",
      },
    ]);
    expect(JSON.stringify(catalog.getTrace())).not.toContain("raw-");
    expect(JSON.stringify(catalog.getTrace())).not.toContain("customer_id");
  });

  it("preserves an unnamed search-result fixture by using its URN as the display name", async () => {
    const client = new RecordingMcpClient([
      jsonResult({
        start: 0,
        count: 1,
        total: 1,
        searchResults: [{ entity: { urn: DATASET_URN, type: "DATASET" } }],
      }),
    ]);
    const catalog = new DataHubMcpCatalog(client);

    await expect(catalog.searchDatasets(DATASET_URN)).resolves.toMatchObject({
      items: [{ urn: DATASET_URN, name: DATASET_URN }],
      completeness: { complete: true },
    });
  });

  it("paginates schema fields until DataHub reports none remaining", async () => {
    const client = new RecordingMcpClient([
      jsonResult({
        urn: DATASET_URN,
        offset: 0,
        fields: [{ fieldPath: "customer_id" }],
        totalFields: 2,
        returned: 1,
        remainingCount: 1,
      }),
      jsonResult({
        urn: DATASET_URN,
        offset: 1,
        fields: [{ fieldPath: "order_id" }],
        totalFields: 2,
        returned: 1,
        remainingCount: 0,
      }),
    ]);
    const catalog = new DataHubMcpCatalog(client);

    await expect(catalog.listSchemaFields(DATASET_URN)).resolves.toMatchObject({
      items: [{ fieldPath: "customer_id" }, { fieldPath: "order_id" }],
      completeness: { complete: true, pages: 2 },
    });
    expect(client.calls).toEqual([
      {
        name: "list_schema_fields",
        arguments: { urn: DATASET_URN, limit: 100, offset: 0 },
      },
      {
        name: "list_schema_fields",
        arguments: { urn: DATASET_URN, limit: 100, offset: 1 },
      },
    ]);
  });

  it.each([
    {
      invariant: "returned count equals the page field count",
      page: {
        urn: DATASET_URN,
        offset: 0,
        fields: [{ fieldPath: "customer_id" }],
        totalFields: 2,
        returned: 2,
        remainingCount: 0,
      },
    },
    {
      invariant: "offset plus returned and remaining equals total",
      page: {
        urn: DATASET_URN,
        offset: 0,
        fields: [{ fieldPath: "customer_id" }],
        totalFields: 2,
        returned: 1,
        remainingCount: 0,
      },
    },
    {
      invariant: "page field count stays within the requested limit",
      page: {
        urn: DATASET_URN,
        offset: 0,
        fields: Array.from({ length: 101 }, (_, index) => ({ fieldPath: `field_${index}` })),
        totalFields: 101,
        returned: 101,
        remainingCount: 0,
      },
    },
  ])("marks schema incomplete when $invariant is inconsistent", async ({ page }) => {
    const client = new RecordingMcpClient([jsonResult(page)]);
    const catalog = new DataHubMcpCatalog(client);

    await expect(catalog.listSchemaFields(DATASET_URN)).resolves.toMatchObject({
      completeness: { complete: false, reasonCodes: ["INCONSISTENT_PAGINATION"] },
    });
    expect(client.calls).toHaveLength(1);
    expect(catalog.getTrace().map(({ status }) => status)).toEqual(["ok"]);
  });

  it("fails closed when schema totalFields changes between pages", async () => {
    const client = new RecordingMcpClient([
      jsonResult({
        urn: DATASET_URN,
        offset: 0,
        fields: [{ fieldPath: "customer_id" }],
        totalFields: 2,
        returned: 1,
        remainingCount: 1,
      }),
      jsonResult({
        urn: DATASET_URN,
        offset: 1,
        fields: [{ fieldPath: "order_id" }],
        totalFields: 3,
        returned: 1,
        remainingCount: 1,
      }),
      jsonResult({
        urn: DATASET_URN,
        offset: 2,
        fields: [{ fieldPath: "created_at" }],
        totalFields: 3,
        returned: 1,
        remainingCount: 0,
      }),
    ]);
    const catalog = new DataHubMcpCatalog(client);

    await expect(catalog.listSchemaFields(DATASET_URN)).resolves.toMatchObject({
      completeness: {
        complete: false,
        reasonCodes: ["INCONSISTENT_PAGINATION"],
      },
    });
    expect(client.calls).toHaveLength(2);
    expect(catalog.getTrace().map(({ status }) => status)).toEqual(["ok", "ok"]);
  });

  it("fails closed on a repeated positive schema page without requesting forever", async () => {
    const repeated = jsonResult({
      urn: DATASET_URN,
      offset: 0,
      fields: [{ fieldPath: "customer_id" }],
      totalFields: 3,
      returned: 1,
      remainingCount: 2,
    });
    const client = new RecordingMcpClient([
      repeated,
      repeated,
      jsonResult({
        urn: DATASET_URN,
        offset: 2,
        fields: [{ fieldPath: "order_id" }],
        totalFields: 3,
        returned: 1,
        remainingCount: 1,
      }),
      jsonResult({
        urn: DATASET_URN,
        offset: 3,
        fields: [{ fieldPath: "created_at" }],
        totalFields: 3,
        returned: 1,
        remainingCount: 0,
      }),
    ]);
    const catalog = new DataHubMcpCatalog(client);

    await expect(catalog.listSchemaFields(DATASET_URN)).rejects.toMatchObject({
      code: "DATAHUB_UNAVAILABLE",
    });
    expect(client.calls).toHaveLength(2);
    expect(catalog.getTrace().map(({ status }) => status)).toEqual(["ok", "ok"]);
  });

  it("bounds the accepted schema field count", async () => {
    const client = new RecordingMcpClient([
      jsonResult({
        urn: DATASET_URN,
        offset: 0,
        fields: [{ fieldPath: "customer_id" }],
        totalFields: 10_001,
        returned: 1,
        remainingCount: 10_000,
      }),
    ]);
    const catalog = new DataHubMcpCatalog(client);

    await expect(catalog.listSchemaFields(DATASET_URN)).resolves.toMatchObject({
      completeness: {
        complete: false,
        reasonCodes: expect.arrayContaining(["ITEM_LIMIT_REACHED"]),
      },
    });
    expect(client.calls).toHaveLength(1);
    expect(catalog.getTrace().map(({ status }) => status)).toEqual(["ok"]);
  });

  it("bounds schema pagination even when every page reports progress", async () => {
    const client = new RecordingMcpClient(
      Array.from({ length: 101 }, (_, index) =>
        jsonResult({
          urn: DATASET_URN,
          offset: index,
          fields: [{ fieldPath: `field_${index}` }],
          totalFields: 101,
          returned: 1,
          remainingCount: 100 - index,
        }),
      ),
    );
    const catalog = new DataHubMcpCatalog(client);

    await expect(catalog.listSchemaFields(DATASET_URN)).resolves.toMatchObject({
      completeness: {
        complete: false,
        reasonCodes: expect.arrayContaining(["PAGE_LIMIT_REACHED"]),
      },
    });
    expect(client.calls).toHaveLength(100);
    expect(catalog.getTrace().at(-1)).toMatchObject({
      tool: "list_schema_fields",
      status: "ok",
    });
  });

  it("fails closed when any schema page identifies a different dataset URN", async () => {
    const mismatchedUrn =
      "urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.other_table,PROD)";
    const client = new RecordingMcpClient([
      jsonResult({
        urn: DATASET_URN,
        offset: 0,
        fields: [{ fieldPath: "customer_id" }],
        totalFields: 2,
        returned: 1,
        remainingCount: 1,
      }),
      jsonResult({
        urn: mismatchedUrn,
        offset: 1,
        fields: [{ fieldPath: "order_id" }],
        totalFields: 2,
        returned: 1,
        remainingCount: 0,
      }),
    ]);
    const catalog = new DataHubMcpCatalog(client);

    await expect(catalog.listSchemaFields(DATASET_URN)).rejects.toMatchObject({
      code: "DATAHUB_UNAVAILABLE",
      details: {},
    });
    expect(catalog.getTrace().map(({ status }) => status)).toEqual(["ok", "ok"]);
  });

  it("allocates concurrent trace IDs and ordering when calls complete in reverse", async () => {
    const searchResult = Promise.withResolvers<CallToolResult>();
    const schemaResult = Promise.withResolvers<CallToolResult>();
    const results = [searchResult.promise, schemaResult.promise];
    let callIndex = 0;
    const client: McpToolClient = {
      async callTool() {
        return results[callIndex++]!;
      },
      getServerInfo() {
        return {};
      },
      async close() {},
    };
    const catalog = new DataHubMcpCatalog(client);

    const search = catalog.searchDatasets("orders");
    const schema = catalog.listSchemaFields(DATASET_URN);
    schemaResult.resolve(
      jsonResult({
        urn: DATASET_URN,
        offset: 0,
        fields: [{ fieldPath: "customer_id" }],
        totalFields: 1,
        returned: 1,
        remainingCount: 0,
      }),
    );
    await schema;
    searchResult.resolve(jsonResult({ start: 0, count: 0, total: 0, searchResults: [] }));
    await search;

    expect(catalog.getTrace()).toMatchObject([
      {
        callId: "mcp-001",
        tool: "search",
        arguments: {
          query: "/q orders",
          filter: "entity_type = dataset",
          num_results: 50,
          offset: 0,
        },
        status: "ok",
      },
      {
        callId: "mcp-002",
        tool: "list_schema_fields",
        arguments: { urn: DATASET_URN, limit: 100, offset: 0 },
        status: "ok",
      },
    ]);
  });

  it("translates dependency failures and records only a safe error trace", async () => {
    const client: McpToolClient = {
      async callTool() {
        throw new Error("raw GMS failure with secret-token");
      },
      getServerInfo() {
        return {};
      },
      async close() {},
    };
    const catalog = new DataHubMcpCatalog(client, ["secret-token"]);

    const operation = catalog.searchDatasets("orders");
    await expect(operation).rejects.toBeInstanceOf(AppError);
    await expect(operation).rejects.toMatchObject({ code: "DATAHUB_UNAVAILABLE", details: {} });
    await expect(operation).rejects.not.toThrow("raw GMS failure with secret-token");
    expect(catalog.getTrace()).toMatchObject([
      {
        callId: "mcp-001",
        tool: "search",
        arguments: {
          query: "/q orders",
          filter: "entity_type = dataset",
          num_results: 50,
          offset: 0,
        },
        status: "error",
      },
    ]);
  });

  it("forwards cancellation to the MCP request without translating AbortError", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const client: McpToolClient = {
      async callTool(_request, options) {
        receivedSignal = options?.signal;
        return new Promise((_, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
            once: true,
          });
        });
      },
      getServerInfo() {
        return {};
      },
      async close() {},
    };
    const catalog = new DataHubMcpCatalog(client);

    const operation = catalog.searchDatasets("orders", { signal: controller.signal });
    controller.abort();

    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(receivedSignal).toBe(controller.signal);
    expect(catalog.getTrace()).toMatchObject([{ tool: "search", status: "error" }]);
  });

  it("treats malformed MCP payloads as safe failed calls", async () => {
    const client = new RecordingMcpClient([
      jsonResult({ searchResults: "raw malformed payload with secret-token" }),
    ]);
    const catalog = new DataHubMcpCatalog(client, ["secret-token"]);

    const operation = catalog.searchDatasets("orders");
    await expect(operation).rejects.toMatchObject({ code: "DATAHUB_UNAVAILABLE", details: {} });
    await expect(operation).rejects.not.toThrow("raw malformed payload with secret-token");
    expect(catalog.getTrace()).toMatchObject([
      {
        callId: "mcp-001",
        tool: "search",
        arguments: {
          query: "/q orders",
          filter: "entity_type = dataset",
          num_results: 50,
          offset: 0,
        },
        status: "error",
      },
    ]);
  });

  it("closes its MCP client", async () => {
    const client = new RecordingMcpClient([]);
    const catalog = new DataHubMcpCatalog(client);

    await catalog.close();

    expect(client.closeCount).toBe(1);
  });

  it("translates close failures without exposing dependency details", async () => {
    const client: McpToolClient = {
      async callTool() {
        return jsonResult({});
      },
      getServerInfo() {
        return {};
      },
      async close() {
        throw new Error("raw close failure with secret-token");
      },
    };
    const catalog = new DataHubMcpCatalog(client, ["secret-token"]);

    const operation = catalog.close();
    await expect(operation).rejects.toMatchObject({ code: "MCP_UNAVAILABLE", details: {} });
    await expect(operation).rejects.not.toThrow("raw close failure with secret-token");
  });
});

describe("dataHubMcpServerParameters", () => {
  it("pins DataHub MCP 0.6.0 to stdio with only the required read-only environment", () => {
    const config = loadRuntimeConfig({
      DATAHUB_GMS_URL: "http://localhost:8080",
      DATAHUB_GMS_TOKEN: "local-test-token",
      DATAHUB_MCP_UVX_PATH: "custom-uvx",
    });

    expect(dataHubMcpServerParameters(config)).toEqual({
      command: "custom-uvx",
      args: ["mcp-server-datahub@0.6.0", "--transport", "stdio"],
      env: {
        DATAHUB_GMS_URL: "http://localhost:8080",
        DATAHUB_GMS_TOKEN: "local-test-token",
        TOOLS_IS_MUTATION_ENABLED: "false",
        TOOLS_IS_USER_ENABLED: "false",
        DATAHUB_MCP_DOCUMENT_TOOLS_DISABLED: "true",
        SAVE_DOCUMENT_TOOL_ENABLED: "false",
        DATA_QUALITY_TOOLS_ENABLED: "false",
        SEMANTIC_SEARCH_ENABLED: "false",
      },
      stderr: "pipe",
    });
  });

  it("returns a client boundary directly compatible with the catalog and preserves close", async () => {
    let closeCount = 0;
    const sdkClient = {
      async callTool() {
        return jsonResult({ start: 0, count: 0, total: 0, searchResults: [] });
      },
      getServerVersion() {
        return undefined;
      },
      async close() {
        closeCount += 1;
      },
    };
    const client = toDataHubMcpToolClient(sdkClient);
    const catalog = new DataHubMcpCatalog(client);

    await expect(catalog.searchDatasets("orders")).resolves.toMatchObject({
      items: [],
      completeness: { complete: true },
    });
    await catalog.close();

    expect(closeCount).toBe(1);
    const connect: (config: ReturnType<typeof loadRuntimeConfig>) => Promise<McpToolClient> =
      connectDataHubMcp;
    expect(connect).toBe(connectDataHubMcp);
  });

  it("rejects unsupported SDK task results without exposing their payload", async () => {
    const sdkClient = {
      async callTool() {
        return { toolResult: { detail: "raw task payload with secret-token" } };
      },
      getServerVersion() {
        return undefined;
      },
      async close() {},
    };
    const client = toDataHubMcpToolClient(sdkClient);
    const operation = client.callTool({ name: "search", arguments: {} });

    await expect(operation).rejects.toThrow("DataHub MCP returned an unsupported task result.");
    await expect(operation).rejects.not.toThrow("raw task payload with secret-token");
  });

  it("redacts secrets split across stderr chunks and keeps the collector bounded", () => {
    let collected = "";
    collected = appendBoundedRedactedStderr(collected, "before local-test-", ["local-test-token"]);
    collected = appendBoundedRedactedStderr(collected, "token after", ["local-test-token"]);

    expect(collected).toBe("before [REDACTED] after");
    collected = appendBoundedRedactedStderr(collected, "x".repeat(5_000), ["local-test-token"]);
    expect(collected.length).toBeLessThanOrEqual(4_096);
    expect(collected).not.toContain("local-test-token");
  });
});
