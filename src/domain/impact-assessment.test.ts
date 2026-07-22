import { describe, expect, it } from "vitest";
import type { NormalizedEvidence } from "./evidence.js";
import { assessImpact } from "./impact-assessment.js";

const evidence = ({
  downstream,
  columnAffected,
  maxHop,
}: {
  readonly downstream: number;
  readonly columnAffected: number;
  readonly maxHop: number;
}): NormalizedEvidence => ({
  targetDataset: {
    urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.orders,PROD)",
    name: "analytics.orders",
    platform: "snowflake",
  },
  searchCandidateUrns: ["urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.orders,PROD)"],
  schemaFields: [{ fieldPath: "customer_id" }],
  sourceColumn: { fieldPath: "customer_id" },
  downstreamAssets: Array.from({ length: downstream }, (_, index) => ({
    urn: `urn:downstream:${index}`,
    hop: index === downstream - 1 ? maxHop : 0,
    lineageColumns: [],
  })),
  columnAffectedAssets: Array.from({ length: columnAffected }, (_, index) => ({
    urn: `urn:downstream:${index}`,
    hop: 0,
    lineageColumns: ["customer_id"],
  })),
  unmatchedColumnAssets: [],
  evidenceLevel: columnAffected > 0 ? "column" : downstream > 0 ? "table" : "none",
  metadataGaps: [],
  trace: [],
});

describe("assessImpact", () => {
  it("scores no visible downstream evidence", () => {
    expect(assessImpact(evidence({ downstream: 0, columnAffected: 0, maxHop: 0 }))).toMatchObject({
      score: 35,
      level: "medium",
      confidence: "low",
    });
  });

  it("scores complete shallow column evidence", () => {
    expect(assessImpact(evidence({ downstream: 2, columnAffected: 2, maxHop: 1 }))).toMatchObject({
      score: 44,
      level: "medium",
      confidence: "high",
    });
  });

  it("caps each factor for broad partially-confirmed evidence", () => {
    expect(assessImpact(evidence({ downstream: 19, columnAffected: 8, maxHop: 2 }))).toMatchObject({
      score: 90,
      level: "critical",
      confidence: "medium",
    });
  });

  it("returns the same assessment for the same normalized evidence", () => {
    const normalizedEvidence = evidence({ downstream: 2, columnAffected: 2, maxHop: 1 });

    expect(assessImpact(normalizedEvidence)).toEqual(assessImpact(normalizedEvidence));
  });

  it("does not treat equal-sized disjoint lineage sets as complete coverage", () => {
    const disjoint = {
      ...evidence({ downstream: 2, columnAffected: 2, maxHop: 1 }),
      columnAffectedAssets: [
        { urn: "urn:column:0", hop: 1, lineageColumns: ["customer_id"] },
        { urn: "urn:column:1", hop: 1, lineageColumns: ["customer_id"] },
      ],
    };

    expect(assessImpact(disjoint)).toMatchObject({
      score: 46,
      level: "medium",
      confidence: "low",
      factors: expect.arrayContaining([
        expect.objectContaining({ name: "confirmedColumns", points: 0 }),
        expect.objectContaining({ name: "metadataGap", points: 10 }),
      ]),
    });
  });
});
