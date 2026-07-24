import type { ChangeContext } from "../workflow/change-context.js";
import type { MigrationPackageDraft } from "../workflow/migration-draft.js";
import type {
  MigrationArtifactFilename,
  RenderedMigrationPackage,
} from "./render-snowflake-package.js";
import { validateSqlArtifact, type PackageFinding } from "./validate-sql.js";

const requiredArtifacts = [
  "migration-up.sql",
  "migration-down.sql",
  "validation.sql",
  "rollout-plan.md",
] as const satisfies readonly MigrationArtifactFilename[];

function countExactHeading(markdown: string, heading: string): number {
  return markdown.split("\n").filter((line) => line === heading).length;
}

export function validatePackage(
  context: ChangeContext,
  draft: MigrationPackageDraft,
  rendered: RenderedMigrationPackage,
): readonly PackageFinding[] {
  const findings: PackageFinding[] = [];
  const contextEvidenceIds = new Set(context.evidence.map(({ id }) => id));
  const validDraftEvidenceIds = draft.evidenceIds.filter((id) => contextEvidenceIds.has(id));

  for (const filename of requiredArtifacts) {
    const content = rendered.files[filename] as string | undefined;
    if (content === undefined || content.trim().length === 0) {
      findings.push({
        code: "MISSING_ARTIFACT",
        message: `${filename} is required.`,
        filename,
      });
      continue;
    }
    if (!validDraftEvidenceIds.some((id) => content.includes(id))) {
      findings.push({
        code: "EVIDENCE_CITATION_MISSING",
        message: `${filename} must cite grounded evidence.`,
        filename,
      });
    }
  }

  if (
    context.advisoryDecision === "BLOCK_DIRECT_RENAME" &&
    rendered.classification === "EXECUTABLE_WITH_REVIEW"
  ) {
    findings.push({
      code: "RISK_CLASSIFICATION_MISMATCH",
      message: "Critical risk cannot be executable.",
    });
  }

  if (rendered.classification !== "NON_EXECUTABLE_TEMPLATE") {
    const hasSqlPlaceholder = (
      ["migration-up.sql", "migration-down.sql", "validation.sql"] as const
    ).some((filename) => {
      const content = rendered.files[filename] as string | undefined;
      return content !== undefined && /<[A-Z][A-Z0-9_-]*>/u.test(content);
    });
    if (hasSqlPlaceholder) {
      findings.push({
        code: "UNRESOLVED_PLACEHOLDER",
        message: "Executable SQL contains a placeholder.",
      });
    }
  }

  const downSql = rendered.files["migration-down.sql"] as string | undefined;
  if (draft.strategy === "DIRECT_RENAME" && !downSql?.includes("RENAME COLUMN")) {
    findings.push({
      code: "ROLLBACK_MISMATCH",
      message: "Direct rename requires a reverse rename.",
    });
  }

  const rollout = rendered.files["rollout-plan.md"] as string | undefined;
  if (rollout !== undefined && rollout.trim().length > 0) {
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

  for (const filename of ["migration-up.sql", "migration-down.sql", "validation.sql"] as const) {
    const content = rendered.files[filename] as string | undefined;
    if (content !== undefined) {
      findings.push(...validateSqlArtifact(filename, content, rendered.classification));
    }
  }
  return findings;
}
