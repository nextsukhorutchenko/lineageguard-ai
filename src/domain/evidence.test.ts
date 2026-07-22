import { describe, expect, it } from "vitest";
import type { DatasetCandidate } from "./resolve-dataset.js";
import {
  normalizeEvidence,
  requireSourceColumn,
  type LineageAsset,
  type SchemaField,
} from "./evidence.js";

const candidate: DatasetCandidate = {
  urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.orders,PROD)",
  name: "analytics.orders",
  platform: "snowflake",
  environment: "PROD",
};

const field = (fieldPath: string): SchemaField => ({ fieldPath });

const lineage = (
  urn: string,
  hop: number,
  lineageColumns: readonly string[] = [],
): LineageAsset => ({ urn, hop, lineageColumns });

describe("evidence normalization", () => {
  it("sorts assets and fields deterministically", () => {
    const result = normalizeEvidence({
      target: candidate,
      fields: [field("z_col"), field("customer_id"), field("a_col")],
      sourceColumn: field("customer_id"),
      tableLineage: [lineage("urn:z", 2), lineage("urn:a", 1)],
      columnLineage: [lineage("urn:z", 2, ["customer_id"])],
      trace: [],
    });

    expect(result.schemaFields.map((item) => item.fieldPath)).toEqual([
      "a_col",
      "customer_id",
      "z_col",
    ]);
    expect(result.downstreamAssets.map((item) => item.urn)).toEqual(["urn:a", "urn:z"]);
  });

  it("deduplicates assets by URN and retains the lowest hop", () => {
    const result = normalizeEvidence({
      target: candidate,
      fields: [field("customer_id")],
      sourceColumn: field("customer_id"),
      tableLineage: [
        lineage("urn:orders", 3),
        lineage("urn:orders", 1),
        lineage("urn:dashboard", 2),
      ],
      columnLineage: [lineage("urn:dashboard", 2), lineage("urn:dashboard", 1)],
      trace: [],
    });

    expect(result.downstreamAssets).toEqual([
      lineage("urn:dashboard", 2),
      lineage("urn:orders", 1),
    ]);
    expect(result.columnAffectedAssets).toEqual([lineage("urn:dashboard", 1)]);
    expect(result.evidenceLevel).toBe("column");
    expect(result.metadataGaps).toEqual([
      "Column-level lineage is unavailable for 1 of 2 table-level downstream assets.",
    ]);
  });

  it("reconciles column evidence by exact downstream URN and exposes disjoint gaps", () => {
    const result = normalizeEvidence({
      target: candidate,
      fields: [field("customer_id")],
      sourceColumn: field("customer_id"),
      tableLineage: [lineage("urn:table:a", 1), lineage("urn:table:b", 2)],
      columnLineage: [
        lineage("urn:column:a", 1, ["customer_id"]),
        lineage("urn:column:b", 2, ["customer_id"]),
      ],
      trace: [],
    });

    expect(result.columnAffectedAssets).toEqual([]);
    expect(result.evidenceLevel).toBe("table");
    expect(result.metadataGaps).toEqual([
      "Column-level lineage is unavailable for 2 of 2 table-level downstream assets.",
      "2 column-lineage assets were absent from table-level lineage and were not counted as confirmed.",
    ]);
  });

  it("records only genuinely absent target and lineage metadata", () => {
    const result = normalizeEvidence({
      target: { urn: "urn:li:dataset:opaque", name: "orders" },
      fields: [field("customer_id")],
      sourceColumn: field("customer_id"),
      tableLineage: [],
      columnLineage: [],
      trace: [],
    });

    expect(result.metadataGaps).toEqual([
      "No downstream lineage was returned.",
      "Selected dataset platform metadata was not available.",
      "Selected dataset environment metadata was not available.",
    ]);
  });

  it("finds the source column using NFKC and English case normalization", () => {
    const sourceColumn = field("Ｃｕｓｔｏｍｅｒ_ID");

    expect(requireSourceColumn([sourceColumn], "customer_id")).toBe(sourceColumn);
  });

  it("rejects a missing source column with actual field names", () => {
    expect(() =>
      requireSourceColumn([field("z_order"), field("order_id")], "customer_id"),
    ).toThrowError(
      expect.objectContaining({
        code: "COLUMN_NOT_FOUND",
        details: { knownFields: ["order_id", "z_order"] },
      }),
    );
  });
});
