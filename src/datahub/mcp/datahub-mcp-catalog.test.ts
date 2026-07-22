import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "../../config/runtime-config.js";
import { AppError } from "../../errors/app-error.js";
import {
  DataHubMcpCatalog,
  type McpToolClient,
  type ToolCallRequest,
} from "./datahub-mcp-catalog.js";
import { dataHubMcpServerParameters } from "./mcp-client.js";

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
}

describe("DataHubMcpCatalog", () => {
  it("normalizes search, schema, table lineage, and column lineage through exact read calls", async () => {
    const client = new RecordingMcpClient([
      jsonResult({
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
    ).resolves.toEqual([
      {
        urn: DATASET_URN,
        name: "b2fd91.order_entry_db.analytics.order_details",
        platform: "snowflake",
      },
    ]);
    await expect(catalog.listSchemaFields(DATASET_URN)).resolves.toEqual([
      {
        fieldPath: "customer_id",
        nativeDataType: "NUMBER(38,0)",
        nullable: false,
        description: "Customer identifier",
      },
    ]);
    await expect(catalog.getDownstreamLineage(DATASET_URN, { maxHops: 2 })).resolves.toEqual([
      {
        urn: DOWNSTREAM_URN,
        name: "customer_orders",
        platform: "snowflake",
        hop: 1,
        lineageColumns: [],
      },
    ]);
    await expect(
      catalog.getDownstreamLineage(DATASET_URN, {
        column: "customer_id",
        maxHops: 2,
      }),
    ).resolves.toEqual([
      {
        urn: DOWNSTREAM_URN,
        name: "customer_orders",
        platform: "snowflake",
        hop: 1,
        lineageColumns: ["customer_id"],
      },
    ]);

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

    expect(catalog.getTrace()).toEqual([
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

  it("paginates schema fields until DataHub reports none remaining", async () => {
    const client = new RecordingMcpClient([
      jsonResult({
        urn: DATASET_URN,
        fields: [{ fieldPath: "customer_id" }],
        totalFields: 2,
        returned: 1,
        remainingCount: 1,
      }),
      jsonResult({
        urn: DATASET_URN,
        fields: [{ fieldPath: "order_id" }],
        totalFields: 2,
        returned: 1,
        remainingCount: 0,
      }),
    ]);
    const catalog = new DataHubMcpCatalog(client);

    await expect(catalog.listSchemaFields(DATASET_URN)).resolves.toEqual([
      { fieldPath: "customer_id" },
      { fieldPath: "order_id" },
    ]);
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

  it("translates dependency failures and records only a safe error trace", async () => {
    const client: McpToolClient = {
      async callTool() {
        throw new Error("raw GMS failure with secret-token");
      },
      async close() {},
    };
    const catalog = new DataHubMcpCatalog(client, ["secret-token"]);

    const operation = catalog.searchDatasets("orders");
    await expect(operation).rejects.toBeInstanceOf(AppError);
    await expect(operation).rejects.toMatchObject({ code: "DATAHUB_UNAVAILABLE", details: {} });
    await expect(operation).rejects.not.toThrow("raw GMS failure with secret-token");
    expect(catalog.getTrace()).toEqual([
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

  it("treats malformed MCP payloads as safe failed calls", async () => {
    const client = new RecordingMcpClient([
      jsonResult({ searchResults: "raw malformed payload with secret-token" }),
    ]);
    const catalog = new DataHubMcpCatalog(client, ["secret-token"]);

    const operation = catalog.searchDatasets("orders");
    await expect(operation).rejects.toMatchObject({ code: "DATAHUB_UNAVAILABLE", details: {} });
    await expect(operation).rejects.not.toThrow("raw malformed payload with secret-token");
    expect(catalog.getTrace()).toEqual([
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
        DATAHUB_MCP_DOCUMENT_TOOLS_DISABLED: "true",
        SAVE_DOCUMENT_TOOL_ENABLED: "false",
      },
      stderr: "pipe",
    });
  });
});
