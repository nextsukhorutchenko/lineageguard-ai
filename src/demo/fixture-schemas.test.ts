import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fixtureSchemas, type FixtureName } from "./fixture-schemas.js";

const FIXTURE_NAMES = [
  "search-order-details.json",
  "schema-order-details.json",
  "lineage-order-details-table.json",
  "lineage-order-details-customer-id.json",
  "entity-context-order-details-impact.json",
] as const satisfies readonly FixtureName[];

const DATASET_URN =
  "urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details,PROD)";

async function readUnsafeFixture(name: FixtureName): Promise<unknown> {
  return JSON.parse(
    await readFile(resolve(process.cwd(), "tests", "fixtures", "datahub", name), "utf8"),
  );
}

describe("fixtureSchemas", () => {
  it("accepts all five clean committed fixtures", async () => {
    for (const name of FIXTURE_NAMES) {
      expect(fixtureSchemas[name].safeParse(await readUnsafeFixture(name)).success).toBe(true);
    }
  });

  it("rejects an invalid JSON shape", () => {
    expect(fixtureSchemas["search-order-details.json"].safeParse([]).success).toBe(false);
  });

  it("rejects extra fixture and entity keys", async () => {
    const search = fixtureSchemas["search-order-details.json"].parse(
      await readUnsafeFixture("search-order-details.json"),
    );
    expect(
      fixtureSchemas["search-order-details.json"].safeParse({ ...search, rawResponse: "unsafe" })
        .success,
    ).toBe(false);

    const context = fixtureSchemas["entity-context-order-details-impact.json"].parse(
      await readUnsafeFixture("entity-context-order-details-impact.json"),
    );
    const forbidden = ["email", "profile", "relatedDocuments", "rawSql", "token", "diagnostics"];
    for (const field of forbidden) {
      expect(
        fixtureSchemas["entity-context-order-details-impact.json"].safeParse({
          ...context,
          items: [{ ...context.items[0]!, [field]: "not-allowed" }, ...context.items.slice(1)],
        }).success,
      ).toBe(false);
    }
  });

  it("rejects overlong normalized values", async () => {
    const schema = fixtureSchemas["schema-order-details.json"].parse(
      await readUnsafeFixture("schema-order-details.json"),
    );
    expect(
      fixtureSchemas["schema-order-details.json"].safeParse({
        ...schema,
        items: [{ ...schema.items[0]!, fieldPath: "x".repeat(501) }, ...schema.items.slice(1)],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate and wrong identity URNs", async () => {
    const table = fixtureSchemas["lineage-order-details-table.json"].parse(
      await readUnsafeFixture("lineage-order-details-table.json"),
    );
    expect(
      fixtureSchemas["lineage-order-details-table.json"].safeParse({
        ...table,
        items: [
          table.items[0]!,
          { ...table.items[1]!, urn: table.items[0]!.urn },
          ...table.items.slice(2),
        ],
      }).success,
    ).toBe(false);

    const search = fixtureSchemas["search-order-details.json"].parse(
      await readUnsafeFixture("search-order-details.json"),
    );
    expect(
      fixtureSchemas["search-order-details.json"].safeParse({
        ...search,
        items: search.items.map((item) =>
          item.urn === DATASET_URN ? { ...item, urn: "urn:li:dataset:(wrong-target)" } : item,
        ),
      }).success,
    ).toBe(false);
  });

  it("rejects inconsistent completeness and wrong item counts", async () => {
    const search = fixtureSchemas["search-order-details.json"].parse(
      await readUnsafeFixture("search-order-details.json"),
    );
    expect(
      fixtureSchemas["search-order-details.json"].safeParse({
        ...search,
        completeness: { ...search.completeness, pages: 2 },
      }).success,
    ).toBe(false);

    const lineage = fixtureSchemas["lineage-order-details-customer-id.json"].parse(
      await readUnsafeFixture("lineage-order-details-customer-id.json"),
    );
    expect(
      fixtureSchemas["lineage-order-details-customer-id.json"].safeParse({
        ...lineage,
        items: lineage.items.slice(1),
      }).success,
    ).toBe(false);
  });

  it("rejects a fixture without the exact customer_id source field", async () => {
    const schema = fixtureSchemas["schema-order-details.json"].parse(
      await readUnsafeFixture("schema-order-details.json"),
    );
    expect(
      fixtureSchemas["schema-order-details.json"].safeParse({
        ...schema,
        items: schema.items.map((field) =>
          field.fieldPath === "customer_id" ? { ...field, fieldPath: "customer_key" } : field,
        ),
      }).success,
    ).toBe(false);
  });

  it("rejects arrays above live normalized caps", async () => {
    const context = fixtureSchemas["entity-context-order-details-impact.json"].parse(
      await readUnsafeFixture("entity-context-order-details-impact.json"),
    );
    expect(
      fixtureSchemas["entity-context-order-details-impact.json"].safeParse({
        ...context,
        items: [
          {
            ...context.items[0]!,
            owners: Array.from(
              { length: 21 },
              (_, index) => `urn:li:corpuser:fixture-owner-${index}`,
            ),
          },
          ...context.items.slice(1),
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects out-of-order entity-context fixtures", async () => {
    const context = fixtureSchemas["entity-context-order-details-impact.json"].parse(
      await readUnsafeFixture("entity-context-order-details-impact.json"),
    );
    expect(
      fixtureSchemas["entity-context-order-details-impact.json"].safeParse({
        ...context,
        items: [context.items[1]!, context.items[0]!, ...context.items.slice(2)],
      }).success,
    ).toBe(false);
  });
});
