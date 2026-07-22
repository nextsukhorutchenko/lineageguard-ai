import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CollectionResult, DataHubCatalog, DataHubServerInfo } from "../catalog.js";
import type {
  CollectionCompleteness,
  EntityContext,
  EntityContextIncompleteReasonCode,
  LineageAsset,
  RequiredIncompleteReasonCode,
  SchemaField,
  ToolTraceEntry,
} from "../../domain/evidence.js";
import type { DatasetCandidate } from "../../domain/resolve-dataset.js";
import { AppError } from "../../errors/app-error.js";
import { redact } from "../../security/redact.js";
import { decodeJsonToolResult } from "./decode-tool-result.js";
import {
  getEntitiesResponseSchema,
  lineageResponseSchema,
  schemaResponseSchema,
  searchResponseSchema,
} from "./schemas.js";

type ReadToolName = ToolTraceEntry["tool"];

const SEARCH_PAGE_SIZE = 50;
const MAX_SEARCH_PAGES = 20;
const MAX_SEARCH_ITEMS = 1_000;
const SCHEMA_PAGE_SIZE = 100;
const MAX_SCHEMA_PAGES = 100;
const MAX_SCHEMA_FIELDS = 10_000;
const LINEAGE_PAGE_SIZE = 100;
const MAX_LINEAGE_PAGES = 20;
const MAX_LINEAGE_ITEMS = 100;
const ENTITY_BATCH_SIZE = 10;
const MAX_CONTEXT_ENTITIES = 50;
export const MAX_ENTITY_CONTEXT_BYTES = 100_000;

const compareEnglish = (left: string, right: string): number => left.localeCompare(right, "en-US");

export interface ToolCallRequest {
  readonly name: ReadToolName;
  readonly arguments: Record<string, unknown>;
}

export interface McpToolClient {
  callTool(
    request: ToolCallRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<CallToolResult>;
  getServerInfo(): DataHubServerInfo;
  close(): Promise<void>;
}

function withOptional<T extends object, K extends string, V>(
  value: T,
  key: K,
  optionalValue: V | undefined,
): T & Partial<Record<K, V>> {
  return optionalValue === undefined ? value : { ...value, [key]: optionalValue };
}

function completeness<R extends string>(
  pages: number,
  itemCount: number,
  offsets: readonly number[],
  reasons: Iterable<R>,
): CollectionCompleteness<R> {
  const reasonCodes = [...new Set(reasons)].sort(compareEnglish);
  return {
    complete: reasonCodes.length === 0,
    pages,
    itemCount,
    offsets: [...offsets],
    reasonCodes,
  };
}

function bounded(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  return Array.from(value).slice(0, max).join("");
}

function boundedStrings(values: readonly string[], maxLength: number): readonly string[] {
  return [...new Set(values.map((value) => bounded(value, maxLength)!).filter(Boolean))]
    .sort(compareEnglish)
    .slice(0, 20);
}

export class DataHubMcpCatalog implements DataHubCatalog {
  readonly #trace: Array<ToolTraceEntry | undefined> = [];
  #nextCallNumber = 1;

  constructor(
    private readonly client: McpToolClient,
    private readonly secrets: readonly string[] = [],
  ) {}

  async searchDatasets(
    hint: string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<CollectionResult<DatasetCandidate>> {
    const candidates = new Map<string, DatasetCandidate>();
    const offsets: number[] = [];
    const reasons = new Set<RequiredIncompleteReasonCode>();
    const fingerprints = new Set<string>();
    let offset = 0;
    let expectedTotal: number | undefined;

    while (true) {
      if (offsets.length >= MAX_SEARCH_PAGES) {
        reasons.add("PAGE_LIMIT_REACHED");
        reasons.add("HAS_MORE");
        break;
      }
      offsets.push(offset);
      const parsed = await this.call(
        {
          name: "search",
          arguments: {
            query: `/q ${hint.replace(/[^a-zA-Z0-9_]+/g, "+")}`,
            filter: "entity_type = dataset",
            num_results: SEARCH_PAGE_SIZE,
            offset,
          },
        },
        (response) => searchResponseSchema.parse(response),
        options.signal,
        offsets.length,
      );
      if (
        parsed.start !== offset ||
        parsed.count !== parsed.searchResults.length ||
        parsed.count > SEARCH_PAGE_SIZE ||
        parsed.start + parsed.count > parsed.total
      ) {
        throw this.unavailable();
      }
      if (expectedTotal !== undefined && expectedTotal !== parsed.total) {
        reasons.add("INCONSISTENT_PAGINATION");
        break;
      }
      expectedTotal ??= parsed.total;
      const fingerprint = parsed.searchResults.map(({ entity }) => entity.urn).join("\u0000");
      if (fingerprints.has(fingerprint) && parsed.count > 0) {
        reasons.add("REPEATED_PAGE");
        reasons.add("HAS_MORE");
        break;
      }
      fingerprints.add(fingerprint);
      const before = candidates.size;
      for (const { entity } of parsed.searchResults) {
        if (candidates.has(entity.urn)) continue;
        const name = entity.name ?? entity.properties?.name ?? entity.urn;
        candidates.set(
          entity.urn,
          withOptional({ urn: entity.urn, name }, "platform", entity.platform?.name),
        );
      }
      const hasMore = parsed.start + parsed.count < parsed.total;
      if (!hasMore) break;
      if (candidates.size >= MAX_SEARCH_ITEMS || parsed.total > MAX_SEARCH_ITEMS) {
        reasons.add("ITEM_LIMIT_REACHED");
        reasons.add("HAS_MORE");
        break;
      }
      if (parsed.count === 0 || candidates.size === before) {
        reasons.add("NO_PROGRESS");
        reasons.add("HAS_MORE");
        break;
      }
      offset += parsed.count;
    }

    const items = [...candidates.values()].sort((left, right) =>
      compareEnglish(left.urn, right.urn),
    );
    return { items, completeness: completeness(offsets.length, items.length, offsets, reasons) };
  }

  async listSchemaFields(
    datasetUrn: string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<CollectionResult<SchemaField>> {
    const fields = new Map<string, SchemaField>();
    const offsets: number[] = [];
    const reasons = new Set<RequiredIncompleteReasonCode>();
    const fingerprints = new Set<string>();
    let offset = 0;
    let expectedTotal: number | undefined;

    while (true) {
      if (offsets.length >= MAX_SCHEMA_PAGES) {
        reasons.add("PAGE_LIMIT_REACHED");
        reasons.add("HAS_MORE");
        break;
      }
      offsets.push(offset);
      const parsed = await this.call(
        {
          name: "list_schema_fields",
          arguments: { urn: datasetUrn, limit: SCHEMA_PAGE_SIZE, offset },
        },
        (response) => schemaResponseSchema.parse(response),
        options.signal,
        offsets.length,
      );
      if (parsed.urn !== datasetUrn || parsed.offset !== offset) throw this.unavailable();
      if (
        parsed.returned !== parsed.fields.length ||
        parsed.returned > SCHEMA_PAGE_SIZE ||
        offset + parsed.returned + parsed.remainingCount !== parsed.totalFields ||
        (expectedTotal !== undefined && expectedTotal !== parsed.totalFields)
      ) {
        reasons.add("INCONSISTENT_PAGINATION");
        break;
      }
      expectedTotal ??= parsed.totalFields;
      const fingerprint = parsed.fields.map(({ fieldPath }) => fieldPath).join("\u0000");
      if (fingerprints.has(fingerprint) && parsed.returned > 0) {
        reasons.add("REPEATED_PAGE");
        reasons.add("HAS_MORE");
        break;
      }
      fingerprints.add(fingerprint);
      const before = fields.size;
      for (const field of parsed.fields) {
        if (fields.has(field.fieldPath)) continue;
        let normalized: SchemaField = { fieldPath: field.fieldPath };
        normalized = withOptional(normalized, "nativeDataType", field.nativeDataType);
        normalized = withOptional(normalized, "nullable", field.nullable);
        normalized = withOptional(normalized, "description", field.description);
        fields.set(field.fieldPath, normalized);
      }
      if (parsed.remainingCount === 0) break;
      if (fields.size >= MAX_SCHEMA_FIELDS || parsed.totalFields > MAX_SCHEMA_FIELDS) {
        reasons.add("ITEM_LIMIT_REACHED");
        reasons.add("HAS_MORE");
        break;
      }
      if (parsed.returned === 0 || fields.size === before) {
        reasons.add("NO_PROGRESS");
        reasons.add("HAS_MORE");
        break;
      }
      offset += parsed.returned;
    }
    const items = [...fields.values()].sort((left, right) =>
      compareEnglish(left.fieldPath, right.fieldPath),
    );
    return { items, completeness: completeness(offsets.length, items.length, offsets, reasons) };
  }

  async getDownstreamLineage(
    datasetUrn: string,
    options: { readonly column?: string; readonly maxHops: 2; readonly signal?: AbortSignal },
  ): Promise<CollectionResult<LineageAsset>> {
    const assets = new Map<string, LineageAsset>();
    const offsets: number[] = [];
    const reasons = new Set<RequiredIncompleteReasonCode>();
    const fingerprints = new Set<string>();
    let offset = 0;

    while (true) {
      if (offsets.length >= MAX_LINEAGE_PAGES) {
        reasons.add("PAGE_LIMIT_REACHED");
        reasons.add("HAS_MORE");
        break;
      }
      offsets.push(offset);
      const parsed = await this.call(
        {
          name: "get_lineage",
          arguments: {
            urn: datasetUrn,
            column: options.column ?? null,
            upstream: false,
            max_hops: options.maxHops,
            max_results: LINEAGE_PAGE_SIZE,
            offset,
          },
        },
        (response) => lineageResponseSchema.parse(response),
        options.signal,
        offsets.length,
      );
      const direction = parsed.downstreams;
      const results = direction?.searchResults ?? [];
      const returned = direction?.returned ?? results.length;
      const returnedOffset = direction?.offset ?? offset;
      const hasMore = direction?.hasMore ?? false;
      if (returnedOffset !== offset) throw this.unavailable();
      if (returned !== results.length || returned > LINEAGE_PAGE_SIZE) {
        reasons.add("INCONSISTENT_PAGINATION");
        break;
      }
      if (direction?.truncatedDueToTokenBudget === true) {
        reasons.add("TOKEN_BUDGET_TRUNCATION");
      }
      const fingerprint = results.map(({ entity }) => entity.urn).join("\u0000");
      if (fingerprints.has(fingerprint) && returned > 0) {
        reasons.add("REPEATED_PAGE");
        if (hasMore) reasons.add("HAS_MORE");
        break;
      }
      fingerprints.add(fingerprint);
      const before = assets.size;
      for (const result of results) {
        const existing = assets.get(result.entity.urn);
        let asset: LineageAsset = {
          urn: result.entity.urn,
          hop: result.degree,
          lineageColumns: [...new Set(result.lineageColumns)].sort(compareEnglish),
        };
        asset = withOptional(asset, "name", result.entity.name);
        asset = withOptional(asset, "platform", result.entity.platform?.name);
        if (existing === undefined || asset.hop < existing.hop) assets.set(asset.urn, asset);
      }
      if (assets.size >= MAX_LINEAGE_ITEMS) {
        reasons.add("ITEM_LIMIT_REACHED");
        break;
      }
      if (!hasMore) break;
      if (returned === 0 || assets.size === before) {
        reasons.add("NO_PROGRESS");
        reasons.add("HAS_MORE");
        break;
      }
      offset += returned;
    }
    const items = [...assets.values()].sort((left, right) => compareEnglish(left.urn, right.urn));
    return { items, completeness: completeness(offsets.length, items.length, offsets, reasons) };
  }

  async getEntityContext(
    urns: readonly string[],
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<CollectionResult<EntityContext, EntityContextIncompleteReasonCode>> {
    const requested = [...new Set(urns)].sort(compareEnglish);
    const selected = requested.slice(0, MAX_CONTEXT_ENTITIES);
    const reasons = new Set<EntityContextIncompleteReasonCode>();
    if (requested.length > selected.length) reasons.add("ENTITY_CONTEXT_TRUNCATED");
    const offsets: number[] = [];
    const items: EntityContext[] = [];

    outer: for (let offset = 0; offset < selected.length; offset += ENTITY_BATCH_SIZE) {
      const batch = selected.slice(offset, offset + ENTITY_BATCH_SIZE);
      offsets.push(offset);
      const parsed = await this.call(
        { name: "get_entities", arguments: { urns: batch } },
        (response) => getEntitiesResponseSchema.parse(response),
        options.signal,
        offsets.length,
      );
      const batchSet = new Set(batch);
      const returned = new Set<string>();
      for (const entry of parsed) {
        if (!batchSet.has(entry.urn) || returned.has(entry.urn)) throw this.unavailable();
        returned.add(entry.urn);
      }
      for (const entry of [...parsed].sort((left, right) => compareEnglish(left.urn, right.urn))) {
        if ("error" in entry) {
          reasons.add("ENTITY_CONTEXT_UNAVAILABLE");
          continue;
        }
        const owners = entry.ownership?.owners.map(({ owner }) => owner.urn) ?? [];
        const tags = entry.tags?.tags.map(({ tag }) => tag.urn) ?? [];
        const glossaryTerms = entry.glossaryTerms?.terms.map(({ term }) => term.urn) ?? [];
        const siblingUrns =
          entry.siblings?.siblings.map((sibling) =>
            String("urn" in sibling ? sibling.urn : sibling.sibling.urn),
          ) ?? [];
        const qualitySignals = [
          ...(entry.dataQuality?.assertions.map(({ status }) => String(status)) ?? []),
          ...(entry.quality?.signals.map(({ status }) => String(status)) ?? []),
        ];
        let entity: EntityContext = {
          urn: bounded(entry.urn, 500)!,
          entityType: bounded(entry.type, 100) ?? "UNKNOWN",
          owners: boundedStrings(owners, 500),
          tags: boundedStrings(tags, 500),
          glossaryTerms: boundedStrings(glossaryTerms, 500),
          siblingUrns: boundedStrings(siblingUrns, 500),
          qualitySignals: boundedStrings(qualitySignals, 100),
        };
        entity = withOptional(entity, "name", bounded(entry.name ?? entry.properties?.name, 500));
        entity = withOptional(entity, "platform", bounded(entry.platform?.name, 100));
        entity = withOptional(entity, "description", bounded(entry.properties?.description, 2_000));
        const prospective = [...items, entity].sort((left, right) =>
          compareEnglish(left.urn, right.urn),
        );
        if (Buffer.byteLength(JSON.stringify(prospective), "utf8") > MAX_ENTITY_CONTEXT_BYTES) {
          reasons.add("ENTITY_CONTEXT_TRUNCATED");
          break outer;
        }
        items.push(entity);
      }
      if (batch.some((urn) => !returned.has(urn))) reasons.add("ENTITY_CONTEXT_UNAVAILABLE");
    }

    items.sort((left, right) => compareEnglish(left.urn, right.urn));
    return {
      items,
      completeness: completeness(offsets.length, items.length, offsets, reasons),
    };
  }

  getServerInfo(): DataHubServerInfo {
    return this.client.getServerInfo();
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

  private async call<T>(
    request: ToolCallRequest,
    parse: (response: unknown) => T,
    signal: AbortSignal | undefined,
    page: number,
  ): Promise<T> {
    signal?.throwIfAborted();
    const callNumber = this.#nextCallNumber++;
    const traceIndex = callNumber - 1;
    const traceEntry = {
      callId: `mcp-${String(callNumber).padStart(3, "0")}`,
      tool: request.name,
      arguments: redact(request.arguments, this.secrets) as Record<string, unknown>,
      at: new Date().toISOString(),
      page,
    };
    this.#trace[traceIndex] = undefined;

    try {
      const result = await this.client.callTool(
        request,
        signal === undefined ? undefined : { signal },
      );
      signal?.throwIfAborted();
      const parsed = parse(decodeJsonToolResult(result));
      this.#trace[traceIndex] = { ...traceEntry, status: "ok" };
      return parsed;
    } catch {
      this.#trace[traceIndex] = { ...traceEntry, status: "error" };
      if (signal?.aborted) signal.throwIfAborted();
      throw this.unavailable();
    }
  }

  private unavailable(): AppError {
    return new AppError("DATAHUB_UNAVAILABLE", "DataHub is unavailable through the MCP adapter.");
  }
}
