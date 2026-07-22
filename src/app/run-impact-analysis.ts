import { resolve } from "node:path";
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
import { resolveDataset } from "../domain/resolve-dataset.js";
import type { RunStatus } from "../domain/run-result.js";
import { AppError, type SuppressedFailure } from "../errors/app-error.js";

export interface RunImpactAnalysisDependencies {
  readonly request: string;
  readonly catalog: DataHubCatalog;
  readonly clock: () => Date;
  readonly runId: string;
  readonly runsRoot: string;
  readonly signal: AbortSignal;
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
    "COMPLETED" | "COMPLETED_WITH_LIMITATIONS" | "INSUFFICIENT_METADATA"
  >;
}

export interface AnalysisRun extends ImpactReportDraft {
  readonly artifactPath: string;
}

export class ImpactReportPersistenceError extends AppError {
  constructor(
    readonly report: ImpactReportDraft,
    readonly attemptedPath: string,
  ) {
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

const assumptions = [
  "Dataset resolution required one exact URN, name, or platform-qualified name match.",
  "Downstream lineage inspection was bounded to two hops.",
] as const;

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

  return unknowns;
}

function deriveStatus(evidence: NormalizedEvidence): ImpactReportDraft["status"] {
  return evidence.downstreamAssets.length === 0
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
  let outcome:
    | { readonly kind: "completed"; readonly run: AnalysisRun }
    | { readonly kind: "failed"; readonly error: unknown };

  try {
    deps.signal.throwIfAborted();
    const intent = parseChangeIntent(deps.request);
    const candidates = await deps.catalog.searchDatasets(intent.datasetHint, {
      signal: deps.signal,
    });
    deps.signal.throwIfAborted();
    const target = resolveDataset(intent, candidates);
    const fields = await deps.catalog.listSchemaFields(target.urn, { signal: deps.signal });
    deps.signal.throwIfAborted();
    const sourceColumn = requireSourceColumn(fields, intent.sourceColumn);
    const tableLineage = await deps.catalog.getDownstreamLineage(target.urn, {
      maxHops: 2,
      signal: deps.signal,
    });
    deps.signal.throwIfAborted();
    const columnLineage = await deps.catalog.getDownstreamLineage(target.urn, {
      column: sourceColumn.fieldPath,
      maxHops: 2,
      signal: deps.signal,
    });
    deps.signal.throwIfAborted();
    const evidence = normalizeEvidence({
      target,
      fields,
      sourceColumn,
      tableLineage,
      columnLineage,
      trace: deps.catalog.getTrace(),
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
    deps.signal.throwIfAborted();
    const markdown = renderImpactReport(report);
    deps.signal.throwIfAborted();
    const attemptedPath = resolve(deps.runsRoot, report.runId, "impact-report.md");
    let artifactPath: string;
    try {
      artifactPath = await writeRunArtifact({
        runsRoot: deps.runsRoot,
        runId: report.runId,
        filename: "impact-report.md",
        content: markdown,
        signal: deps.signal,
      });
    } catch (error) {
      if (error instanceof AppError && error.code === "ARTIFACT_WRITE_FAILED") {
        throw new ImpactReportPersistenceError(report, attemptedPath);
      }
      throw error;
    }
    outcome = { kind: "completed", run: { ...report, artifactPath } };
  } catch (error) {
    outcome = { kind: "failed", error };
  }

  try {
    await deps.catalog.close();
  } catch (closeError) {
    if (outcome.kind === "completed") throw closeError;

    const failure: SuppressedFailure = {
      code: "MCP_UNAVAILABLE",
      message: "The DataHub catalog could not be closed after analysis failed.",
    };
    attachSuppressedFailure(outcome.error, failure);
  }

  if (outcome.kind === "failed") throw outcome.error;
  return outcome.run;
}
