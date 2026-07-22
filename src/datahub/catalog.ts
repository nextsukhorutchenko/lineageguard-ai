import type {
  CollectionCompleteness,
  EntityContext,
  EntityContextIncompleteReasonCode,
  LineageAsset,
  RequiredIncompleteReasonCode,
  SchemaField,
  ToolTraceEntry,
} from "../domain/evidence.js";
import type { DatasetCandidate } from "../domain/resolve-dataset.js";

export interface CollectionResult<T, R extends string = RequiredIncompleteReasonCode> {
  readonly items: readonly T[];
  readonly completeness: CollectionCompleteness<R>;
}

export interface DataHubServerInfo {
  readonly reportedServerName?: string;
  readonly reportedServerVersion?: string;
}

export interface DataHubCatalog {
  searchDatasets(
    hint: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<CollectionResult<DatasetCandidate>>;
  listSchemaFields(
    datasetUrn: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<CollectionResult<SchemaField>>;
  getDownstreamLineage(
    datasetUrn: string,
    options: { readonly column?: string; readonly maxHops: 2; readonly signal?: AbortSignal },
  ): Promise<CollectionResult<LineageAsset>>;
  getEntityContext(
    urns: readonly string[],
    options?: { readonly signal?: AbortSignal },
  ): Promise<CollectionResult<EntityContext, EntityContextIncompleteReasonCode>>;
  getServerInfo(): DataHubServerInfo;
  getTrace(): readonly ToolTraceEntry[];
  close(): Promise<void>;
}
