import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { output } from "zod";
import type { CollectionResult, DataHubCatalog, DataHubServerInfo } from "../datahub/catalog.js";
import type {
  EntityContext,
  EntityContextIncompleteReasonCode,
  LineageAsset,
  SchemaField,
  ToolTraceEntry,
} from "../domain/evidence.js";
import type { DatasetCandidate } from "../domain/resolve-dataset.js";
import { fixtureSchemas, type FixtureName } from "./fixture-schemas.js";

const DATASET_URN =
  "urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details,PROD)";

type FixtureData<Name extends FixtureName> = output<(typeof fixtureSchemas)[Name]>;

function readFixture(
  name: "search-order-details.json",
): Promise<FixtureData<"search-order-details.json">>;
function readFixture(
  name: "schema-order-details.json",
): Promise<FixtureData<"schema-order-details.json">>;
function readFixture(
  name: "lineage-order-details-table.json",
): Promise<FixtureData<"lineage-order-details-table.json">>;
function readFixture(
  name: "lineage-order-details-customer-id.json",
): Promise<FixtureData<"lineage-order-details-customer-id.json">>;
function readFixture(
  name: "entity-context-order-details-impact.json",
): Promise<FixtureData<"entity-context-order-details-impact.json">>;
async function readFixture(name: FixtureName): Promise<unknown> {
  const unsafe: unknown = JSON.parse(
    await readFile(resolve(process.cwd(), "tests", "fixtures", "datahub", name), "utf8"),
  );
  return fixtureSchemas[name].parse(unsafe);
}

export class FixtureCatalog implements DataHubCatalog {
  readonly #trace: ToolTraceEntry[] = [];

  async searchDatasets(
    _hint: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<CollectionResult<DatasetCandidate>> {
    options?.signal?.throwIfAborted();
    this.#trace.push({
      callId: "mcp-001",
      tool: "search",
      arguments: {
        query: "/q snowflake+b2fd91+order_entry_db+analytics+order_details",
        filter: "entity_type = dataset",
        num_results: 50,
        offset: 0,
      },
      at: "2026-07-22T12:00:00.000Z",
      page: 1,
      status: "ok",
    });
    const fixture = await readFixture("search-order-details.json");
    return {
      completeness: fixture.completeness,
      items: fixture.items.map(({ urn, name, platform, environment }) => ({
        urn,
        name,
        ...(platform === undefined ? {} : { platform }),
        ...(environment === undefined ? {} : { environment }),
      })),
    };
  }

  async listSchemaFields(
    _datasetUrn: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<CollectionResult<SchemaField>> {
    options?.signal?.throwIfAborted();
    this.#trace.push({
      callId: "mcp-002",
      tool: "list_schema_fields",
      arguments: { urn: DATASET_URN, limit: 100, offset: 0 },
      at: "2026-07-22T12:00:00.000Z",
      page: 1,
      status: "ok",
    });
    const fixture = await readFixture("schema-order-details.json");
    return {
      completeness: fixture.completeness,
      items: fixture.items.map(
        ({ fieldPath, nativeDataType, nullable, description }): SchemaField => ({
          fieldPath,
          ...(nativeDataType === undefined ? {} : { nativeDataType }),
          ...(nullable === undefined ? {} : { nullable }),
          ...(description === undefined ? {} : { description }),
        }),
      ),
    };
  }

  async getDownstreamLineage(
    _datasetUrn: string,
    options: { readonly column?: string; readonly maxHops: 2; readonly signal?: AbortSignal },
  ): Promise<CollectionResult<LineageAsset>> {
    options.signal?.throwIfAborted();
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
      at: "2026-07-22T12:00:00.000Z",
      page: 1,
      status: "ok",
    });
    const fixture = await (options.column
      ? readFixture("lineage-order-details-customer-id.json")
      : readFixture("lineage-order-details-table.json"));
    return {
      completeness: fixture.completeness,
      items: fixture.items.map(({ urn, name, platform, hop, lineageColumns }): LineageAsset => ({
        urn,
        hop,
        lineageColumns,
        ...(name === undefined ? {} : { name }),
        ...(platform === undefined ? {} : { platform }),
      })),
    };
  }

  async getEntityContext(
    urns: readonly string[],
    options?: { readonly signal?: AbortSignal },
  ): Promise<CollectionResult<EntityContext, EntityContextIncompleteReasonCode>> {
    options?.signal?.throwIfAborted();
    const requested = [...new Set(urns)].sort((left, right) => left.localeCompare(right, "en-US"));
    for (let offset = 0; offset < requested.length; offset += 10) {
      this.#trace.push({
        callId: `mcp-${String(this.#trace.length + 1).padStart(3, "0")}`,
        tool: "get_entities",
        arguments: { urns: requested.slice(offset, offset + 10) },
        at: "2026-07-22T12:00:00.000Z",
        page: offset / 10 + 1,
        status: "ok",
      });
    }
    const fixture = await readFixture("entity-context-order-details-impact.json");
    const requestedSet = new Set(requested);
    const items: EntityContext[] = fixture.items
      .filter(({ urn }) => requestedSet.has(urn))
      .map(
        ({
          urn,
          entityType,
          name,
          platform,
          description,
          owners,
          tags,
          glossaryTerms,
          siblingUrns,
          qualitySignals,
        }): EntityContext => ({
          urn,
          entityType,
          owners,
          tags,
          glossaryTerms,
          siblingUrns,
          qualitySignals,
          ...(name === undefined ? {} : { name }),
          ...(platform === undefined ? {} : { platform }),
          ...(description === undefined ? {} : { description }),
        }),
      )
      .sort((left, right) => left.urn.localeCompare(right.urn, "en-US"));
    const missing = requested.some((urn) => !items.some((item) => item.urn === urn));
    const pages = Math.ceil(requested.length / 10);
    return {
      items,
      completeness: {
        complete: !missing,
        pages,
        itemCount: items.length,
        offsets: Array.from({ length: pages }, (_, page) => page * 10),
        reasonCodes: missing ? ["ENTITY_CONTEXT_UNAVAILABLE"] : [],
      },
    };
  }

  getServerInfo(): DataHubServerInfo {
    return { reportedServerName: "fixture", reportedServerVersion: "replay-v1" };
  }

  getTrace(): readonly ToolTraceEntry[] {
    return this.#trace;
  }

  async close(): Promise<void> {}
}
