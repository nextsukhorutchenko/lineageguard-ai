import { renderImpactReport } from "../artifacts/render-impact-report.js";
import { writeRunArtifact } from "../artifacts/write-run-artifacts.js";
import type { DataHubCatalog } from "../datahub/catalog.js";
import { parseChangeIntent, type ChangeIntent } from "../domain/change-intent.js";
import {
  normalizeEvidence,
  requireSourceColumn,
  type NormalizedEvidence,
  type ToolTraceEntry,
} from "../domain/evidence.js";
import { assessImpact, type ImpactAssessment } from "../domain/impact-assessment.js";
import { calculateContextCoverage } from "../domain/context-coverage.js";
import { findUniqueCanonicalDatasetUrnMatch, resolveDataset } from "../domain/resolve-dataset.js";
import type { RunStatus } from "../domain/run-result.js";
import { AppError, type SuppressedFailure } from "../errors/app-error.js";

export interface RunImpactAnalysisDependencies {
  readonly request: string;
  readonly catalog: DataHubCatalog;
  readonly clock: () => Date;
  readonly runId: string;
  readonly runsRoot: string;
  readonly signal: AbortSignal;
  readonly secrets: readonly string[];
}

export interface ImpactReportDraft {
  readonly runId: string;
  readonly createdAt: string;
  readonly request: string;
  readonly intent: ChangeIntent;
  readonly evidence: NormalizedEvidence;
  readonly assessment: ImpactAssessment;
  readonly facts: readonly string[];
  readonly assumptions: readonly string[];
  readonly unknowns: readonly string[];
  readonly status: Extract<
    RunStatus,
    "COMPLETED" | "COMPLETED_WITH_LIMITATIONS" | "INSUFFICIENT_METADATA" | "INCOMPLETE_EVIDENCE"
  >;
}

export interface AnalysisRun extends ImpactReportDraft {
  readonly artifactFilename: "impact-report.md";
}

export class ImpactReportPersistenceError extends AppError {
  readonly artifactFilename = "impact-report.md" as const;

  constructor(readonly report: ImpactReportDraft) {
    super("ARTIFACT_WRITE_FAILED", "The impact report could not be persisted.");
    this.name = "ImpactReportPersistenceError";
  }
}

interface BuildImpactReportDraftInput {
  readonly request: string;
  readonly clock: () => Date;
  readonly runId: string;
  readonly intent: ChangeIntent;
  readonly evidence: NormalizedEvidence;
  readonly assessment: ImpactAssessment;
}

type AnalysisOutcome =
  | {
      readonly kind: "readyToPublish";
      readonly report: ImpactReportDraft;
      readonly markdown: string;
    }
  | {
      readonly kind: "failed";
      readonly error: unknown;
    };

const assumptions = [
  "Dataset resolution required one exact URN, name, or platform-qualified name match.",
  "Downstream lineage inspection was bounded to two hops.",
] as const;

function cancellationError(): AppError {
  return new AppError("CANCELLED", "The run was cancelled.");
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw cancellationError();
}

function attachSuppressedFailure(error: unknown, failure: SuppressedFailure): void {
  try {
    if (error instanceof AppError) {
      error.addSuppressedFailure(failure);
    } else if (error instanceof Error && Object.isExtensible(error)) {
      Object.defineProperty(error, "suppressedFailures", {
        configurable: false,
        enumerable: false,
        value: Object.freeze([Object.freeze(failure)]),
        writable: false,
      });
    }
  } catch {
    // Cleanup metadata is secondary; the original analysis failure must remain authoritative.
  }
}

function buildFacts(evidence: NormalizedEvidence): readonly string[] {
  const facts = [
    `Selected dataset ${evidence.targetDataset.urn} was returned by DataHub.`,
    `Source column ${evidence.sourceColumn.fieldPath} is present in schema for ${evidence.targetDataset.urn}.`,
  ];

  for (const urn of evidence.searchCandidateUrns) {
    facts.push(`DataHub search returned candidate ${urn}.`);
  }

  if (evidence.targetDataset.platform !== undefined) {
    facts.push(`Selected dataset platform is ${evidence.targetDataset.platform}.`);
  }
  if (evidence.targetDataset.environment !== undefined) {
    facts.push(`Selected dataset environment is ${evidence.targetDataset.environment}.`);
  }
  for (const asset of evidence.downstreamAssets) {
    facts.push(`Downstream asset ${asset.urn} was returned at hop ${asset.hop}.`);
  }
  for (const asset of evidence.columnAffectedAssets) {
    facts.push(
      `Column-level lineage links ${evidence.sourceColumn.fieldPath} to downstream asset ${asset.urn}.`,
    );
  }

  return facts;
}

function lineageResultLimit(trace: readonly ToolTraceEntry[]): number | undefined {
  const limits = trace.flatMap((entry) => {
    if (entry.tool !== "get_lineage") return [];
    const limit = entry.arguments.max_results;
    return typeof limit === "number" && Number.isSafeInteger(limit) && limit > 0 ? [limit] : [];
  });
  return limits.length === 0 ? undefined : Math.min(...limits);
}

function buildUnknowns(evidence: NormalizedEvidence): readonly string[] {
  const unknowns: string[] = [];

  if (!evidence.completeness.search.complete) {
    unknowns.push(
      "Dataset-search candidates are a collected lower bound because required evidence is incomplete.",
    );
  }
  if (!evidence.completeness.schema.complete) {
    unknowns.push(
      "Schema-field counts are collected lower bounds because required evidence is incomplete.",
    );
  }
  if (!evidence.completeness.tableLineage.complete) {
    unknowns.push(
      "Table-lineage counts are collected lower bounds because required evidence is incomplete.",
    );
  }
  if (!evidence.completeness.columnLineage.complete) {
    unknowns.push(
      "Column-lineage counts are collected lower bounds because required evidence is incomplete.",
    );
  }

  if (evidence.downstreamAssets.length === 0) {
    unknowns.push("No downstream impact is proven because DataHub returned no downstream lineage.");
  } else if (evidence.columnAffectedAssets.length === 0) {
    unknowns.push(
      "Column-level impact is unknown; only table-level downstream lineage was returned.",
    );
  } else if (evidence.columnAffectedAssets.length < evidence.downstreamAssets.length) {
    unknowns.push("Column-level impact remains unknown for some table-level downstream assets.");
  }

  const resultLimit = lineageResultLimit(evidence.trace);
  if (
    resultLimit !== undefined &&
    (evidence.downstreamAssets.length >= resultLimit ||
      evidence.columnAffectedAssets.length >= resultLimit)
  ) {
    unknowns.push("Downstream lineage may be truncated at the MCP result limit.");
  }
  if (evidence.targetDataset.platform === undefined) {
    unknowns.push("Selected dataset platform metadata was not available.");
  }
  if (evidence.targetDataset.environment === undefined) {
    unknowns.push("Selected dataset environment metadata was not available.");
  }
  for (const asset of evidence.unmatchedColumnAssets) {
    const lineageColumns =
      asset.lineageColumns.length === 0 ? "none" : asset.lineageColumns.join(", ");
    unknowns.push(
      `Column-lineage asset ${asset.urn} was absent from table-level lineage and was not counted as confirmed; returned lineage columns: ${lineageColumns}.`,
    );
  }

  return unknowns;
}

function deriveStatus(evidence: NormalizedEvidence): ImpactReportDraft["status"] {
  return !evidence.completeness.complete
    ? "INCOMPLETE_EVIDENCE"
    : evidence.downstreamAssets.length === 0
      ? "INSUFFICIENT_METADATA"
      : evidence.evidenceLevel === "column"
        ? "COMPLETED"
        : "COMPLETED_WITH_LIMITATIONS";
}

function buildImpactReportDraft(input: BuildImpactReportDraftInput): ImpactReportDraft {
  return {
    runId: input.runId,
    createdAt: input.clock().toISOString(),
    request: input.request,
    intent: input.intent,
    evidence: input.evidence,
    assessment: input.assessment,
    facts: buildFacts(input.evidence),
    assumptions,
    unknowns: buildUnknowns(input.evidence),
    status: deriveStatus(input.evidence),
  };
}

export async function runImpactAnalysis(deps: RunImpactAnalysisDependencies): Promise<AnalysisRun> {
  let outcome: AnalysisOutcome;

  try {
    throwIfCancelled(deps.signal);
    const intent = parseChangeIntent(deps.request);
    const search = await deps.catalog.searchDatasets(intent.datasetHint, {
      signal: deps.signal,
    });
    throwIfCancelled(deps.signal);
    let target;
    if (search.completeness.complete) {
      target = resolveDataset(intent, search.items);
    } else {
      const canonicalMatch = findUniqueCanonicalDatasetUrnMatch(intent.datasetHint, search.items);
      if (canonicalMatch === undefined) {
        throw new AppError("DATAHUB_UNAVAILABLE", "Dataset search was incomplete.");
      }

      target = resolveDataset(intent, [canonicalMatch]);
    }
    const schema = await deps.catalog.listSchemaFields(target.urn, { signal: deps.signal });
    throwIfCancelled(deps.signal);
    let sourceColumn;
    try {
      sourceColumn = requireSourceColumn(schema.items, intent.sourceColumn);
    } catch (error) {
      if (!schema.completeness.complete) {
        throw new AppError("DATAHUB_UNAVAILABLE", "Dataset schema was incomplete.");
      }
      throw error;
    }
    const tableLineage = await deps.catalog.getDownstreamLineage(target.urn, {
      maxHops: 2,
      signal: deps.signal,
    });
    throwIfCancelled(deps.signal);
    const columnLineage = await deps.catalog.getDownstreamLineage(target.urn, {
      column: sourceColumn.fieldPath,
      maxHops: 2,
      signal: deps.signal,
    });
    throwIfCancelled(deps.signal);
    const relevantUrns = [target.urn, ...tableLineage.items.map(({ urn }) => urn)];
    const entityContext = await deps.catalog.getEntityContext(relevantUrns, {
      signal: deps.signal,
    });
    throwIfCancelled(deps.signal);
    const evidenceCompleteness = {
      complete:
        search.completeness.complete &&
        schema.completeness.complete &&
        tableLineage.completeness.complete &&
        columnLineage.completeness.complete,
      search: search.completeness,
      schema: schema.completeness,
      tableLineage: tableLineage.completeness,
      columnLineage: columnLineage.completeness,
    };
    const contextCoverage = calculateContextCoverage({
      relevantUrns,
      retrievalComplete: entityContext.completeness.complete,
      entities: entityContext.items,
    });
    const evidence = normalizeEvidence({
      target,
      searchCandidates: search.items,
      fields: schema.items,
      sourceColumn,
      tableLineage: tableLineage.items,
      columnLineage: columnLineage.items,
      trace: deps.catalog.getTrace(),
      completeness: evidenceCompleteness,
      entityContextRetrieval: entityContext.completeness,
      entityContext: entityContext.items,
      contextCoverage,
    });
    const assessment = assessImpact(evidence);
    const report = buildImpactReportDraft({
      request: deps.request,
      clock: deps.clock,
      runId: deps.runId,
      intent,
      evidence,
      assessment,
    });
    throwIfCancelled(deps.signal);
    const markdown = renderImpactReport(report, deps.secrets);
    throwIfCancelled(deps.signal);
    outcome = {
      kind: "readyToPublish",
      report,
      markdown,
    };
  } catch (error) {
    outcome = {
      kind: "failed",
      error: deps.signal.aborted ? cancellationError() : error,
    };
  }

  try {
    await deps.catalog.close();
  } catch (closeError) {
    if (outcome.kind === "readyToPublish") throw closeError;

    const failure: SuppressedFailure = {
      code: "MCP_UNAVAILABLE",
      message: "The DataHub catalog could not be closed after analysis failed.",
    };
    attachSuppressedFailure(outcome.error, failure);
  }

  if (outcome.kind === "failed") throw outcome.error;

  throwIfCancelled(deps.signal);

  let artifactFilename: "impact-report.md";
  try {
    artifactFilename = await writeRunArtifact({
      runsRoot: deps.runsRoot,
      runId: outcome.report.runId,
      filename: "impact-report.md",
      content: outcome.markdown,
      status: outcome.report.status,
      signal: deps.signal,
    });
  } catch (error) {
    if (error instanceof AppError && error.code === "ARTIFACT_WRITE_FAILED") {
      throw new ImpactReportPersistenceError(outcome.report);
    }
    throw error;
  }

  return { ...outcome.report, artifactFilename };
}
