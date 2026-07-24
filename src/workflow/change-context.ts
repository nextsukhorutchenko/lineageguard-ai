import { createHash } from "node:crypto";
import { z } from "zod";
import type { ImpactReportDraft } from "../app/run-impact-analysis.js";
import type {
  EntityContext,
  LineageAsset,
  SchemaField,
  ToolTraceEntry,
} from "../domain/evidence.js";
import { sanitizeBoundaryText } from "../security/sanitize-output.js";
import {
  ContextCoverageSchema,
  ContextIndicatorSummarySchema,
  EntityContextRetrievalSchema,
  EvidenceCompletenessSchema,
  NarrativeSummarySchema,
} from "./contracts.js";
import { decideRisk } from "./risk-policy.js";

const EvidenceRecordSchema = z
  .object({
    id: z.string().startsWith("datahub:").max(600),
    kind: z.enum(["target_dataset", "source_column", "downstream"]),
    level: z.enum(["dataset", "schema", "table", "column"]),
    urn: z.string().min(1),
    fieldPath: z.string().optional(),
    hop: z.number().int().min(0).max(2).optional(),
  })
  .strict();

const EvidenceProvenanceSchema = z
  .object({
    callId: z.string().min(1).max(100),
    tool: z.enum(["search", "list_schema_fields", "get_lineage", "get_entities"]),
    urn: z.string().startsWith("urn:li:").max(500).optional(),
    urns: z.array(z.string().startsWith("urn:li:").max(500)).max(10).optional(),
    direction: z.literal("downstream").optional(),
    depth: z.number().int().min(0).max(2).optional(),
    page: z.number().int().positive(),
    offset: z.number().int().nonnegative().optional(),
    at: z.string().datetime(),
  })
  .strict();

export const ChangeContextSchema = z
  .object({
    schemaVersion: z.literal("1"),
    contextHash: z.string().regex(/^[a-f0-9]{64}$/),
    request: z.string().min(1),
    intent: z.object({
      kind: z.literal("rename_column"),
      datasetHint: z.string().min(1),
      sourceColumn: z.string().min(1),
      targetColumn: z.string().min(1),
    }),
    target: z.object({
      urn: z.string().startsWith("urn:li:").max(500),
      name: z.string().min(1).max(500),
      platform: z.string().max(100).optional(),
      environment: z.string().max(100).optional(),
    }),
    sourceField: z.object({
      fieldPath: z.string().min(1).max(500),
      nativeDataType: z.string().max(100).optional(),
    }),
    knownFields: z
      .array(
        z
          .object({
            fieldPath: z.string().min(1).max(500),
            nativeDataType: z.string().max(100).optional(),
          })
          .strict(),
      )
      .max(100),
    schemaSummary: z
      .object({
        totalFields: z.number().int().min(0).max(10_000),
        includedFields: z.number().int().min(0).max(100),
        truncated: z.boolean(),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    assessment: z.object({
      score: z.number().int().min(0).max(100),
      level: z.enum(["low", "medium", "high", "critical"]),
      confidence: z.enum(["low", "medium", "high"]),
      factors: z.array(
        z.object({ name: z.string(), points: z.number().int(), explanation: z.string() }),
      ),
    }),
    advisoryDecision: z.enum([
      "PROCEED_WITH_REVIEW",
      "MANUAL_APPROVAL_REQUIRED",
      "BLOCK_DIRECT_RENAME",
    ]),
    facts: z.array(z.string().min(1).max(1_200)).max(100),
    assumptions: z.array(z.string().min(1).max(1_200)).max(100),
    unknowns: z.array(z.string().min(1).max(1_200)).max(100),
    narrativeSummary: NarrativeSummarySchema,
    evidence: z.array(EvidenceRecordSchema).max(102),
    provenance: z.array(EvidenceProvenanceSchema).max(200),
    evidenceCompleteness: EvidenceCompletenessSchema,
    entityContextRetrieval: EntityContextRetrievalSchema,
    contextCoverage: ContextCoverageSchema,
    contextIndicators: ContextIndicatorSummarySchema,
    entityContext: z
      .array(
        z
          .object({
            urn: z.string().startsWith("urn:li:").max(500),
            entityType: z.string().min(1).max(100),
            name: z.string().max(500).optional(),
            platform: z.string().max(100).optional(),
            description: z.string().max(2_000).optional(),
            owners: z.array(z.string().startsWith("urn:li:").max(500)).max(20),
            tags: z.array(z.string().startsWith("urn:li:").max(500)).max(20),
            glossaryTerms: z.array(z.string().startsWith("urn:li:").max(500)).max(20),
            siblingUrns: z.array(z.string().startsWith("urn:li:").max(500)).max(20),
            qualitySignals: z.array(z.string().max(100)).max(20),
          })
          .strict(),
      )
      .max(50),
    analysisStatus: z.enum([
      "COMPLETED",
      "COMPLETED_WITH_LIMITATIONS",
      "INSUFFICIENT_METADATA",
      "INCOMPLETE_EVIDENCE",
    ]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const sourceIsKnown = value.knownFields.some(
      ({ fieldPath }) => fieldPath === value.sourceField.fieldPath,
    );
    const entitiesAreCanonical = value.entityContext.every(
      ({ urn }, index) =>
        index === 0 || value.entityContext[index - 1]!.urn.localeCompare(urn, "en") < 0,
    );
    const qualityAssets = value.entityContext.filter(
      ({ qualitySignals }) => qualitySignals.length > 0,
    ).length;
    const qualitySignals = value.entityContext.reduce(
      (total, entity) => total + entity.qualitySignals.length,
      0,
    );
    const entityUrns = new Set(value.entityContext.map(({ urn }) => urn));
    const relevantUrns = new Set([
      value.target.urn,
      ...value.evidence.filter(({ kind }) => kind === "downstream").map(({ urn }) => urn),
    ]);
    const unknownUrns = new Set(value.contextCoverage.unknownMetadataUrns);
    const expectedUnknownUrns = [...relevantUrns].filter((urn) => !entityUrns.has(urn));
    const invalid =
      value.schemaSummary.includedFields !== value.knownFields.length ||
      value.schemaSummary.truncated !==
        value.schemaSummary.totalFields > value.schemaSummary.includedFields ||
      !sourceIsKnown ||
      value.narrativeSummary.includedFacts !== value.facts.length ||
      value.narrativeSummary.includedAssumptions !== value.assumptions.length ||
      value.narrativeSummary.includedUnknowns !== value.unknowns.length ||
      value.entityContextRetrieval.complete !== value.contextCoverage.retrievalComplete ||
      value.entityContextRetrieval.itemCount !== value.contextCoverage.inspectedAssets ||
      value.entityContext.length !== value.contextCoverage.inspectedAssets ||
      value.contextCoverage.relevantAssets !== relevantUrns.size ||
      [...entityUrns].some((urn) => !relevantUrns.has(urn)) ||
      expectedUnknownUrns.length !== unknownUrns.size ||
      expectedUnknownUrns.some((urn) => !unknownUrns.has(urn)) ||
      value.contextCoverage.missingMetadataUrns.some((urn) => !entityUrns.has(urn)) ||
      value.contextCoverage.unknownMetadataUrns.some((urn) => entityUrns.has(urn)) ||
      value.contextIndicators.quality.assetsWithSignals !== qualityAssets ||
      value.contextIndicators.quality.signalCount !== qualitySignals ||
      !entitiesAreCanonical;
    if (invalid) ctx.addIssue({ code: "custom", message: "Inconsistent ChangeContext." });
  });
export type ChangeContext = z.infer<typeof ChangeContextSchema>;

function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function boundaryError(): never {
  throw new Error("Invalid sanitized ChangeContext.");
}

function sanitizeText(value: unknown, secrets: readonly string[], maxLength: number): string {
  return sanitizeBoundaryText(value, secrets, maxLength);
}

function sanitizeRequiredText(
  value: unknown,
  secrets: readonly string[],
  maxLength: number,
): string {
  const sanitized = sanitizeText(value, secrets, maxLength);
  if (sanitized.length === 0) boundaryError();
  return sanitized;
}

function sanitizeIdentity(value: unknown, secrets: readonly string[], maxLength: number): string {
  const sanitized = sanitizeText(value, secrets, maxLength);
  if (sanitized.length === 0 || sanitized.includes("[REDACTED]")) boundaryError();
  return sanitized;
}

function assertUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) boundaryError();
}

function sanitizeField(field: SchemaField, secrets: readonly string[]): SchemaField {
  return {
    fieldPath: sanitizeIdentity(field.fieldPath, secrets, 500),
    ...(field.nativeDataType === undefined
      ? {}
      : { nativeDataType: sanitizeText(field.nativeDataType, secrets, 100) }),
    ...(field.nullable === undefined ? {} : { nullable: field.nullable }),
    ...(field.description === undefined
      ? {}
      : { description: sanitizeText(field.description, secrets, 2_000) }),
  };
}

function sanitizeAsset(asset: LineageAsset, secrets: readonly string[]): LineageAsset {
  const lineageColumns = asset.lineageColumns.map((column) =>
    sanitizeIdentity(column, secrets, 500),
  );
  assertUnique(lineageColumns);
  return {
    urn: sanitizeIdentity(asset.urn, secrets, 500),
    ...(asset.name === undefined ? {} : { name: sanitizeText(asset.name, secrets, 500) }),
    ...(asset.platform === undefined
      ? {}
      : { platform: sanitizeText(asset.platform, secrets, 100) }),
    hop: asset.hop,
    lineageColumns,
  };
}

function sanitizeEntity(entity: EntityContext, secrets: readonly string[]): EntityContext {
  const sanitizeUrns = (values: readonly string[]): readonly string[] => {
    const sanitized = values.map((value) => sanitizeIdentity(value, secrets, 500));
    assertUnique(sanitized);
    return sanitized;
  };
  const qualitySignals = entity.qualitySignals.map((value) => sanitizeText(value, secrets, 100));
  assertUnique(qualitySignals);
  return {
    urn: sanitizeIdentity(entity.urn, secrets, 500),
    entityType: sanitizeRequiredText(entity.entityType, secrets, 100),
    ...(entity.name === undefined ? {} : { name: sanitizeText(entity.name, secrets, 500) }),
    ...(entity.platform === undefined
      ? {}
      : { platform: sanitizeText(entity.platform, secrets, 100) }),
    ...(entity.description === undefined
      ? {}
      : { description: sanitizeText(entity.description, secrets, 2_000) }),
    owners: sanitizeUrns(entity.owners),
    tags: sanitizeUrns(entity.tags),
    glossaryTerms: sanitizeUrns(entity.glossaryTerms),
    siblingUrns: sanitizeUrns(entity.siblingUrns),
    qualitySignals,
  };
}

function sanitizeTrace(entry: ToolTraceEntry, secrets: readonly string[]): ToolTraceEntry {
  const argumentsUrn = entry.arguments.urn;
  const argumentsUrns = entry.arguments.urns;
  const argumentsColumn = entry.arguments.column;
  const argumentsMaxHops = entry.arguments.max_hops;
  const argumentsOffset = entry.arguments.offset;
  const args: Record<string, unknown> = {
    ...(typeof argumentsUrn === "string"
      ? { urn: sanitizeIdentity(argumentsUrn, secrets, 500) }
      : {}),
    ...(Array.isArray(argumentsUrns)
      ? {
          urns: argumentsUrns.map((value) => {
            if (typeof value !== "string") boundaryError();
            return sanitizeIdentity(value, secrets, 500);
          }),
        }
      : {}),
    ...(typeof argumentsColumn === "string"
      ? { column: sanitizeText(argumentsColumn, secrets, 500) }
      : {}),
    ...(typeof argumentsMaxHops === "number" ? { max_hops: argumentsMaxHops } : {}),
    ...(typeof argumentsOffset === "number" ? { offset: argumentsOffset } : {}),
  };
  if (Array.isArray(args.urns)) assertUnique(args.urns);
  return {
    callId: sanitizeIdentity(entry.callId, secrets, 100),
    tool: entry.tool,
    arguments: args,
    status: entry.status,
    at: sanitizeRequiredText(entry.at, secrets, 100),
    page: entry.page,
  };
}

function sanitizeImpactReportDraft(
  unsafeReport: ImpactReportDraft,
  secrets: readonly string[],
): ImpactReportDraft {
  const schemaFields = unsafeReport.evidence.schemaFields.map((field) =>
    sanitizeField(field, secrets),
  );
  const downstreamAssets = unsafeReport.evidence.downstreamAssets.map((asset) =>
    sanitizeAsset(asset, secrets),
  );
  const columnAffectedAssets = unsafeReport.evidence.columnAffectedAssets.map((asset) =>
    sanitizeAsset(asset, secrets),
  );
  const unmatchedColumnAssets = unsafeReport.evidence.unmatchedColumnAssets.map((asset) =>
    sanitizeAsset(asset, secrets),
  );
  const entityContext = unsafeReport.evidence.entityContext.map((entity) =>
    sanitizeEntity(entity, secrets),
  );
  const searchCandidateUrns = unsafeReport.evidence.searchCandidateUrns.map((urn) =>
    sanitizeIdentity(urn, secrets, 500),
  );
  const unknownMetadataUrns = unsafeReport.evidence.contextCoverage.unknownMetadataUrns.map((urn) =>
    sanitizeIdentity(urn, secrets, 500),
  );
  const missingMetadataUrns = unsafeReport.evidence.contextCoverage.missingMetadataUrns.map((urn) =>
    sanitizeIdentity(urn, secrets, 500),
  );
  assertUnique(schemaFields.map(({ fieldPath }) => fieldPath));
  assertUnique(downstreamAssets.map(({ urn }) => urn));
  assertUnique(columnAffectedAssets.map(({ urn }) => urn));
  assertUnique(unmatchedColumnAssets.map(({ urn }) => urn));
  assertUnique(entityContext.map(({ urn }) => urn));
  assertUnique(searchCandidateUrns);
  assertUnique(unknownMetadataUrns);
  assertUnique(missingMetadataUrns);

  return {
    runId: sanitizeIdentity(unsafeReport.runId, secrets, 100),
    createdAt: sanitizeIdentity(unsafeReport.createdAt, secrets, 100),
    request: sanitizeRequiredText(unsafeReport.request, secrets, 500),
    intent: {
      kind: unsafeReport.intent.kind,
      datasetHint: sanitizeIdentity(unsafeReport.intent.datasetHint, secrets, 500),
      sourceColumn: sanitizeIdentity(unsafeReport.intent.sourceColumn, secrets, 500),
      targetColumn: sanitizeIdentity(unsafeReport.intent.targetColumn, secrets, 500),
    },
    evidence: {
      targetDataset: {
        urn: sanitizeIdentity(unsafeReport.evidence.targetDataset.urn, secrets, 500),
        name: sanitizeIdentity(unsafeReport.evidence.targetDataset.name, secrets, 500),
        ...(unsafeReport.evidence.targetDataset.platform === undefined
          ? {}
          : {
              platform: sanitizeText(unsafeReport.evidence.targetDataset.platform, secrets, 100),
            }),
        ...(unsafeReport.evidence.targetDataset.environment === undefined
          ? {}
          : {
              environment: sanitizeText(
                unsafeReport.evidence.targetDataset.environment,
                secrets,
                100,
              ),
            }),
      },
      searchCandidateUrns,
      schemaFields,
      sourceColumn: sanitizeField(unsafeReport.evidence.sourceColumn, secrets),
      downstreamAssets,
      columnAffectedAssets,
      unmatchedColumnAssets,
      evidenceLevel: unsafeReport.evidence.evidenceLevel,
      metadataGaps: unsafeReport.evidence.metadataGaps.map((gap) =>
        sanitizeText(gap, secrets, 1_200),
      ),
      trace: unsafeReport.evidence.trace.map((entry) => sanitizeTrace(entry, secrets)),
      completeness: {
        complete: unsafeReport.evidence.completeness.complete,
        search: { ...unsafeReport.evidence.completeness.search },
        schema: { ...unsafeReport.evidence.completeness.schema },
        tableLineage: { ...unsafeReport.evidence.completeness.tableLineage },
        columnLineage: { ...unsafeReport.evidence.completeness.columnLineage },
      },
      entityContextRetrieval: { ...unsafeReport.evidence.entityContextRetrieval },
      entityContext,
      contextCoverage: {
        retrievalComplete: unsafeReport.evidence.contextCoverage.retrievalComplete,
        relevantAssets: unsafeReport.evidence.contextCoverage.relevantAssets,
        inspectedAssets: unsafeReport.evidence.contextCoverage.inspectedAssets,
        retrievalPercentage: unsafeReport.evidence.contextCoverage.retrievalPercentage,
        possibleSignals: unsafeReport.evidence.contextCoverage.possibleSignals,
        coveredSignals: unsafeReport.evidence.contextCoverage.coveredSignals,
        percentage: unsafeReport.evidence.contextCoverage.percentage,
        withDescriptions: unsafeReport.evidence.contextCoverage.withDescriptions,
        withOwners: unsafeReport.evidence.contextCoverage.withOwners,
        withGovernance: unsafeReport.evidence.contextCoverage.withGovernance,
        missingMetadataUrns,
        unknownMetadataUrns,
      },
    },
    assessment: {
      score: unsafeReport.assessment.score,
      level: unsafeReport.assessment.level,
      confidence: unsafeReport.assessment.confidence,
      factors: unsafeReport.assessment.factors.map((factor) => ({
        name: factor.name,
        points: factor.points,
        explanation: sanitizeText(factor.explanation, secrets, 500),
      })),
    },
    facts: unsafeReport.facts.map((fact) => sanitizeText(fact, secrets, 1_200)),
    assumptions: unsafeReport.assumptions.map((assumption) =>
      sanitizeText(assumption, secrets, 1_200),
    ),
    unknowns: unsafeReport.unknowns.map((unknown) => sanitizeText(unknown, secrets, 1_200)),
    status: unsafeReport.status,
  };
}

function summarizeNarratives(report: ImpactReportDraft, secrets: readonly string[]) {
  const canonicalize = (values: readonly string[]) =>
    [...new Set(values.map((value) => sanitizeRequiredText(value, secrets, 1_200)))].sort(
      (left, right) => left.localeCompare(right, "en"),
    );
  const allFacts = canonicalize(report.facts);
  const allAssumptions = canonicalize(report.assumptions);
  const allUnknowns = canonicalize(report.unknowns);
  const facts = allFacts.slice(0, 100);
  const assumptions = allAssumptions.slice(0, 100);
  const unknowns = allUnknowns.slice(0, 100);
  return {
    facts,
    assumptions,
    unknowns,
    summary: {
      totalFacts: allFacts.length,
      includedFacts: facts.length,
      totalAssumptions: allAssumptions.length,
      includedAssumptions: assumptions.length,
      totalUnknowns: allUnknowns.length,
      includedUnknowns: unknowns.length,
      truncated:
        allFacts.length > facts.length ||
        allAssumptions.length > assumptions.length ||
        allUnknowns.length > unknowns.length,
      fingerprint: hashPayload({
        facts: allFacts,
        assumptions: allAssumptions,
        unknowns: allUnknowns,
      }),
    },
  };
}

export function hashChangeContext(context: Omit<ChangeContext, "contextHash">): string {
  return hashPayload({
    ...context,
    provenance: context.provenance.map(({ tool, urn, urns, direction, depth, page, offset }) => ({
      tool,
      ...(urn === undefined ? {} : { urn }),
      ...(urns === undefined ? {} : { urns }),
      ...(direction === undefined ? {} : { direction }),
      ...(depth === undefined ? {} : { depth }),
      page,
      ...(offset === undefined ? {} : { offset }),
    })),
  });
}

export function buildChangeContext(
  unsafeReport: ImpactReportDraft,
  secrets: readonly string[],
): ChangeContext {
  const report = sanitizeImpactReportDraft(unsafeReport, secrets);
  const narratives = summarizeNarratives(report, secrets);
  const columnUrns = new Set(report.evidence.columnAffectedAssets.map(({ urn }) => urn));
  const allSchemaFields = [...report.evidence.schemaFields]
    .map(({ fieldPath, nativeDataType }) => ({
      fieldPath,
      ...(nativeDataType === undefined ? {} : { nativeDataType }),
    }))
    .sort((left, right) => left.fieldPath.localeCompare(right.fieldPath, "en"));
  const sourceIndex = allSchemaFields.findIndex(
    ({ fieldPath }) => fieldPath === report.evidence.sourceColumn.fieldPath,
  );
  const sourceFirst =
    sourceIndex < 0
      ? allSchemaFields
      : [
          allSchemaFields[sourceIndex]!,
          ...allSchemaFields.filter((_, index) => index !== sourceIndex),
        ];
  const knownFields = sourceFirst.slice(0, 100);
  const evidence = [
    {
      id: "datahub:target-dataset",
      kind: "target_dataset" as const,
      level: "dataset" as const,
      urn: report.evidence.targetDataset.urn,
    },
    {
      id: `datahub:source-column:${report.evidence.sourceColumn.fieldPath}`,
      kind: "source_column" as const,
      level: "schema" as const,
      urn: report.evidence.targetDataset.urn,
      fieldPath: report.evidence.sourceColumn.fieldPath,
    },
    ...report.evidence.downstreamAssets.map((asset, index) => ({
      id: `datahub:downstream:${String(index + 1).padStart(3, "0")}`,
      kind: "downstream" as const,
      level: columnUrns.has(asset.urn) ? ("column" as const) : ("table" as const),
      urn: asset.urn,
      hop: asset.hop,
    })),
  ];
  const payload: Omit<ChangeContext, "contextHash"> = {
    schemaVersion: "1",
    request: report.request,
    intent: report.intent,
    target: report.evidence.targetDataset,
    sourceField: {
      fieldPath: report.evidence.sourceColumn.fieldPath,
      ...(report.evidence.sourceColumn.nativeDataType === undefined
        ? {}
        : { nativeDataType: report.evidence.sourceColumn.nativeDataType }),
    },
    knownFields,
    schemaSummary: {
      totalFields: allSchemaFields.length,
      includedFields: knownFields.length,
      truncated: knownFields.length < allSchemaFields.length,
      fingerprint: hashPayload(allSchemaFields),
    },
    assessment: {
      score: report.assessment.score,
      level: report.assessment.level,
      confidence: report.assessment.confidence,
      factors: report.assessment.factors.map((factor) => ({ ...factor })),
    },
    advisoryDecision: decideRisk(report.assessment.score),
    facts: narratives.facts,
    assumptions: narratives.assumptions,
    unknowns: narratives.unknowns,
    narrativeSummary: narratives.summary,
    evidence,
    provenance: report.evidence.trace.map((entry) => ({
      callId: entry.callId,
      tool: entry.tool,
      ...(typeof entry.arguments.urn === "string" ? { urn: entry.arguments.urn } : {}),
      ...(Array.isArray(entry.arguments.urns)
        ? {
            urns: entry.arguments.urns.filter(
              (value): value is string => typeof value === "string",
            ),
          }
        : {}),
      ...(entry.tool === "get_lineage" ? { direction: "downstream" as const } : {}),
      ...(typeof entry.arguments.max_hops === "number" ? { depth: entry.arguments.max_hops } : {}),
      page: entry.page,
      ...(typeof entry.arguments.offset === "number" ? { offset: entry.arguments.offset } : {}),
      at: entry.at,
    })),
    evidenceCompleteness: {
      complete: report.evidence.completeness.complete,
      search: {
        ...report.evidence.completeness.search,
        offsets: [...report.evidence.completeness.search.offsets],
        reasonCodes: [...report.evidence.completeness.search.reasonCodes],
      },
      schema: {
        ...report.evidence.completeness.schema,
        offsets: [...report.evidence.completeness.schema.offsets],
        reasonCodes: [...report.evidence.completeness.schema.reasonCodes],
      },
      tableLineage: {
        ...report.evidence.completeness.tableLineage,
        offsets: [...report.evidence.completeness.tableLineage.offsets],
        reasonCodes: [...report.evidence.completeness.tableLineage.reasonCodes],
      },
      columnLineage: {
        ...report.evidence.completeness.columnLineage,
        offsets: [...report.evidence.completeness.columnLineage.offsets],
        reasonCodes: [...report.evidence.completeness.columnLineage.reasonCodes],
      },
    },
    entityContextRetrieval: {
      ...report.evidence.entityContextRetrieval,
      offsets: [...report.evidence.entityContextRetrieval.offsets],
      reasonCodes: [...report.evidence.entityContextRetrieval.reasonCodes],
    },
    contextCoverage: {
      ...report.evidence.contextCoverage,
      missingMetadataUrns: [...report.evidence.contextCoverage.missingMetadataUrns],
      unknownMetadataUrns: [...report.evidence.contextCoverage.unknownMetadataUrns],
    },
    contextIndicators: {
      quality: {
        assetsWithSignals: report.evidence.entityContext.filter(
          ({ qualitySignals }) => qualitySignals.length > 0,
        ).length,
        signalCount: report.evidence.entityContext.reduce(
          (total, { qualitySignals }) => total + qualitySignals.length,
          0,
        ),
      },
      usage: {
        status: "NOT_COLLECTED",
        assetsWithSignals: 0,
        signalCount: 0,
        reason: "OUTSIDE_FOUR_TOOL_SLICE",
      },
    },
    entityContext: [...report.evidence.entityContext]
      .sort((left, right) => left.urn.localeCompare(right.urn, "en"))
      .map((entity) => ({
        ...entity,
        owners: [...entity.owners],
        tags: [...entity.tags],
        glossaryTerms: [...entity.glossaryTerms],
        siblingUrns: [...entity.siblingUrns],
        qualitySignals: [...entity.qualitySignals],
      })),
    analysisStatus: report.status,
  };
  try {
    return ChangeContextSchema.parse({ ...payload, contextHash: hashChangeContext(payload) });
  } catch {
    return boundaryError();
  }
}
