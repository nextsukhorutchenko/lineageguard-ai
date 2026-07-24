import type { ImpactReportDraft } from "../../src/app/run-impact-analysis.js";
import type { ToolTraceEntry } from "../../src/domain/evidence.js";
import { buildChangeContext, type ChangeContext } from "../../src/workflow/change-context.js";
import type { MigrationPackageDraft } from "../../src/workflow/migration-draft.js";

const trace = (
  callId: string,
  tool: ToolTraceEntry["tool"],
  page: number,
  args: Readonly<Record<string, unknown>>,
): ToolTraceEntry => ({
  callId,
  tool,
  arguments: args,
  at: "2026-07-22T12:00:00.000Z",
  page,
  status: "ok",
});

export function makeImpactReportDraft(
  options: {
    readonly datasetName?: string;
    readonly platform?: string;
    readonly score?: number;
  } = {},
): ImpactReportDraft {
  const datasetName = options.datasetName ?? "b2fd91.order_entry_db.analytics.order_details";
  const platform = options.platform ?? "snowflake";
  const score = options.score ?? 90;
  const targetDataset = {
    urn: `urn:li:dataset:(urn:li:dataPlatform:${platform},${datasetName},PROD)`,
    name: datasetName,
    platform,
    environment: "PROD",
  };
  const sourceColumn = { fieldPath: "customer_id", nativeDataType: "NUMBER(38,0)" };
  const downstreamAssets = [
    {
      urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,downstream.one,PROD)",
      name: "one",
      platform: "dbt",
      hop: 1,
      lineageColumns: ["customer_id"],
    },
    {
      urn: "urn:li:dashboard:(looker,downstream-two)",
      name: "two",
      platform: "looker",
      hop: 2,
      lineageColumns: [],
    },
  ] as const;
  return {
    runId: "run-test",
    createdAt: "2026-07-22T12:00:00.000Z",
    request: `Rename column customer_id to customer_key in dataset ${platform}:${datasetName}`,
    intent: {
      kind: "rename_column",
      datasetHint: `${platform}:${datasetName}`,
      sourceColumn: "customer_id",
      targetColumn: "customer_key",
    },
    evidence: {
      targetDataset,
      searchCandidateUrns: [targetDataset.urn],
      schemaFields: [sourceColumn, { fieldPath: "order_id", nativeDataType: "NUMBER(38,0)" }],
      sourceColumn,
      downstreamAssets,
      columnAffectedAssets: [downstreamAssets[0]],
      unmatchedColumnAssets: [],
      evidenceLevel: "column",
      metadataGaps: [
        "Column-level lineage is unavailable for 1 of 2 table-level downstream assets.",
      ],
      completeness: {
        complete: true,
        search: { complete: true, pages: 1, itemCount: 1, offsets: [0], reasonCodes: [] },
        schema: { complete: true, pages: 1, itemCount: 2, offsets: [0], reasonCodes: [] },
        tableLineage: {
          complete: true,
          pages: 1,
          itemCount: 2,
          offsets: [0],
          reasonCodes: [],
        },
        columnLineage: {
          complete: true,
          pages: 1,
          itemCount: 1,
          offsets: [0],
          reasonCodes: [],
        },
      },
      entityContextRetrieval: {
        complete: false,
        pages: 1,
        itemCount: 0,
        offsets: [0],
        reasonCodes: ["ENTITY_CONTEXT_UNAVAILABLE"],
      },
      entityContext: [],
      contextCoverage: {
        retrievalComplete: false,
        relevantAssets: 3,
        inspectedAssets: 0,
        retrievalPercentage: 0,
        possibleSignals: 0,
        coveredSignals: 0,
        percentage: null,
        withDescriptions: 0,
        withOwners: 0,
        withGovernance: 0,
        missingMetadataUrns: [],
        unknownMetadataUrns: [targetDataset.urn, ...downstreamAssets.map(({ urn }) => urn)],
      },
      trace: [
        trace("mcp-001", "search", 1, { offset: 0 }),
        trace("mcp-002", "list_schema_fields", 1, { urn: targetDataset.urn, offset: 0 }),
        trace("mcp-003", "get_lineage", 1, {
          urn: targetDataset.urn,
          upstream: false,
          max_hops: 2,
          offset: 0,
        }),
        trace("mcp-004", "get_lineage", 1, {
          urn: targetDataset.urn,
          column: "customer_id",
          upstream: false,
          max_hops: 2,
          offset: 0,
        }),
        trace("mcp-005", "get_entities", 1, { urns: [targetDataset.urn] }),
      ],
    },
    assessment: {
      score,
      level: score >= 80 ? "critical" : score >= 60 ? "high" : score >= 30 ? "medium" : "low",
      confidence: "medium",
      factors: [
        { name: "renameSeverity", points: 25, explanation: "A column rename is breaking." },
      ],
    },
    facts: [`Selected dataset ${targetDataset.urn} was returned by DataHub.`],
    assumptions: ["Downstream lineage inspection was bounded to two hops."],
    unknowns: ["Column-level impact remains unknown for one asset."],
    status: "COMPLETED",
  };
}

export function makeChangeContext(
  options: Parameters<typeof makeImpactReportDraft>[0] = {},
): ChangeContext {
  return buildChangeContext(makeImpactReportDraft(options), []);
}

export function makeMigrationDraft(
  context: ChangeContext = makeChangeContext(),
): MigrationPackageDraft {
  return {
    schemaVersion: "1",
    strategy: "STAGED_COMPATIBILITY",
    executionClassification:
      context.advisoryDecision === "PROCEED_WITH_REVIEW"
        ? "EXECUTABLE_WITH_REVIEW"
        : "ADVISORY_ONLY",
    rationale: "CRITICAL_DOWNSTREAM_IMPACT",
    evidenceIds: context.evidence.map(({ id }) => id),
    stages: [
      "PREPARE",
      "ADD_COMPATIBLE_COLUMN",
      "BACKFILL",
      "MIGRATE_DOWNSTREAM",
      "VALIDATE",
      "RETIRE_SOURCE_COLUMN",
    ],
    validationChecks: ["SOURCE_COLUMN_EXISTS", "TARGET_COLUMN_EXISTS", "BACKFILL_COMPLETE"],
    rollback: "KEEP_SOURCE_AND_REMOVE_TARGET_AFTER_REVIEW",
    warnings: ["DIRECT_RENAME_BLOCKED", "HUMAN_APPROVAL_REQUIRED"],
  };
}
