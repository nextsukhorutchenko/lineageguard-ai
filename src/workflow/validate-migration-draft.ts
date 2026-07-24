import type { ChangeContext } from "./change-context.js";
import type { MigrationPackageDraft } from "./migration-draft.js";

export interface DraftValidationFinding {
  readonly code:
    | "UNKNOWN_EVIDENCE_REFERENCE"
    | "MISSING_REQUIRED_EVIDENCE"
    | "DIRECT_RENAME_BLOCKED"
    | "STRATEGY_CLASSIFICATION_MISMATCH"
    | "INCOMPLETE_EVIDENCE_CLASSIFICATION"
    | "RISK_CLASSIFICATION_MISMATCH"
    | "UNSUPPORTED_PLATFORM"
    | "STAGED_SEQUENCE_REQUIRED"
    | "ROLLBACK_POLICY_MISMATCH";
  readonly message: string;
}

const stagedSequence = [
  "PREPARE",
  "ADD_COMPATIBLE_COLUMN",
  "BACKFILL",
  "MIGRATE_DOWNSTREAM",
  "VALIDATE",
  "RETIRE_SOURCE_COLUMN",
] as const;

export function validateMigrationDraft(
  context: ChangeContext,
  draft: MigrationPackageDraft,
): readonly DraftValidationFinding[] {
  const findings: DraftValidationFinding[] = [];
  if (
    (draft.strategy === "NON_EXECUTABLE_TEMPLATE") !==
      (draft.executionClassification === "NON_EXECUTABLE_TEMPLATE") ||
    (draft.strategy === "DIRECT_RENAME" &&
      draft.executionClassification !== "EXECUTABLE_WITH_REVIEW") ||
    (draft.executionClassification === "ADVISORY_ONLY" && draft.strategy !== "STAGED_COMPATIBILITY")
  ) {
    findings.push({
      code: "STRATEGY_CLASSIFICATION_MISMATCH",
      message: "Strategy and execution classification do not form an allowed pair.",
    });
  }
  const knownEvidence = new Set(context.evidence.map(({ id }) => id));
  for (const id of draft.evidenceIds) {
    if (!knownEvidence.has(id)) {
      findings.push({
        code: "UNKNOWN_EVIDENCE_REFERENCE",
        message: `Evidence reference ${id} is not present in ChangeContext.`,
      });
    }
  }
  for (const id of [
    "datahub:target-dataset",
    `datahub:source-column:${context.sourceField.fieldPath}`,
  ]) {
    if (!draft.evidenceIds.includes(id)) {
      findings.push({
        code: "MISSING_REQUIRED_EVIDENCE",
        message: `Required evidence reference ${id} is missing.`,
      });
    }
  }
  if (context.advisoryDecision === "BLOCK_DIRECT_RENAME" && draft.strategy === "DIRECT_RENAME") {
    findings.push({
      code: "DIRECT_RENAME_BLOCKED",
      message: "Critical impact blocks a direct rename strategy.",
    });
  }
  const { search, schema, tableLineage, columnLineage } = context.evidenceCompleteness;
  const identityEvidenceIncomplete = !search.complete || !schema.complete;
  const lineageEvidenceIncomplete = !tableLineage.complete || !columnLineage.complete;
  if (
    (identityEvidenceIncomplete && draft.executionClassification !== "NON_EXECUTABLE_TEMPLATE") ||
    (lineageEvidenceIncomplete && draft.executionClassification === "EXECUTABLE_WITH_REVIEW") ||
    ((!context.evidenceCompleteness.complete || identityEvidenceIncomplete) &&
      draft.strategy === "DIRECT_RENAME")
  ) {
    findings.push({
      code: "INCOMPLETE_EVIDENCE_CLASSIFICATION",
      message: "Incomplete DataHub evidence cannot support this strategy or classification.",
    });
  }
  if (
    context.advisoryDecision !== "PROCEED_WITH_REVIEW" &&
    draft.executionClassification === "EXECUTABLE_WITH_REVIEW"
  ) {
    findings.push({
      code: "RISK_CLASSIFICATION_MISMATCH",
      message: "The risk policy requires an advisory or non-executable classification.",
    });
  }
  if (
    context.target.platform?.toLocaleLowerCase("en-US") !== "snowflake" &&
    draft.executionClassification !== "NON_EXECUTABLE_TEMPLATE"
  ) {
    findings.push({
      code: "UNSUPPORTED_PLATFORM",
      message: "Only confirmed Snowflake context may produce Snowflake SQL.",
    });
  }
  if (
    draft.strategy === "STAGED_COMPATIBILITY" &&
    JSON.stringify(draft.stages) !== JSON.stringify(stagedSequence)
  ) {
    findings.push({
      code: "STAGED_SEQUENCE_REQUIRED",
      message: "The staged strategy must preserve the approved compatibility sequence.",
    });
  }
  if (
    draft.strategy === "STAGED_COMPATIBILITY" &&
    draft.rollback !== "KEEP_SOURCE_AND_REMOVE_TARGET_AFTER_REVIEW"
  ) {
    findings.push({
      code: "ROLLBACK_POLICY_MISMATCH",
      message: "The staged strategy must keep the source column during rollback.",
    });
  }
  return findings;
}
