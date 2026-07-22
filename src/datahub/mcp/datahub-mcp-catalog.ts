import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { DataHubCatalog } from "../catalog.js";
import type { LineageAsset, SchemaField, ToolTraceEntry } from "../../domain/evidence.js";
import type { DatasetCandidate } from "../../domain/resolve-dataset.js";
import { AppError } from "../../errors/app-error.js";
import { redact } from "../../security/redact.js";
import { decodeJsonToolResult } from "./decode-tool-result.js";
import { lineageResponseSchema, schemaResponseSchema, searchResponseSchema } from "./schemas.js";

type ReadToolName = ToolTraceEntry["tool"];

export interface ToolCallRequest {
  readonly name: ReadToolName;
  readonly arguments: Record<string, unknown>;
}

export interface McpToolClient {
  callTool(request: ToolCallRequest): Promise<CallToolResult>;
  close(): Promise<void>;
}

function withOptional<T extends object, K extends string, V>(
  value: T,
  key: K,
  optionalValue: V | undefined,
): T & Partial<Record<K, V>> {
  return optionalValue === undefined ? value : { ...value, [key]: optionalValue };
}

export class DataHubMcpCatalog implements DataHubCatalog {
  readonly #trace: Array<ToolTraceEntry | undefined> = [];
  #nextCallNumber = 1;

  constructor(
    private readonly client: McpToolClient,
    private readonly secrets: readonly string[] = [],
  ) {}

  async searchDatasets(hint: string): Promise<readonly DatasetCandidate[]> {
    const parsed = await this.call(
      {
        name: "search",
        arguments: {
          query: `/q ${hint.replace(/[^a-zA-Z0-9_]+/g, "+")}`,
          filter: "entity_type = dataset",
          num_results: 50,
          offset: 0,
        },
      },
      (response) => searchResponseSchema.parse(response),
    );
    const candidates: DatasetCandidate[] = [];

    for (const { entity } of parsed.searchResults) {
      if (entity.name === undefined) continue;
      candidates.push(
        withOptional({ urn: entity.urn, name: entity.name }, "platform", entity.platform?.name),
      );
    }

    return candidates;
  }

  async listSchemaFields(datasetUrn: string): Promise<readonly SchemaField[]> {
    const fields: SchemaField[] = [];
    let offset = 0;

    while (true) {
      const parsed = await this.call(
        {
          name: "list_schema_fields",
          arguments: { urn: datasetUrn, limit: 100, offset },
        },
        (response) => schemaResponseSchema.parse(response),
      );

      for (const field of parsed.fields) {
        let normalized: SchemaField = { fieldPath: field.fieldPath };
        normalized = withOptional(normalized, "nativeDataType", field.nativeDataType);
        normalized = withOptional(normalized, "nullable", field.nullable);
        normalized = withOptional(normalized, "description", field.description);
        fields.push(normalized);
      }

      if (parsed.remainingCount === 0) return fields;
      if (parsed.returned === 0) {
        throw this.unavailable();
      }
      offset += parsed.returned;
    }
  }

  async getDownstreamLineage(
    datasetUrn: string,
    options: { readonly column?: string; readonly maxHops: 2 },
  ): Promise<readonly LineageAsset[]> {
    const parsed = await this.call(
      {
        name: "get_lineage",
        arguments: {
          urn: datasetUrn,
          column: options.column ?? null,
          upstream: false,
          max_hops: options.maxHops,
          max_results: 100,
          offset: 0,
        },
      },
      (response) => lineageResponseSchema.parse(response),
    );

    return (parsed.downstreams?.searchResults ?? []).map((result) => {
      let asset: LineageAsset = {
        urn: result.entity.urn,
        hop: result.degree,
        lineageColumns: result.lineageColumns,
      };
      asset = withOptional(asset, "name", result.entity.name);
      asset = withOptional(asset, "platform", result.entity.platform?.name);
      return asset;
    });
  }

  getTrace(): readonly ToolTraceEntry[] {
    const completed: ToolTraceEntry[] = [];
    for (const entry of this.#trace) {
      if (entry === undefined) break;
      completed.push(entry);
    }
    return completed;
  }

  async close(): Promise<void> {
    try {
      await this.client.close();
    } catch {
      throw new AppError("MCP_UNAVAILABLE", "The DataHub MCP client could not be closed.");
    }
  }

  private async call<T>(request: ToolCallRequest, parse: (response: unknown) => T): Promise<T> {
    const callNumber = this.#nextCallNumber++;
    const traceIndex = callNumber - 1;
    const traceEntry = {
      callId: `mcp-${String(callNumber).padStart(3, "0")}`,
      tool: request.name,
      arguments: redact(request.arguments, this.secrets) as Record<string, unknown>,
    };
    this.#trace[traceIndex] = undefined;

    try {
      const result = await this.client.callTool(request);
      const decoded = decodeJsonToolResult(result);
      const parsed = parse(decoded);
      this.#trace[traceIndex] = { ...traceEntry, status: "ok" };
      return parsed;
    } catch {
      this.#trace[traceIndex] = { ...traceEntry, status: "error" };
      throw this.unavailable();
    }
  }

  private unavailable(): AppError {
    return new AppError("DATAHUB_UNAVAILABLE", "DataHub is unavailable through the MCP adapter.");
  }
}
