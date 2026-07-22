import { AppError } from "../errors/app-error.js";
import type { DatasetCandidate } from "./resolve-dataset.js";

export interface SchemaField {
  readonly fieldPath: string;
  readonly nativeDataType?: string;
  readonly nullable?: boolean;
  readonly description?: string;
}

export interface LineageAsset {
  readonly urn: string;
  readonly name?: string;
  readonly platform?: string;
  readonly hop: number;
  readonly lineageColumns: readonly string[];
}

export interface ToolTraceEntry {
  readonly callId: string;
  readonly tool: "search" | "list_schema_fields" | "get_lineage";
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly status: "ok" | "error";
}

export type EvidenceLevel = "column" | "table" | "none";

export interface NormalizedEvidence {
  readonly targetDataset: DatasetCandidate;
  readonly searchCandidateUrns: readonly string[];
  readonly schemaFields: readonly SchemaField[];
  readonly sourceColumn: SchemaField;
  readonly downstreamAssets: readonly LineageAsset[];
  readonly columnAffectedAssets: readonly LineageAsset[];
  readonly unmatchedColumnAssets: readonly LineageAsset[];
  readonly evidenceLevel: EvidenceLevel;
  readonly metadataGaps: readonly string[];
  readonly trace: readonly ToolTraceEntry[];
}

export interface NormalizeEvidenceInput {
  readonly target: DatasetCandidate;
  readonly searchCandidates: readonly DatasetCandidate[];
  readonly fields: readonly SchemaField[];
  readonly sourceColumn: SchemaField;
  readonly tableLineage: readonly LineageAsset[];
  readonly columnLineage: readonly LineageAsset[];
  readonly trace: readonly ToolTraceEntry[];
}

const compareEnglish = (left: string, right: string): number => left.localeCompare(right, "en-US");

const normalizeFieldName = (fieldPath: string): string =>
  fieldPath.normalize("NFKC").toLocaleLowerCase("en-US");

const deduplicateAssets = (assets: readonly LineageAsset[]): readonly LineageAsset[] => {
  const assetsByUrn = new Map<
    string,
    {
      hop: number;
      lineageColumns: Set<string>;
      names: Set<string>;
      platforms: Set<string>;
    }
  >();

  for (const asset of assets) {
    const existing = assetsByUrn.get(asset.urn);
    if (existing === undefined) {
      assetsByUrn.set(asset.urn, {
        hop: asset.hop,
        lineageColumns: new Set(asset.lineageColumns),
        names: new Set(asset.name === undefined ? [] : [asset.name]),
        platforms: new Set(asset.platform === undefined ? [] : [asset.platform]),
      });
      continue;
    }

    existing.hop = Math.min(existing.hop, asset.hop);
    for (const column of asset.lineageColumns) existing.lineageColumns.add(column);
    if (asset.name !== undefined) existing.names.add(asset.name);
    if (asset.platform !== undefined) existing.platforms.add(asset.platform);
  }

  return [...assetsByUrn.entries()]
    .sort(([left], [right]) => compareEnglish(left, right))
    .map(([urn, asset]) => {
      const name = [...asset.names].sort(compareEnglish)[0];
      const platform = [...asset.platforms].sort(compareEnglish)[0];
      return {
        urn,
        hop: asset.hop,
        lineageColumns: [...asset.lineageColumns].sort(compareEnglish),
        ...(name === undefined ? {} : { name }),
        ...(platform === undefined ? {} : { platform }),
      };
    });
};

export function requireSourceColumn(
  fields: readonly SchemaField[],
  sourceColumn: string,
): SchemaField {
  const normalizedSourceColumn = normalizeFieldName(sourceColumn);
  const match = fields.find(
    (field) => normalizeFieldName(field.fieldPath) === normalizedSourceColumn,
  );

  if (match) return match;

  const knownFields = fields.map((field) => field.fieldPath).sort(compareEnglish);
  throw new AppError("COLUMN_NOT_FOUND", `No source column matches ${sourceColumn}.`, {
    knownFields,
  });
}

export function normalizeEvidence(input: NormalizeEvidenceInput): NormalizedEvidence {
  const searchCandidateUrns = [...new Set(input.searchCandidates.map(({ urn }) => urn))].sort(
    compareEnglish,
  );
  const schemaFields = [...input.fields].sort((left, right) =>
    compareEnglish(left.fieldPath, right.fieldPath),
  );
  const downstreamAssets = deduplicateAssets(input.tableLineage);
  const returnedColumnAssets = deduplicateAssets(input.columnLineage);
  const downstreamUrns = new Set(downstreamAssets.map(({ urn }) => urn));
  const columnAffectedAssets = returnedColumnAssets.filter(({ urn }) => downstreamUrns.has(urn));
  const unmatchedColumnAssets = returnedColumnAssets.filter(({ urn }) => !downstreamUrns.has(urn));
  const unmatchedColumnCount = unmatchedColumnAssets.length;
  const evidenceLevel: EvidenceLevel =
    columnAffectedAssets.length > 0 ? "column" : downstreamAssets.length > 0 ? "table" : "none";
  const metadataGaps: string[] = [];

  if (downstreamAssets.length === 0) {
    metadataGaps.push("No downstream lineage was returned.");
  } else if (columnAffectedAssets.length < downstreamAssets.length) {
    metadataGaps.push(
      `Column-level lineage is unavailable for ${downstreamAssets.length - columnAffectedAssets.length} of ${downstreamAssets.length} table-level downstream assets.`,
    );
  }
  if (unmatchedColumnCount > 0) {
    metadataGaps.push(
      `${unmatchedColumnCount} column-lineage ${unmatchedColumnCount === 1 ? "asset was" : "assets were"} absent from table-level lineage and ${unmatchedColumnCount === 1 ? "was" : "were"} not counted as confirmed.`,
    );
  }
  if (input.target.platform === undefined) {
    metadataGaps.push("Selected dataset platform metadata was not available.");
  }
  if (input.target.environment === undefined) {
    metadataGaps.push("Selected dataset environment metadata was not available.");
  }

  return {
    targetDataset: input.target,
    searchCandidateUrns,
    schemaFields,
    sourceColumn: input.sourceColumn,
    downstreamAssets,
    columnAffectedAssets,
    unmatchedColumnAssets,
    evidenceLevel,
    metadataGaps,
    trace: input.trace,
  };
}
