import { describe, expect, it } from "vitest";
import { FixtureCatalog } from "./fixture-catalog.js";

const DATASET_URN =
  "urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details,PROD)";

describe("FixtureCatalog", () => {
  it("replays the exact target, source field, and 24/11 lineage collections", async () => {
    const catalog = new FixtureCatalog();

    const search = await catalog.searchDatasets(
      "snowflake:b2fd91.order_entry_db.analytics.order_details",
    );
    const schema = await catalog.listSchemaFields(DATASET_URN);
    const tableLineage = await catalog.getDownstreamLineage(DATASET_URN, { maxHops: 2 });
    const columnLineage = await catalog.getDownstreamLineage(DATASET_URN, {
      column: "customer_id",
      maxHops: 2,
    });

    expect(search.items).toContainEqual(
      expect.objectContaining({ urn: DATASET_URN, name: "ORDER_DETAILS" }),
    );
    expect(search.completeness).toEqual({
      complete: true,
      pages: 1,
      itemCount: 12,
      offsets: [0],
      reasonCodes: [],
    });
    expect(schema.items).toContainEqual(
      expect.objectContaining({
        fieldPath: "customer_id",
        nativeDataType: "NUMBER(38,0)",
      }),
    );
    expect(tableLineage.items).toHaveLength(24);
    expect(new Set(tableLineage.items.map(({ urn }) => urn))).toHaveLength(24);
    expect(columnLineage.items).toHaveLength(11);
    expect(new Set(columnLineage.items.map(({ urn }) => urn))).toHaveLength(11);
    expect(tableLineage.completeness.complete).toBe(true);
    expect(columnLineage.completeness.complete).toBe(true);
  });

  it("replays 25 sorted entity records in three exact request batches", async () => {
    const catalog = new FixtureCatalog();
    await catalog.searchDatasets("snowflake:b2fd91.order_entry_db.analytics.order_details");
    await catalog.listSchemaFields(DATASET_URN);
    const tableLineage = await catalog.getDownstreamLineage(DATASET_URN, { maxHops: 2 });
    await catalog.getDownstreamLineage(DATASET_URN, {
      column: "customer_id",
      maxHops: 2,
    });
    const requested = [DATASET_URN, ...tableLineage.items.map(({ urn }) => urn)].sort(
      (left, right) => left.localeCompare(right, "en-US"),
    );

    const result = await catalog.getEntityContext(requested);

    expect(result.items.map(({ urn }) => urn)).toEqual(requested);
    expect(result.completeness).toEqual({
      complete: true,
      pages: 3,
      itemCount: 25,
      offsets: [0, 10, 20],
      reasonCodes: [],
    });
    expect(catalog.getTrace().map(({ tool }) => tool)).toEqual([
      "search",
      "list_schema_fields",
      "get_lineage",
      "get_lineage",
      "get_entities",
      "get_entities",
      "get_entities",
    ]);
    expect(catalog.getTrace().map(({ callId }) => callId)).toEqual([
      "mcp-001",
      "mcp-002",
      "mcp-003",
      "mcp-004",
      "mcp-005",
      "mcp-006",
      "mcp-007",
    ]);
    expect(
      catalog
        .getTrace()
        .slice(4)
        .map(({ arguments: arguments_ }) => arguments_),
    ).toEqual([
      { urns: requested.slice(0, 10) },
      { urns: requested.slice(10, 20) },
      { urns: requested.slice(20, 25) },
    ]);
  });

  it("filters entity context to requested URNs and reports missing fixtures truthfully", async () => {
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

  it("identifies replay without claiming a live server", () => {
    expect(new FixtureCatalog().getServerInfo()).toEqual({
      reportedServerName: "fixture",
      reportedServerVersion: "replay-v1",
    });
  });
});
