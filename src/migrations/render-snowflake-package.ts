import type { ChangeContext } from "../workflow/change-context.js";
import type {
  ExecutionClassification,
  MigrationPackageDraft,
} from "../workflow/migration-draft.js";
import {
  parseSnowflakeObjectName,
  quoteSnowflakeIdentifier,
  renderSnowflakeObjectName,
} from "./snowflake-identifiers.js";
import { markdownCodeSpan } from "../security/markdown-output.js";

export type MigrationArtifactFilename =
  "migration-up.sql" | "migration-down.sql" | "validation.sql" | "rollout-plan.md";

export interface RenderedMigrationPackage {
  readonly classification: Extract<
    ExecutionClassification,
    "EXECUTABLE_WITH_REVIEW" | "ADVISORY_ONLY" | "NON_EXECUTABLE_TEMPLATE"
  >;
  readonly files: Readonly<Record<MigrationArtifactFilename, string>>;
}

function renderOwnershipReviewerGates(context: ChangeContext): string {
  const downstreamUrns = [
    ...new Set(context.evidence.filter(({ kind }) => kind === "downstream").map(({ urn }) => urn)),
  ].sort((left, right) => left.localeCompare(right, "en"));
  const entityByUrn = new Map(context.entityContext.map((entity) => [entity.urn, entity]));
  const lines = downstreamUrns.flatMap((urn) => {
    const entity = entityByUrn.get(urn);
    if (entity === undefined) {
      return [
        `- [ ] Resolve ownership for uninspected downstream asset ${markdownCodeSpan(urn)}; ownership is unknown because entity context was not retrieved.`,
      ];
    }
    if (entity.owners.length === 0) {
      return [
        `- [ ] Assign or confirm an owner for inspected downstream asset ${markdownCodeSpan(urn)}; DataHub returned no owner.`,
      ];
    }
    const owners = [...new Set(entity.owners)]
      .sort((left, right) => left.localeCompare(right, "en"))
      .map(markdownCodeSpan)
      .join(", ");
    return [
      `- [ ] Record approval for downstream asset ${markdownCodeSpan(urn)} from verified owner URNs: ${owners}.`,
    ];
  });
  if (lines.length === 0) {
    lines.push(
      "- [ ] Confirm that current DataHub evidence contains no downstream asset requiring owner approval.",
    );
  }
  return lines.join("\n");
}

function templateFiles(context: ChangeContext): RenderedMigrationPackage["files"] {
  const identity = context.target.name;
  const source = context.sourceField.fieldPath;
  const target = context.intent.targetColumn;
  const evidenceIds = context.evidence.map(({ id }) => id).join(", ");
  const markdownEvidenceIds = context.evidence.map(({ id }) => markdownCodeSpan(id)).join(", ");
  const markdownIdentity = markdownCodeSpan(identity);
  const markdownSource = markdownCodeSpan(source);
  const markdownTarget = markdownCodeSpan(target);
  return {
    "migration-up.sql": `-- LineageGuard AI — NON-EXECUTABLE TEMPLATE\n-- DataHub dataset: ${identity}\n-- Evidence: ${evidenceIds}\n-- Confirm an exact Snowflake DATABASE.SCHEMA.TABLE before execution.\n-- Staged intent: add ${target}, backfill from ${source}, migrate downstream consumers, validate, then retire ${source}.\n`,
    "migration-down.sql": `-- LineageGuard AI — NON-EXECUTABLE TEMPLATE\n-- Evidence: ${evidenceIds}\n-- Keep ${source} available during rollback.\n-- Remove ${target} only after a human confirms that no writes would be lost.\n`,
    "validation.sql": `-- LineageGuard AI — NON-EXECUTABLE TEMPLATE\n-- Evidence: ${evidenceIds}\n-- Confirm the physical table, then check source existence, target existence, row counts, null counts, backfill completion, and sampled value equality.\n`,
    "rollout-plan.md": `# Rollout Plan\n\n**Classification:** NON_EXECUTABLE_TEMPLATE\n\n**DataHub dataset:** ${markdownIdentity}\n\n**Decision:** ${context.advisoryDecision}\n\n**Evidence:** ${markdownEvidenceIds}\n\n## PR Review Summary\n\n- DataHub decision: ${context.advisoryDecision}.\n- Impact scope: ${context.evidence.filter(({ kind }) => kind === "downstream").length} visible downstream assets.\n- Package state: the physical Snowflake name is unconfirmed, so no SQL is executable.\n\n## Reviewer Gates\n\n${renderOwnershipReviewerGates(context)}\n\n1. Confirm the physical Snowflake \`DATABASE.SCHEMA.TABLE\`.\n2. Preserve ${markdownSource} and add ${markdownTarget}.\n3. Backfill and validate the target column.\n4. Coordinate the ${context.evidence.filter(({ kind }) => kind === "downstream").length} visible downstream assets.\n5. Migrate readers and writers before retiring the source column.\n6. Require human approval before every breaking step.\n7. Trigger rollback on mismatched values, unexpected nulls, or downstream errors.\n8. Complete only after validation passes, all ownership gaps are resolved, and required approvals are recorded.\n`,
  };
}

export function renderMigrationPackage(
  context: ChangeContext,
  draft: MigrationPackageDraft,
): RenderedMigrationPackage {
  const objectName = parseSnowflakeObjectName(context.target.name);
  if (
    context.target.platform?.toLocaleLowerCase("en-US") !== "snowflake" ||
    !objectName ||
    draft.strategy === "NON_EXECUTABLE_TEMPLATE" ||
    draft.executionClassification === "NON_EXECUTABLE_TEMPLATE" ||
    (draft.executionClassification === "ADVISORY_ONLY" && draft.strategy !== "STAGED_COMPATIBILITY")
  ) {
    return { classification: "NON_EXECUTABLE_TEMPLATE", files: templateFiles(context) };
  }

  const table = renderSnowflakeObjectName(objectName);
  const source = quoteSnowflakeIdentifier(context.sourceField.fieldPath);
  const target = quoteSnowflakeIdentifier(context.intent.targetColumn);
  const evidenceIds = context.evidence.map(({ id }) => id).join(", ");
  const markdownEvidenceIds = context.evidence.map(({ id }) => markdownCodeSpan(id)).join(", ");
  const nativeType = context.sourceField.nativeDataType;
  if (
    nativeType === undefined ||
    !/^[A-Za-z][A-Za-z0-9_]*(?:\(\d+(?:,\d+)?\))?$/.test(nativeType)
  ) {
    return { classification: "NON_EXECUTABLE_TEMPLATE", files: templateFiles(context) };
  }

  if (
    draft.strategy === "DIRECT_RENAME" &&
    draft.executionClassification === "EXECUTABLE_WITH_REVIEW"
  ) {
    return {
      classification: draft.executionClassification,
      files: {
        "migration-up.sql": `-- Evidence: ${evidenceIds}\nALTER TABLE ${table} RENAME COLUMN ${source} TO ${target};\n`,
        "migration-down.sql": `-- Evidence: ${evidenceIds}\nALTER TABLE ${table} RENAME COLUMN ${target} TO ${source};\n`,
        "validation.sql": `-- Evidence: ${evidenceIds}\n-- PRE-MIGRATION: confirm ${source} exists and ${target} does not.\nSHOW COLUMNS IN TABLE ${table};\n-- POST-MIGRATION: confirm the renamed target and stable row population.\nSELECT COUNT(*) AS row_count, COUNT_IF(${target} IS NULL) AS target_null_count FROM ${table};\n`,
        "rollout-plan.md": `# Rollout Plan\n\n**Classification:** ${draft.executionClassification}\n\n**Evidence:** ${markdownEvidenceIds}\n\n## PR Review Summary\n\n- DataHub decision: ${context.advisoryDecision}.\n- Impact scope: ${context.evidence.filter(({ kind }) => kind === "downstream").length} visible downstream assets.\n- Package state: direct rename is reviewable only after every deterministic gate passes.\n\n## Reviewer Gates\n\n${renderOwnershipReviewerGates(context)}\n\n1. Obtain human approval.\n2. Pause dependent deployments.\n3. Run the forward rename.\n4. Run validation.\n5. Roll back by renaming the target only if validation fails before downstream cutover.\n6. Complete only after validation passes, all ownership gaps are resolved, and required approvals are recorded.\n`,
      },
    };
  }

  return {
    classification: draft.executionClassification,
    files: {
      "migration-up.sql": `-- ${draft.executionClassification === "ADVISORY_ONLY" ? "ADVISORY ONLY — HUMAN APPROVAL REQUIRED\n-- " : ""}Evidence: ${evidenceIds}\n-- Staged migration; human review is required.\nALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${target} ${nativeType};\nUPDATE ${table} SET ${target} = ${source} WHERE ${target} IS NULL;\n`,
      "migration-down.sql": `-- ${draft.executionClassification === "ADVISORY_ONLY" ? "ADVISORY ONLY — HUMAN APPROVAL REQUIRED\n-- " : ""}Evidence: ${evidenceIds}\n-- Rollback requires review of target-only writes.\n-- ALTER TABLE ${table} DROP COLUMN IF EXISTS ${target};\n`,
      "validation.sql": `-- ${draft.executionClassification === "ADVISORY_ONLY" ? "ADVISORY ONLY — HUMAN APPROVAL REQUIRED\n-- " : ""}Evidence: ${evidenceIds}\n-- PRE-MIGRATION: confirm ${source} exists and ${target} does not.\nSHOW COLUMNS IN TABLE ${table};\n-- POST-MIGRATION: confirm source preservation, backfill completion, null counts, and sampled equality.\nSELECT COUNT(*) AS row_count, COUNT_IF(${source} IS NULL) AS source_null_count, COUNT_IF(${target} IS NULL) AS target_null_count, COUNT_IF(${source} IS DISTINCT FROM ${target}) AS mismatched_count FROM ${table};\n`,
      "rollout-plan.md": `# Rollout Plan\n\n**Classification:** ${draft.executionClassification}\n\n**Decision:** ${context.advisoryDecision}\n\n**Evidence:** ${markdownEvidenceIds}\n\n## PR Review Summary\n\n- DataHub decision: ${context.advisoryDecision}.\n- Impact scope: ${context.evidence.filter(({ kind }) => kind === "downstream").length} visible downstream assets.\n- Package state: staged compatibility requires owner coordination and human approval.\n\n## Reviewer Gates\n\n${renderOwnershipReviewerGates(context)}\n\n1. Confirm ownership and obtain human approval.\n2. Add ${markdownCodeSpan(context.intent.targetColumn)} while retaining ${markdownCodeSpan(context.sourceField.fieldPath)}.\n3. Backfill existing rows and dual-write new changes.\n4. Coordinate every evidenced downstream consumer.\n5. Run \`validation.sql\` and require zero mismatches.\n6. Migrate readers before considering source-column retirement.\n7. Trigger rollback on mismatched values, unexpected nulls, or downstream errors; keep the source and remove the target only after data review.\n8. Complete only after validation passes, all ownership gaps are resolved, and required approvals are recorded.\n`,
    },
  };
}
