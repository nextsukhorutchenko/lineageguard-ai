import { expect, it } from "vitest";
import { calculateContextCoverage } from "./context-coverage.js";

const richEntity = (urn: string) => ({
  urn,
  entityType: "DATASET",
  description: "Orders",
  owners: ["urn:li:corpuser:owner"],
  tags: ["urn:li:tag:critical"],
  glossaryTerms: [],
  siblingUrns: [],
  qualitySignals: [],
});

const emptyEntity = (urn: string) => ({
  urn,
  entityType: "DATASET",
  owners: [],
  tags: [],
  glossaryTerms: [],
  siblingUrns: [],
  qualitySignals: [],
});

it("calculates three deterministic signals per relevant asset", () => {
  const coverage = calculateContextCoverage({
    relevantUrns: ["urn:one", "urn:two"],
    retrievalComplete: true,
    entities: [richEntity("urn:one"), emptyEntity("urn:two")],
  });

  expect(coverage).toMatchObject({
    relevantAssets: 2,
    inspectedAssets: 2,
    retrievalPercentage: 100,
    possibleSignals: 6,
    coveredSignals: 3,
    percentage: 50,
    withDescriptions: 1,
    withOwners: 1,
    withGovernance: 1,
    retrievalComplete: true,
  });
  expect(coverage.missingMetadataUrns).toEqual(["urn:two"]);
  expect(coverage.unknownMetadataUrns).toEqual([]);
});

it("separates unknown retrieval from missing metadata and deduplicates URNs", () => {
  const coverage = calculateContextCoverage({
    relevantUrns: ["urn:one", "urn:one", "urn:two", "urn:three"],
    retrievalComplete: false,
    entities: [richEntity("urn:one"), richEntity("urn:one"), emptyEntity("urn:two")],
  });

  expect(coverage).toMatchObject({
    relevantAssets: 3,
    inspectedAssets: 2,
    retrievalPercentage: 67,
    possibleSignals: 6,
    coveredSignals: 3,
    percentage: 50,
    retrievalComplete: false,
  });
  expect(coverage.missingMetadataUrns).toEqual(["urn:two"]);
  expect(coverage.unknownMetadataUrns).toEqual(["urn:three"]);
});

it("reports metadata richness as unavailable when nothing was inspected", () => {
  expect(
    calculateContextCoverage({
      relevantUrns: ["urn:one"],
      retrievalComplete: false,
      entities: [],
    }),
  ).toMatchObject({
    relevantAssets: 1,
    inspectedAssets: 0,
    retrievalPercentage: 0,
    possibleSignals: 0,
    coveredSignals: 0,
    percentage: null,
    unknownMetadataUrns: ["urn:one"],
  });
});
