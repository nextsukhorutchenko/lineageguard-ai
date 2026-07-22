import { describe, expect, it } from "vitest";
import {
  canonicalizeFixturePayloads,
  serializeFixture,
  type FixturePayloads,
} from "./capture-datahub-fixtures.js";

const token = "local-test-token";

const ordered = {
  candidates: [
    { urn: "urn:li:dataset:a", name: "alpha", platform: "snowflake" },
    { urn: "urn:li:dataset:b", name: "beta", platform: "snowflake" },
  ],
  fields: [
    { fieldPath: "customer_id", nativeDataType: "NUMBER(38,0)" },
    { fieldPath: "order_id", nativeDataType: "NUMBER(38,0)" },
  ],
  tableLineage: [
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
  ],
  columnLineage: [
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
  ],
} as const;

const permuted = {
  candidates: [...ordered.candidates].reverse(),
  fields: [...ordered.fields].reverse(),
  tableLineage: ordered.tableLineage
    .map((asset) => ({ ...asset, lineageColumns: [...asset.lineageColumns].reverse() }))
    .reverse(),
  columnLineage: ordered.columnLineage
    .map((asset) => ({ ...asset, lineageColumns: [...asset.lineageColumns].reverse() }))
    .reverse(),
};

async function render(payloads: FixturePayloads): Promise<readonly string[]> {
  const canonical = canonicalizeFixturePayloads(payloads);
  return Promise.all([
    serializeFixture(canonical.candidates, token),
    serializeFixture(canonical.fields, token),
    serializeFixture(canonical.tableLineage, token),
    serializeFixture(canonical.columnLineage, token),
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
      candidates: [{ urn, name: urn }],
    });

    expect(JSON.parse(searchFixture!)).toEqual([{ urn, name: urn }]);
  });
});
