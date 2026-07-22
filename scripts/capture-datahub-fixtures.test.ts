import { describe, expect, it } from "vitest";
import {
  canonicalizeFixturePayloads,
  serializeFixture,
  type FixturePayloads,
} from "./capture-datahub-fixtures.js";

const token = "local-test-token";

const complete = <T>(items: readonly T[]) => ({
  items,
  completeness: {
    complete: true,
    pages: 1,
    itemCount: items.length,
    offsets: [0],
    reasonCodes: [],
  },
});

const ordered = {
  candidates: complete([
    { urn: "urn:li:dataset:a", name: "alpha", platform: "snowflake" },
    { urn: "urn:li:dataset:b", name: "beta", platform: "snowflake" },
  ]),
  fields: complete([
    { fieldPath: "customer_id", nativeDataType: "NUMBER(38,0)" },
    { fieldPath: "order_id", nativeDataType: "NUMBER(38,0)" },
  ]),
  tableLineage: complete([
    {
      urn: "urn:li:dataset:a",
      name: "alpha",
      platform: "snowflake",
      hop: 1,
      lineageColumns: ["customer_id", "order_id"],
    },
    {
      urn: "urn:li:dataset:b",
      name: "beta",
      platform: "snowflake",
      hop: 2,
      lineageColumns: ["customer_id"],
    },
  ]),
  columnLineage: complete([
    {
      urn: "urn:li:dataset:a",
      name: "alpha",
      platform: "snowflake",
      hop: 1,
      lineageColumns: ["customer_id", "order_id"],
    },
    {
      urn: "urn:li:dataset:b",
      name: "beta",
      platform: "snowflake",
      hop: 2,
      lineageColumns: ["customer_id"],
    },
  ]),
  entityContext: complete([
    {
      urn: "urn:li:dataset:a",
      entityType: "DATASET",
      owners: [],
      tags: [],
      glossaryTerms: [],
      siblingUrns: [],
      qualitySignals: [],
    },
  ]),
} as const;

const permuted = {
  candidates: { ...ordered.candidates, items: [...ordered.candidates.items].reverse() },
  fields: { ...ordered.fields, items: [...ordered.fields.items].reverse() },
  tableLineage: {
    ...ordered.tableLineage,
    items: ordered.tableLineage.items
      .map((asset) => ({ ...asset, lineageColumns: [...asset.lineageColumns].reverse() }))
      .reverse(),
  },
  columnLineage: {
    ...ordered.columnLineage,
    items: ordered.columnLineage.items
      .map((asset) => ({ ...asset, lineageColumns: [...asset.lineageColumns].reverse() }))
      .reverse(),
  },
  entityContext: ordered.entityContext,
};

async function render(payloads: FixturePayloads): Promise<readonly string[]> {
  const canonical = canonicalizeFixturePayloads(payloads);
  return Promise.all([
    serializeFixture(canonical.candidates, token),
    serializeFixture(canonical.fields, token),
    serializeFixture(canonical.tableLineage, token),
    serializeFixture(canonical.columnLineage, token),
    serializeFixture(canonical.entityContext, token),
  ]);
}

describe("fixture canonicalization", () => {
  it("renders semantically equivalent permutations as byte-identical fixture content", async () => {
    await expect(render(ordered)).resolves.toEqual(await render(permuted));
  });

  it("serializes the deterministic URN display fallback for unnamed search candidates", async () => {
    const urn = "urn:li:dataset:(urn:li:dataPlatform:snowflake,unnamed_orders,PROD)";
    const [searchFixture] = await render({
      ...ordered,
      candidates: complete([{ urn, name: urn }]),
    });

    expect(JSON.parse(searchFixture!)).toMatchObject({ items: [{ urn, name: urn }] });
  });
});
