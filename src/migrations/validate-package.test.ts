import { describe, expect, it } from "vitest";
import { makeChangeContext, makeMigrationDraft } from "../../tests/helpers/factories.js";
import type { ChangeContext } from "../workflow/change-context.js";
import type { MigrationPackageDraft } from "../workflow/migration-draft.js";
import {
  renderMigrationPackage,
  type MigrationArtifactFilename,
  type RenderedMigrationPackage,
} from "./render-snowflake-package.js";
import { validatePackage } from "./validate-package.js";

function directDraft(context: ChangeContext): MigrationPackageDraft {
  return {
    ...makeMigrationDraft(context),
    strategy: "DIRECT_RENAME",
    executionClassification: "EXECUTABLE_WITH_REVIEW",
    rationale: "LOW_RISK_CONFIRMED_RENAME",
    stages: ["PREPARE", "DIRECT_RENAME", "VALIDATE"],
    rollback: "RENAME_TARGET_BACK_TO_SOURCE",
    warnings: [],
  };
}

function replaceFile(
  rendered: RenderedMigrationPackage,
  filename: MigrationArtifactFilename,
  content: string,
): RenderedMigrationPackage {
  return {
    ...rendered,
    files: {
      ...rendered.files,
      [filename]: content,
    },
  };
}

function packageFor(mode: "template" | "direct" | "staged"): {
  readonly context: ChangeContext;
  readonly draft: MigrationPackageDraft;
  readonly rendered: RenderedMigrationPackage;
} {
  const context = makeChangeContext({
    datasetName:
      mode === "template"
        ? "b2fd91.order_entry_db.analytics.order_details"
        : "ORDER_ENTRY_DB.ANALYTICS.ORDER_DETAILS",
    score: mode === "direct" ? 20 : 90,
  });
  const draft = mode === "direct" ? directDraft(context) : makeMigrationDraft(context);
  return { context, draft, rendered: renderMigrationPackage(context, draft) };
}

it("accepts the golden non-executable four-file template", () => {
  const { context, draft, rendered } = packageFor("template");

  expect(validatePackage(context, draft, rendered)).toEqual([]);
});

it.each(["template", "direct", "staged"] as const)(
  "accepts exactly one required review section in a rendered %s package",
  (mode) => {
    const { context, draft, rendered } = packageFor(mode);
    const sectionFindings = validatePackage(context, draft, rendered).filter((finding) =>
      finding.code.startsWith("ROLLOUT_SECTION_"),
    );

    expect(sectionFindings).toEqual([]);
  },
);

it.each(["migration-up.sql", "migration-down.sql", "validation.sql", "rollout-plan.md"] as const)(
  "requires non-empty artifact %s",
  (filename) => {
    const { context, draft, rendered } = packageFor("template");

    expect(validatePackage(context, draft, replaceFile(rendered, filename, "   "))).toContainEqual(
      expect.objectContaining({ code: "MISSING_ARTIFACT", filename }),
    );
  },
);

it.each(["migration-up.sql", "migration-down.sql", "validation.sql", "rollout-plan.md"] as const)(
  "requires artifact %s to cite a valid draft evidence ID",
  (filename) => {
    const { context, draft, rendered } = packageFor("template");
    const content =
      filename === "rollout-plan.md"
        ? "# Rollout Plan\n\n## PR Review Summary\n\nNone.\n\n## Reviewer Gates\n\nNone.\n\ndatahub:invented\n"
        : "-- datahub:invented\n";

    expect(
      validatePackage(context, draft, replaceFile(rendered, filename, content)),
    ).toContainEqual(expect.objectContaining({ code: "EVIDENCE_CITATION_MISSING", filename }));
  },
);

it("rejects an executable classification for critical risk", () => {
  const { context, draft, rendered } = packageFor("staged");
  const invalid = {
    ...rendered,
    classification: "EXECUTABLE_WITH_REVIEW" as const,
  };

  expect(validatePackage(context, draft, invalid)).toContainEqual(
    expect.objectContaining({ code: "RISK_CLASSIFICATION_MISMATCH" }),
  );
});

it("rejects unresolved placeholder tokens in executable SQL", () => {
  const { context, draft, rendered } = packageFor("direct");
  const invalid = replaceFile(
    rendered,
    "migration-up.sql",
    `${rendered.files["migration-up.sql"]}-- <PLACEHOLDER>\n`,
  );

  expect(validatePackage(context, draft, invalid)).toContainEqual(
    expect.objectContaining({ code: "UNRESOLVED_PLACEHOLDER" }),
  );
});

it("does not mistake destination-safe Markdown code for a SQL placeholder", () => {
  const { context, draft, rendered } = packageFor("staged");
  const withCodeEvidence = replaceFile(
    rendered,
    "rollout-plan.md",
    `${rendered.files["rollout-plan.md"]}\nEvidence note: \` <script> \`.\n`,
  );

  expect(validatePackage(context, draft, withCodeEvidence)).not.toContainEqual(
    expect.objectContaining({ code: "UNRESOLVED_PLACEHOLDER" }),
  );
});

it("requires a reverse rename for a direct-rename rollback", () => {
  const { context, draft, rendered } = packageFor("direct");
  const invalid = replaceFile(
    rendered,
    "migration-down.sql",
    "-- Evidence: datahub:target-dataset\n-- Manual rollback only.\n",
  );

  expect(validatePackage(context, draft, invalid)).toContainEqual(
    expect.objectContaining({ code: "ROLLBACK_MISMATCH" }),
  );
});

describe("rollout review-section cardinality", () => {
  it.each(["## PR Review Summary", "## Reviewer Gates"])(
    "rejects a missing %s section",
    (heading) => {
      const { context, draft, rendered } = packageFor("staged");
      const invalid = replaceFile(
        rendered,
        "rollout-plan.md",
        rendered.files["rollout-plan.md"].replace(`${heading}\n`, ""),
      );

      expect(validatePackage(context, draft, invalid)).toContainEqual(
        expect.objectContaining({
          code: "ROLLOUT_SECTION_MISSING",
          filename: "rollout-plan.md",
        }),
      );
    },
  );

  it.each(["## PR Review Summary", "## Reviewer Gates"])(
    "rejects a duplicated %s section",
    (heading) => {
      const { context, draft, rendered } = packageFor("staged");
      const invalid = replaceFile(
        rendered,
        "rollout-plan.md",
        `${rendered.files["rollout-plan.md"]}\n${heading}\n`,
      );

      expect(validatePackage(context, draft, invalid)).toContainEqual(
        expect.objectContaining({
          code: "ROLLOUT_SECTION_DUPLICATE",
          filename: "rollout-plan.md",
        }),
      );
    },
  );
});
