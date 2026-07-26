import type { ChangeContext } from "../workflow/change-context.js";
import type { MigrationPackageDraft } from "../workflow/migration-draft.js";
import { markdownCodeSpan } from "../security/markdown-output.js";
import type {
  MigrationArtifactFilename,
  RenderedMigrationPackage,
} from "./render-snowflake-package.js";
import {
  parseSnowflakeObjectName,
  quoteSnowflakeIdentifier,
  renderSnowflakeObjectName,
} from "./snowflake-identifiers.js";
import {
  executableSqlStatements,
  parseSnowflakeRenameStatement,
  validateSqlArtifact,
  type PackageFinding,
} from "./validate-sql.js";

const requiredArtifacts = [
  "migration-up.sql",
  "migration-down.sql",
  "validation.sql",
  "rollout-plan.md",
] as const satisfies readonly MigrationArtifactFilename[];
const sqlArtifacts = ["migration-up.sql", "migration-down.sql", "validation.sql"] as const;

type SqlArtifactFilename = (typeof sqlArtifacts)[number];
type ExpectedSqlPlan = Readonly<Record<SqlArtifactFilename, readonly string[]>>;

const executableNativeType = /^[A-Za-z][A-Za-z0-9_]*(?:\(\d+(?:,\d+)?\))?$/;

function countExactHeading(markdown: string, heading: string): number {
  return markdown.split("\n").filter((line) => line === heading).length;
}

function hasExactEvidenceCitation(
  filename: MigrationArtifactFilename,
  content: string,
  contextEvidenceIds: readonly string[],
  validDraftEvidenceIds: readonly string[],
): boolean {
  if (validDraftEvidenceIds.length === 0) return false;
  const lines = new Set(content.split("\n"));
  if (filename === "rollout-plan.md") {
    const contextCodeSpans = contextEvidenceIds.map(markdownCodeSpan);
    const draftCodeSpans = validDraftEvidenceIds.map(markdownCodeSpan);
    return (
      lines.has(`**Evidence:** ${contextCodeSpans.join(", ")}`) ||
      lines.has(`**Evidence:** ${draftCodeSpans.join(", ")}`) ||
      draftCodeSpans.some((codeSpan) => lines.has(`**Evidence:** ${codeSpan}`))
    );
  }
  return (
    lines.has(`-- Evidence: ${contextEvidenceIds.join(", ")}`) ||
    lines.has(`-- Evidence: ${validDraftEvidenceIds.join(", ")}`) ||
    validDraftEvidenceIds.some((id) => lines.has(`-- Evidence: ${id}`))
  );
}

function expectedSqlPlan(
  context: ChangeContext,
  draft: MigrationPackageDraft,
): ExpectedSqlPlan | undefined {
  if (draft.strategy === "NON_EXECUTABLE_TEMPLATE") {
    return {
      "migration-up.sql": [],
      "migration-down.sql": [],
      "validation.sql": [],
    };
  }

  const objectName = parseSnowflakeObjectName(context.target.name);
  const nativeType = context.sourceField.nativeDataType;
  if (
    context.target.platform?.toLocaleLowerCase("en-US") !== "snowflake" ||
    objectName === undefined ||
    nativeType === undefined ||
    !executableNativeType.test(nativeType)
  ) {
    return undefined;
  }

  const table = renderSnowflakeObjectName(objectName);
  const source = quoteSnowflakeIdentifier(context.sourceField.fieldPath);
  const target = quoteSnowflakeIdentifier(context.intent.targetColumn);
  const showColumns = `SHOW COLUMNS IN TABLE ${table}`;

  if (draft.strategy === "DIRECT_RENAME") {
    return {
      "migration-up.sql": [`ALTER TABLE ${table} RENAME COLUMN ${source} TO ${target}`],
      "migration-down.sql": [`ALTER TABLE ${table} RENAME COLUMN ${target} TO ${source}`],
      "validation.sql": [
        showColumns,
        `SELECT COUNT(*) AS row_count, COUNT_IF(${target} IS NULL) AS target_null_count FROM ${table}`,
      ],
    };
  }

  return {
    "migration-up.sql": [
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${target} ${nativeType}`,
      `UPDATE ${table} SET ${target} = ${source} WHERE ${target} IS NULL`,
    ],
    "migration-down.sql": [],
    "validation.sql": [
      showColumns,
      `SELECT COUNT(*) AS row_count, COUNT_IF(${source} IS NULL) AS source_null_count, COUNT_IF(${target} IS NULL) AS target_null_count, COUNT_IF(${source} IS DISTINCT FROM ${target}) AS mismatched_count FROM ${table}`,
    ],
  };
}

function statementsEqual(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((statement, index) => statement === expected[index])
  );
}

export function validatePackage(
  context: ChangeContext,
  draft: MigrationPackageDraft,
  rendered: RenderedMigrationPackage,
): readonly PackageFinding[] {
  const findings: PackageFinding[] = [];
  const orderedContextEvidenceIds = context.evidence.map(({ id }) => id);
  const contextEvidenceIds = new Set(orderedContextEvidenceIds);
  const validDraftEvidenceIds = draft.evidenceIds.filter((id) => contextEvidenceIds.has(id));
  const runtimeFiles: Readonly<Record<string, unknown>> =
    rendered.files !== null && typeof rendered.files === "object" && !Array.isArray(rendered.files)
      ? (rendered.files as unknown as Readonly<Record<string, unknown>>)
      : {};
  const requiredArtifactSet = new Set<string>(requiredArtifacts);
  if (Object.keys(runtimeFiles).some((filename) => !requiredArtifactSet.has(filename))) {
    findings.push({
      code: "UNKNOWN_ARTIFACT",
      message: "The package contains a filename outside the artifact allowlist.",
    });
  }

  for (const filename of requiredArtifacts) {
    const unsafeContent = runtimeFiles[filename];
    if (typeof unsafeContent !== "string" || unsafeContent.trim().length === 0) {
      findings.push({
        code: "MISSING_ARTIFACT",
        message: `${filename} is required.`,
        filename,
      });
      continue;
    }
    if (
      !hasExactEvidenceCitation(
        filename,
        unsafeContent,
        orderedContextEvidenceIds,
        validDraftEvidenceIds,
      )
    ) {
      findings.push({
        code: "EVIDENCE_CITATION_MISSING",
        message: `${filename} must cite grounded evidence.`,
        filename,
      });
    }
  }

  const expectedPlan = expectedSqlPlan(context, draft);
  for (const filename of sqlArtifacts) {
    const content = runtimeFiles[filename];
    const actual = typeof content === "string" ? executableSqlStatements(content) : [];
    const expected = expectedPlan?.[filename];
    if (expected === undefined || !statementsEqual(actual, expected)) {
      findings.push({
        code: "SQL_ARTIFACT_MISMATCH",
        message: `${filename} does not match the context-grounded strategy plan.`,
        filename,
      });
    }
  }

  if (rendered.classification !== draft.executionClassification) {
    findings.push({
      code: "CLASSIFICATION_MISMATCH",
      message: "Rendered classification must match the validated draft.",
    });
  }

  if (
    context.advisoryDecision !== "PROCEED_WITH_REVIEW" &&
    rendered.classification === "EXECUTABLE_WITH_REVIEW"
  ) {
    findings.push({
      code: "RISK_CLASSIFICATION_MISMATCH",
      message: "Risk policy does not permit executable output.",
    });
  }

  if (rendered.classification !== "NON_EXECUTABLE_TEMPLATE") {
    const hasSqlPlaceholder = sqlArtifacts.some((filename) => {
      const content = runtimeFiles[filename];
      return typeof content === "string" && /<[A-Z][A-Z0-9_-]*>/u.test(content);
    });
    if (hasSqlPlaceholder) {
      findings.push({
        code: "UNRESOLVED_PLACEHOLDER",
        message: "Executable SQL contains a placeholder.",
      });
    }
  }

  if (rendered.classification !== "NON_EXECUTABLE_TEMPLATE") {
    const executableRequired = [
      "migration-up.sql",
      "validation.sql",
      ...(draft.strategy === "DIRECT_RENAME" ? (["migration-down.sql"] as const) : []),
    ] as const;
    for (const filename of executableRequired) {
      const content = runtimeFiles[filename];
      if (typeof content === "string" && executableSqlStatements(content).length === 0) {
        findings.push({
          code: "MISSING_EXECUTABLE_SQL",
          message: `${filename} requires executable SQL for this strategy.`,
          filename,
        });
      }
    }
  }

  if (draft.strategy === "DIRECT_RENAME") {
    const upSql = runtimeFiles["migration-up.sql"];
    const downSql = runtimeFiles["migration-down.sql"];
    const forwardStatements = typeof upSql === "string" ? executableSqlStatements(upSql) : [];
    const rollbackStatements = typeof downSql === "string" ? executableSqlStatements(downSql) : [];
    const forward =
      forwardStatements.length === 1
        ? parseSnowflakeRenameStatement(forwardStatements[0]!)
        : undefined;
    const rollback =
      rollbackStatements.length === 1
        ? parseSnowflakeRenameStatement(rollbackStatements[0]!)
        : undefined;
    if (
      forward === undefined ||
      rollback === undefined ||
      forward.table !== rollback.table ||
      forward.source !== rollback.target ||
      forward.target !== rollback.source
    ) {
      findings.push({
        code: "ROLLBACK_MISMATCH",
        message: "Direct rename requires one exact inverse rename.",
      });
    }
  }

  const rollout = runtimeFiles["rollout-plan.md"];
  if (typeof rollout === "string" && rollout.trim().length > 0) {
    for (const heading of ["## PR Review Summary", "## Reviewer Gates"] as const) {
      const count = countExactHeading(rollout, heading);
      if (count === 0) {
        findings.push({
          code: "ROLLOUT_SECTION_MISSING",
          message: `${heading} is required exactly once.`,
          filename: "rollout-plan.md",
        });
      } else if (count > 1) {
        findings.push({
          code: "ROLLOUT_SECTION_DUPLICATE",
          message: `${heading} must appear exactly once.`,
          filename: "rollout-plan.md",
        });
      }
    }
  }

  for (const filename of sqlArtifacts) {
    const content = runtimeFiles[filename];
    if (typeof content === "string") {
      findings.push(...validateSqlArtifact(filename, content, rendered.classification));
    }
  }
  return findings;
}
