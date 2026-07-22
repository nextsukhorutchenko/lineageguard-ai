import type { LineageAsset, SchemaField, ToolTraceEntry } from "../domain/evidence.js";
import type { DatasetCandidate } from "../domain/resolve-dataset.js";

export interface DataHubCatalog {
  searchDatasets(hint: string): Promise<readonly DatasetCandidate[]>;
  listSchemaFields(datasetUrn: string): Promise<readonly SchemaField[]>;
  getDownstreamLineage(
    datasetUrn: string,
    options: { readonly column?: string; readonly maxHops: 2 },
  ): Promise<readonly LineageAsset[]>;
  getTrace(): readonly ToolTraceEntry[];
  close(): Promise<void>;
}
