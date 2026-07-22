import type { EntityContext } from "./evidence.js";

export interface ContextCoverage {
  readonly retrievalComplete: boolean;
  readonly relevantAssets: number;
  readonly inspectedAssets: number;
  readonly retrievalPercentage: number;
  readonly possibleSignals: number;
  readonly coveredSignals: number;
  readonly percentage: number | null;
  readonly withDescriptions: number;
  readonly withOwners: number;
  readonly withGovernance: number;
  readonly missingMetadataUrns: readonly string[];
  readonly unknownMetadataUrns: readonly string[];
}

export interface CalculateContextCoverageInput {
  readonly relevantUrns: readonly string[];
  readonly retrievalComplete: boolean;
  readonly entities: readonly EntityContext[];
}

const compareEnglish = (left: string, right: string): number => left.localeCompare(right, "en-US");

export function calculateContextCoverage(input: CalculateContextCoverageInput): ContextCoverage {
  const relevantUrns = [...new Set(input.relevantUrns)].sort(compareEnglish);
  const relevant = new Set(relevantUrns);
  const entitiesByUrn = new Map<string, EntityContext>();
  for (const entity of input.entities) {
    if (relevant.has(entity.urn) && !entitiesByUrn.has(entity.urn)) {
      entitiesByUrn.set(entity.urn, entity);
    }
  }

  let withDescriptions = 0;
  let withOwners = 0;
  let withGovernance = 0;
  const missingMetadataUrns: string[] = [];
  const unknownMetadataUrns: string[] = [];

  for (const urn of relevantUrns) {
    const entity = entitiesByUrn.get(urn);
    if (entity === undefined) {
      unknownMetadataUrns.push(urn);
      continue;
    }
    const hasDescription = entity.description?.trim().length ? true : false;
    const hasOwner = entity.owners.length > 0;
    const hasGovernance = entity.tags.length > 0 || entity.glossaryTerms.length > 0;
    if (hasDescription) withDescriptions += 1;
    if (hasOwner) withOwners += 1;
    if (hasGovernance) withGovernance += 1;
    if (!hasDescription || !hasOwner || !hasGovernance) missingMetadataUrns.push(urn);
  }

  const inspectedAssets = entitiesByUrn.size;
  const possibleSignals = inspectedAssets * 3;
  const coveredSignals = withDescriptions + withOwners + withGovernance;
  return {
    retrievalComplete: input.retrievalComplete,
    relevantAssets: relevantUrns.length,
    inspectedAssets,
    retrievalPercentage:
      relevantUrns.length === 0 ? 0 : Math.round((inspectedAssets / relevantUrns.length) * 100),
    possibleSignals,
    coveredSignals,
    percentage: possibleSignals === 0 ? null : Math.round((coveredSignals / possibleSignals) * 100),
    withDescriptions,
    withOwners,
    withGovernance,
    missingMetadataUrns,
    unknownMetadataUrns,
  };
}
