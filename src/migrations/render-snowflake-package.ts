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

function renderLines(lines: readonly string[]): string {
  return `${lines.join("\n")}\n`;
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
    "migration-up.sql": renderLines([
      "-- LineageGuard AI — NON-EXECUTABLE TEMPLATE",
      `-- DataHub dataset: ${identity}`,
      `-- Evidence: ${evidenceIds}`,
      "-- Confirm an exact Snowflake DATABASE.SCHEMA.TABLE before execution.",
      `-- Staged intent: add ${target}, backfill from ${source}, migrate downstream consumers, validate, then retire ${source}.`,
    ]),
    "migration-down.sql": renderLines([
      "-- LineageGuard AI — NON-EXECUTABLE TEMPLATE",
      `-- Evidence: ${evidenceIds}`,
      `-- Keep ${source} available during rollback.`,
      `-- Remove ${target} only after a human confirms that no writes would be lost.`,
    ]),
    "validation.sql": renderLines([
      "-- LineageGuard AI — NON-EXECUTABLE TEMPLATE",
      `-- Evidence: ${evidenceIds}`,
      "-- Confirm the physical table, then check source existence, target existence, row counts, null counts, backfill completion, and sampled value equality.",
    ]),
    "rollout-plan.md": renderLines([
      "# Rollout Plan",
      "",
      "**Classification:** NON_EXECUTABLE_TEMPLATE",
      "",
      `**DataHub dataset:** ${markdownIdentity}`,
      "",
      `**Decision:** ${context.advisoryDecision}`,
      "",
      `**Evidence:** ${markdownEvidenceIds}`,
      "",
      "## PR Review Summary",
      "",
      `- DataHub decision: ${context.advisoryDecision}.`,
      `- Impact scope: ${context.evidence.filter(({ kind }) => kind === "downstream").length} visible downstream assets.`,
      "- Package state: the physical Snowflake name is unconfirmed, so no SQL is executable.",
      "",
      "## Reviewer Gates",
      "",
      renderOwnershipReviewerGates(context),
      "",
      "1. Confirm the physical Snowflake `DATABASE.SCHEMA.TABLE`.",
      `2. Preserve ${markdownSource} and add ${markdownTarget}.`,
      "3. Backfill and validate the target column.",
      `4. Coordinate the ${context.evidence.filter(({ kind }) => kind === "downstream").length} visible downstream assets.`,
      "5. Migrate readers and writers before retiring the source column.",
      "6. Require human approval before every breaking step.",
      "7. Trigger rollback on mismatched values, unexpected nulls, or downstream errors.",
      "8. Complete only after validation passes, all ownership gaps are resolved, and required approvals are recorded.",
    ]),
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
        "migration-up.sql": renderLines([
          `-- Evidence: ${evidenceIds}`,
          `ALTER TABLE ${table} RENAME COLUMN ${source} TO ${target};`,
        ]),
        "migration-down.sql": renderLines([
          `-- Evidence: ${evidenceIds}`,
          `ALTER TABLE ${table} RENAME COLUMN ${target} TO ${source};`,
        ]),
        "validation.sql": renderLines([
          `-- Evidence: ${evidenceIds}`,
          `-- PRE-MIGRATION: confirm ${source} exists and ${target} does not.`,
          `SHOW COLUMNS IN TABLE ${table};`,
          "-- POST-MIGRATION: confirm the renamed target and stable row population.",
          `SELECT COUNT(*) AS row_count, COUNT_IF(${target} IS NULL) AS target_null_count FROM ${table};`,
        ]),
        "rollout-plan.md": renderLines([
          "# Rollout Plan",
          "",
          `**Classification:** ${draft.executionClassification}`,
          "",
          `**Evidence:** ${markdownEvidenceIds}`,
          "",
          "## PR Review Summary",
          "",
          `- DataHub decision: ${context.advisoryDecision}.`,
          `- Impact scope: ${context.evidence.filter(({ kind }) => kind === "downstream").length} visible downstream assets.`,
          "- Package state: direct rename is reviewable only after every deterministic gate passes.",
          "",
          "## Reviewer Gates",
          "",
          renderOwnershipReviewerGates(context),
          "",
          "1. Obtain human approval.",
          "2. Pause dependent deployments.",
          "3. Run the forward rename.",
          "4. Run validation.",
          "5. Roll back by renaming the target only if validation fails before downstream cutover.",
          "6. Complete only after validation passes, all ownership gaps are resolved, and required approvals are recorded.",
        ]),
      },
    };
  }

  const sqlPreamble =
    draft.executionClassification === "ADVISORY_ONLY"
      ? ["-- ADVISORY ONLY — HUMAN APPROVAL REQUIRED", `-- Evidence: ${evidenceIds}`]
      : [`-- Evidence: ${evidenceIds}`];
  return {
    classification: draft.executionClassification,
    files: {
      "migration-up.sql": renderLines([
        ...sqlPreamble,
        "-- Staged migration; human review is required.",
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${target} ${nativeType};`,
        `UPDATE ${table} SET ${target} = ${source} WHERE ${target} IS NULL;`,
      ]),
      "migration-down.sql": renderLines([
        ...sqlPreamble,
        "-- Rollback requires review of target-only writes.",
        `-- ALTER TABLE ${table} DROP COLUMN IF EXISTS ${target};`,
      ]),
      "validation.sql": renderLines([
        ...sqlPreamble,
        `-- PRE-MIGRATION: confirm ${source} exists and ${target} does not.`,
        `SHOW COLUMNS IN TABLE ${table};`,
        "-- POST-MIGRATION: confirm source preservation, backfill completion, null counts, and sampled equality.",
        `SELECT COUNT(*) AS row_count, COUNT_IF(${source} IS NULL) AS source_null_count, COUNT_IF(${target} IS NULL) AS target_null_count, COUNT_IF(${source} IS DISTINCT FROM ${target}) AS mismatched_count FROM ${table};`,
      ]),
      "rollout-plan.md": renderLines([
        "# Rollout Plan",
        "",
        `**Classification:** ${draft.executionClassification}`,
        "",
        `**Decision:** ${context.advisoryDecision}`,
        "",
        `**Evidence:** ${markdownEvidenceIds}`,
        "",
        "## PR Review Summary",
        "",
        `- DataHub decision: ${context.advisoryDecision}.`,
        `- Impact scope: ${context.evidence.filter(({ kind }) => kind === "downstream").length} visible downstream assets.`,
        "- Package state: staged compatibility requires owner coordination and human approval.",
        "",
        "## Reviewer Gates",
        "",
        renderOwnershipReviewerGates(context),
        "",
        "1. Confirm ownership and obtain human approval.",
        `2. Add ${markdownCodeSpan(context.intent.targetColumn)} while retaining ${markdownCodeSpan(context.sourceField.fieldPath)}.`,
        "3. Backfill existing rows and dual-write new changes.",
        "4. Coordinate every evidenced downstream consumer.",
        "5. Run `validation.sql` and require zero mismatches.",
        "6. Migrate readers before considering source-column retirement.",
        "7. Trigger rollback on mismatched values, unexpected nulls, or downstream errors; keep the source and remove the target only after data review.",
        "8. Complete only after validation passes, all ownership gaps are resolved, and required approvals are recorded.",
      ]),
    },
  };
}
