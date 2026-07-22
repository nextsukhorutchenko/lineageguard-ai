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

export interface RunImpactAnalysisDependencies {
  readonly request: string;
  readonly catalog: DataHubCatalog;
  readonly clock: () => Date;
  readonly runId: string;
  readonly runsRoot: string;
}

export interface AnalysisRun {
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
  readonly artifactPath?: string;
}

interface BuildAnalysisRunInput extends RunImpactAnalysisDependencies {
  readonly intent: ChangeIntent;
  readonly evidence: NormalizedEvidence;
  readonly assessment: ImpactAssessment;
  readonly status: AnalysisRun["status"];
}

const assumptions = [
  "Dataset resolution required one exact URN, name, or platform-qualified name match.",
  "Downstream lineage inspection was bounded to two hops.",
] as const;

function buildFacts(evidence: NormalizedEvidence): readonly string[] {
  const facts = [
    `Selected dataset ${evidence.targetDataset.urn} was returned by DataHub.`,
    `Source column ${evidence.sourceColumn.fieldPath} is present in schema for ${evidence.targetDataset.urn}.`,
  ];

  if (evidence.targetDataset.platform !== undefined) {
    facts.push(`Selected dataset platform is ${evidence.targetDataset.platform}.`);
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
  unknowns.push("Selected dataset environment metadata was not available.");

  return unknowns;
}

export function buildAnalysisRun(input: BuildAnalysisRunInput): AnalysisRun {
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
    status: input.status,
  };
}

export async function runImpactAnalysis(deps: RunImpactAnalysisDependencies): Promise<AnalysisRun> {
  const intent = parseChangeIntent(deps.request);

  try {
    const candidates = await deps.catalog.searchDatasets(intent.datasetHint);
    const target = resolveDataset(intent, candidates);
    const fields = await deps.catalog.listSchemaFields(target.urn);
    const sourceColumn = requireSourceColumn(fields, intent.sourceColumn);
    const tableLineage = await deps.catalog.getDownstreamLineage(target.urn, { maxHops: 2 });
    const columnLineage = await deps.catalog.getDownstreamLineage(target.urn, {
      column: sourceColumn.fieldPath,
      maxHops: 2,
    });
    const evidence = normalizeEvidence({
      target,
      fields,
      sourceColumn,
      tableLineage,
      columnLineage,
      trace: deps.catalog.getTrace(),
    });
    const assessment = assessImpact(evidence);
    const status: AnalysisRun["status"] =
      evidence.downstreamAssets.length === 0
        ? "INSUFFICIENT_METADATA"
        : evidence.evidenceLevel === "column"
          ? "COMPLETED"
          : "COMPLETED_WITH_LIMITATIONS";
    const run = buildAnalysisRun({ ...deps, intent, evidence, assessment, status });
    const markdown = renderImpactReport(run);
    const artifactPath = await writeRunArtifact({
      runsRoot: deps.runsRoot,
      runId: run.runId,
      filename: "impact-report.md",
      content: markdown,
    });
    return { ...run, artifactPath };
  } finally {
    await deps.catalog.close();
  }
}
