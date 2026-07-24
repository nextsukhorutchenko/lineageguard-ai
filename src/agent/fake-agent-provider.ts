import type { ChangeContext } from "../workflow/change-context.js";
import type { MigrationPackageDraft } from "../workflow/migration-draft.js";
import type { AgentProvider, AgentProviderResult } from "./provider.js";

export function createGoldenDraft(context: ChangeContext): MigrationPackageDraft {
  const identityEvidenceIncomplete =
    !context.evidenceCompleteness.search.complete || !context.evidenceCompleteness.schema.complete;
  const lineageEvidenceIncomplete =
    !context.evidenceCompleteness.tableLineage.complete ||
    !context.evidenceCompleteness.columnLineage.complete;
  const decisionWarnings: MigrationPackageDraft["warnings"] =
    context.advisoryDecision === "BLOCK_DIRECT_RENAME" ? ["DIRECT_RENAME_BLOCKED"] : [];
  const completenessWarnings: MigrationPackageDraft["warnings"] = lineageEvidenceIncomplete
    ? ["COLUMN_LINEAGE_INCOMPLETE"]
    : [];
  return {
    schemaVersion: "1",
    strategy: identityEvidenceIncomplete ? "NON_EXECUTABLE_TEMPLATE" : "STAGED_COMPATIBILITY",
    executionClassification: identityEvidenceIncomplete
      ? "NON_EXECUTABLE_TEMPLATE"
      : lineageEvidenceIncomplete || context.advisoryDecision !== "PROCEED_WITH_REVIEW"
        ? "ADVISORY_ONLY"
        : "EXECUTABLE_WITH_REVIEW",
    rationale:
      identityEvidenceIncomplete || lineageEvidenceIncomplete
        ? "METADATA_LIMITED"
        : context.advisoryDecision === "BLOCK_DIRECT_RENAME"
          ? "CRITICAL_DOWNSTREAM_IMPACT"
          : "DOWNSTREAM_COORDINATION_REQUIRED",
    evidenceIds: context.evidence.map(({ id }) => id),
    stages: [
      "PREPARE",
      "ADD_COMPATIBLE_COLUMN",
      "BACKFILL",
      "MIGRATE_DOWNSTREAM",
      "VALIDATE",
      "RETIRE_SOURCE_COLUMN",
    ],
    validationChecks: [
      "SOURCE_COLUMN_EXISTS",
      "TARGET_COLUMN_ABSENT_BEFORE_CHANGE",
      "TARGET_COLUMN_EXISTS",
      "ROW_COUNT_STABLE",
      "NULL_COUNT_COMPARE",
      "BACKFILL_COMPLETE",
      "SAMPLED_VALUE_COMPARE",
    ],
    rollback: "KEEP_SOURCE_AND_REMOVE_TARGET_AFTER_REVIEW",
    warnings: [
      ...decisionWarnings,
      "HUMAN_APPROVAL_REQUIRED",
      "DOWNSTREAM_COORDINATION_REQUIRED",
      ...completenessWarnings,
      "PHYSICAL_OBJECT_NAME_UNCONFIRMED",
      "ROLLBACK_REQUIRES_DATA_REVIEW",
    ],
  };
}

export class FakeAgentProvider implements AgentProvider {
  async run(input: Parameters<AgentProvider["run"]>[0]): Promise<AgentProviderResult> {
    input.signal.throwIfAborted();
    const analysis = await input.tools.analyzeRenameChange(
      { request: input.request },
      input.signal,
    );
    if (analysis.kind === "clarification") {
      return {
        status: "needs_clarification",
        provider: "fixture",
        model: "replay-v1",
        reasoningEffort: "none",
        analysisCalls: 1,
        generationAttempts: 0,
        candidates: analysis.candidates,
        ...(analysis.omittedCandidateCount === undefined
          ? {}
          : { omittedCandidateCount: analysis.omittedCandidateCount }),
      };
    }
    if (analysis.kind === "failed") {
      return {
        status: "failed",
        provider: "fixture",
        model: "replay-v1",
        reasoningEffort: "none",
        analysisCalls: 1,
        generationAttempts: 0,
        message: analysis.message,
        failure: {
          code: analysis.code,
          message: analysis.message,
          ...(analysis.knownFields === undefined ? {} : { knownFields: analysis.knownFields }),
        },
      };
    }
    const generated = await input.tools.generateMigrationPackage(
      createGoldenDraft(analysis.context),
      input.signal,
    );
    return {
      status: generated.kind === "accepted" ? "completed" : "failed",
      provider: "fixture",
      model: "replay-v1",
      reasoningEffort: "none",
      analysisCalls: 1,
      generationAttempts: 1,
      ...(generated.kind === "rejected"
        ? { message: generated.findings.map(({ message }) => message).join(" ") }
        : {}),
    };
  }
}
