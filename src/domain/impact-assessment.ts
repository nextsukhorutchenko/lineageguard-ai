import type { NormalizedEvidence } from "./evidence.js";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type Confidence = "low" | "medium" | "high";

export interface RiskFactor {
  readonly name:
    "renameSeverity" | "downstreamAssets" | "lineageDepth" | "confirmedColumns" | "metadataGap";
  readonly points: number;
  readonly explanation: string;
}

export interface ImpactAssessment {
  readonly score: number;
  readonly level: RiskLevel;
  readonly confidence: Confidence;
  readonly factors: readonly RiskFactor[];
}

export function assessImpact(evidence: NormalizedEvidence): ImpactAssessment {
  const downstreamCount = evidence.downstreamAssets.length;
  const columnCount = evidence.columnAffectedAssets.length;
  const maxHop = Math.max(0, ...evidence.downstreamAssets.map(({ hop }) => hop));
  const factors: RiskFactor[] = [
    {
      name: "renameSeverity",
      points: 25,
      explanation: "A column rename is a breaking schema change.",
    },
    {
      name: "downstreamAssets",
      points: Math.min(30, downstreamCount * 3),
      explanation: `${downstreamCount} downstream assets are visible.`,
    },
    {
      name: "lineageDepth",
      points: Math.min(15, maxHop * 5),
      explanation: `The deepest visible dependency is ${maxHop} hops away.`,
    },
    {
      name: "confirmedColumns",
      points: Math.min(20, columnCount * 4),
      explanation: `${columnCount} downstream assets have column-level evidence.`,
    },
    {
      name: "metadataGap",
      points:
        columnCount === downstreamCount && downstreamCount > 0 ? 0 : columnCount === 0 ? 10 : 5,
      explanation:
        columnCount === downstreamCount && downstreamCount > 0
          ? "All visible assets have column-level evidence."
          : "Some downstream column relationships remain unknown.",
    },
  ];
  const score = Math.min(
    100,
    factors.reduce((sum, factor) => sum + factor.points, 0),
  );
  const level: RiskLevel =
    score < 30 ? "low" : score < 60 ? "medium" : score < 80 ? "high" : "critical";
  const confidence: Confidence =
    columnCount === 0 ? "low" : columnCount === downstreamCount ? "high" : "medium";

  return { score, level, confidence, factors };
}
