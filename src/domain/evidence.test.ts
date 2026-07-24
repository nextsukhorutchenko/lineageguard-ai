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

const completeCollection = {
  complete: true,
  pages: 1,
  itemCount: 1,
  offsets: [0],
  reasonCodes: [],
} as const;

const enrichment = {
  completeness: {
    complete: true,
    search: completeCollection,
    schema: completeCollection,
    tableLineage: completeCollection,
    columnLineage: completeCollection,
  },
  entityContextRetrieval: completeCollection,
  entityContext: [],
  contextCoverage: {
    retrievalComplete: true,
    relevantAssets: 0,
    inspectedAssets: 0,
    retrievalPercentage: 0,
    possibleSignals: 0,
    coveredSignals: 0,
    percentage: null,
    withDescriptions: 0,
    withOwners: 0,
    withGovernance: 0,
    missingMetadataUrns: [],
    unknownMetadataUrns: [],
  },
} as const;

describe("evidence normalization", () => {
  it("preserves sorted search candidates and deterministically merges unmatched column lineage", () => {
    const searchCandidates = [
      { urn: "urn:candidate:z", name: "z" },
      { urn: "urn:candidate:a", name: "a" },
      { urn: "urn:candidate:z", name: "z duplicate" },
    ];
    const columnLineage = [
      {
        ...lineage("urn:column:z", 2, ["derived_customer_id"]),
        name: "zeta",
      },
      {
        ...lineage("urn:column:a", 1, ["customer_id"]),
        platform: "snowflake",
      },
      {
        ...lineage("urn:column:z", 1, ["customer_id"]),
        name: "alpha",
        platform: "dbt",
      },
    ];
    const input = {
      target: candidate,
      searchCandidates,
      fields: [field("customer_id")],
      sourceColumn: field("customer_id"),
      tableLineage: [lineage("urn:table:a", 1)],
      columnLineage,
      trace: [],
      ...enrichment,
    };

    const result = normalizeEvidence(input);
    const reversed = normalizeEvidence({
      ...input,
      searchCandidates: [...searchCandidates].reverse(),
      columnLineage: [...columnLineage].reverse(),
    });

    expect(result.searchCandidateUrns).toEqual(["urn:candidate:a", "urn:candidate:z"]);
    expect(result.unmatchedColumnAssets).toEqual([
      {
        urn: "urn:column:a",
        platform: "snowflake",
        hop: 1,
        lineageColumns: ["customer_id"],
      },
      {
        urn: "urn:column:z",
        name: "alpha",
        platform: "dbt",
        hop: 1,
        lineageColumns: ["customer_id", "derived_customer_id"],
      },
    ]);
    expect(reversed).toEqual(result);
  });

  it("sorts assets and fields deterministically", () => {
    const result = normalizeEvidence({
      target: candidate,
      searchCandidates: [candidate],
      fields: [field("z_col"), field("customer_id"), field("a_col")],
      sourceColumn: field("customer_id"),
      tableLineage: [lineage("urn:z", 2), lineage("urn:a", 1)],
      columnLineage: [lineage("urn:z", 2, ["customer_id"])],
      trace: [],
      ...enrichment,
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
      searchCandidates: [candidate],
      fields: [field("customer_id")],
      sourceColumn: field("customer_id"),
      tableLineage: [
        lineage("urn:orders", 3),
        lineage("urn:orders", 1),
        lineage("urn:dashboard", 2),
      ],
      columnLineage: [lineage("urn:dashboard", 2), lineage("urn:dashboard", 1)],
      trace: [],
      ...enrichment,
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
      searchCandidates: [candidate],
      fields: [field("customer_id")],
      sourceColumn: field("customer_id"),
      tableLineage: [lineage("urn:table:a", 1), lineage("urn:table:b", 2)],
      columnLineage: [
        lineage("urn:column:a", 1, ["customer_id"]),
        lineage("urn:column:b", 2, ["customer_id"]),
      ],
      trace: [],
      ...enrichment,
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
      searchCandidates: [{ urn: "urn:li:dataset:opaque", name: "orders" }],
      fields: [field("customer_id")],
      sourceColumn: field("customer_id"),
      tableLineage: [],
      columnLineage: [],
      trace: [],
      ...enrichment,
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
