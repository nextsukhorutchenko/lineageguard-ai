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
  readonly schemaFields: readonly SchemaField[];
  readonly sourceColumn: SchemaField;
  readonly downstreamAssets: readonly LineageAsset[];
  readonly columnAffectedAssets: readonly LineageAsset[];
  readonly evidenceLevel: EvidenceLevel;
  readonly metadataGaps: readonly string[];
  readonly trace: readonly ToolTraceEntry[];
}

export interface NormalizeEvidenceInput {
  readonly target: DatasetCandidate;
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
  const assetsByUrn = new Map<string, LineageAsset>();

  for (const asset of assets) {
    const existing = assetsByUrn.get(asset.urn);
    if (!existing || asset.hop < existing.hop) {
      assetsByUrn.set(asset.urn, asset);
    }
  }

  return [...assetsByUrn.values()].sort((left, right) => compareEnglish(left.urn, right.urn));
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
  const schemaFields = [...input.fields].sort((left, right) =>
    compareEnglish(left.fieldPath, right.fieldPath),
  );
  const downstreamAssets = deduplicateAssets(input.tableLineage);
  const columnAffectedAssets = deduplicateAssets(input.columnLineage);
  const evidenceLevel: EvidenceLevel =
    columnAffectedAssets.length > 0 ? "column" : downstreamAssets.length > 0 ? "table" : "none";

  return {
    targetDataset: input.target,
    schemaFields,
    sourceColumn: input.sourceColumn,
    downstreamAssets,
    columnAffectedAssets,
    evidenceLevel,
    metadataGaps: [],
    trace: input.trace,
  };
}
