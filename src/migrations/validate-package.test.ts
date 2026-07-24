import { describe, expect, it } from "vitest";
import {
  makeChangeContext,
  makeImpactReportDraft,
  makeMigrationDraft,
} from "../../tests/helpers/factories.js";
import { buildChangeContext, type ChangeContext } from "../workflow/change-context.js";
import type { MigrationPackageDraft } from "../workflow/migration-draft.js";
import {
  renderMigrationPackage,
  type MigrationArtifactFilename,
  type RenderedMigrationPackage,
} from "./render-snowflake-package.js";
import { validatePackage } from "./validate-package.js";
import { executableSqlStatements } from "./validate-sql.js";

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

function templateDraft(context: ChangeContext): MigrationPackageDraft {
  return {
    ...makeMigrationDraft(context),
    strategy: "NON_EXECUTABLE_TEMPLATE",
    executionClassification: "NON_EXECUTABLE_TEMPLATE",
    rationale: "PLATFORM_OR_OBJECT_NAME_UNCONFIRMED",
    stages: ["PREPARE"],
    rollback: "MANUAL_ROLLBACK_REQUIRED",
    warnings: ["PHYSICAL_OBJECT_NAME_UNCONFIRMED", "HUMAN_APPROVAL_REQUIRED"],
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

function sqlFileWithStatements(
  rendered: RenderedMigrationPackage,
  filename: Exclude<MigrationArtifactFilename, "rollout-plan.md">,
  statements: readonly string[],
): string {
  const evidenceLine = rendered.files[filename]
    .split("\n")
    .find((line) => line.startsWith("-- Evidence:"));
  if (evidenceLine === undefined) throw new Error("Expected rendered evidence.");
  return `${evidenceLine}\n${statements.map((statement) => `${statement};`).join("\n")}\n`;
}

function punctuationIdentifierContext(): ChangeContext {
  const report = makeImpactReportDraft({
    datasetName: "ORDER_ENTRY_DB.ANALYTICS.ORDER_DETAILS",
    score: 20,
  });
  const source = "customer;--id";
  const target = "customer--key;next";
  const sourceField = { fieldPath: source, nativeDataType: "NUMBER(38,0)" };
  return buildChangeContext(
    {
      ...report,
      intent: {
        ...report.intent,
        sourceColumn: source,
        targetColumn: target,
      },
      evidence: {
        ...report.evidence,
        schemaFields: [sourceField, report.evidence.schemaFields[1]!],
        sourceColumn: sourceField,
      },
    },
    [],
  );
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
  const draft =
    mode === "direct"
      ? directDraft(context)
      : mode === "template"
        ? templateDraft(context)
        : makeMigrationDraft(context);
  return { context, draft, rendered: renderMigrationPackage(context, draft) };
}

it("accepts the golden non-executable four-file template", () => {
  const { context, draft, rendered } = packageFor("template");

  expect(validatePackage(context, draft, rendered)).toEqual([]);
});

it.each(["direct", "staged"] as const)("accepts a complete rendered %s package", (mode) => {
  const { context, draft, rendered } = packageFor(mode);

  expect(validatePackage(context, draft, rendered)).toEqual([]);
});

it("accepts rendered identifiers containing quoted semicolons and comment markers", () => {
  const context = punctuationIdentifierContext();
  const draft = makeMigrationDraft(context);
  const rendered = renderMigrationPackage(context, draft);

  expect(validatePackage(context, draft, rendered)).toEqual([]);
});

it("rejects mutually inverse direct renames for another table and columns", () => {
  const { context, draft, rendered } = packageFor("direct");
  const foreignTable = '"OTHER_DB"."OTHER_SCHEMA"."OTHER_TABLE"';
  const forward = `ALTER TABLE ${foreignTable} RENAME COLUMN "FOREIGN_SOURCE" TO "FOREIGN_TARGET"`;
  const rollback = `ALTER TABLE ${foreignTable} RENAME COLUMN "FOREIGN_TARGET" TO "FOREIGN_SOURCE"`;
  const invalidUp = replaceFile(
    rendered,
    "migration-up.sql",
    sqlFileWithStatements(rendered, "migration-up.sql", [forward]),
  );
  const invalid = replaceFile(
    invalidUp,
    "migration-down.sql",
    sqlFileWithStatements(rendered, "migration-down.sql", [rollback]),
  );

  expect(validatePackage(context, draft, invalid)).toContainEqual(
    expect.objectContaining({
      code: "SQL_ARTIFACT_MISMATCH",
      filename: "migration-up.sql",
    }),
  );
});

it("rejects supported staged statements in the wrong artifacts", () => {
  const { context, draft, rendered } = packageFor("staged");
  const invalidUp = replaceFile(rendered, "migration-up.sql", rendered.files["validation.sql"]);
  const invalid = replaceFile(invalidUp, "validation.sql", rendered.files["migration-up.sql"]);

  expect(validatePackage(context, draft, invalid)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "SQL_ARTIFACT_MISMATCH",
        filename: "migration-up.sql",
      }),
      expect.objectContaining({
        code: "SQL_ARTIFACT_MISMATCH",
        filename: "validation.sql",
      }),
    ]),
  );
});

it("rejects supported staged statements in the wrong order", () => {
  const { context, draft, rendered } = packageFor("staged");
  const reversed = [...executableSqlStatements(rendered.files["migration-up.sql"])].reverse();
  const invalid = replaceFile(
    rendered,
    "migration-up.sql",
    sqlFileWithStatements(rendered, "migration-up.sql", reversed),
  );

  expect(validatePackage(context, draft, invalid)).toContainEqual(
    expect.objectContaining({
      code: "SQL_ARTIFACT_MISMATCH",
      filename: "migration-up.sql",
    }),
  );
});

it("rejects a staged target and native type not grounded in ChangeContext", () => {
  const { context, draft, rendered } = packageFor("staged");
  const table = '"ORDER_ENTRY_DB"."ANALYTICS"."ORDER_DETAILS"';
  const invalid = replaceFile(
    rendered,
    "migration-up.sql",
    sqlFileWithStatements(rendered, "migration-up.sql", [
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS "OTHER_TARGET" VARCHAR(42)`,
      `UPDATE ${table} SET "OTHER_TARGET" = "customer_id" WHERE "OTHER_TARGET" IS NULL`,
    ]),
  );

  expect(validatePackage(context, draft, invalid)).toContainEqual(
    expect.objectContaining({
      code: "SQL_ARTIFACT_MISMATCH",
      filename: "migration-up.sql",
    }),
  );
});

it("rejects an additional valid statement outside the rendered plan", () => {
  const { context, draft, rendered } = packageFor("staged");
  const statements = executableSqlStatements(rendered.files["migration-up.sql"]);
  const invalid = replaceFile(
    rendered,
    "migration-up.sql",
    sqlFileWithStatements(rendered, "migration-up.sql", [
      ...statements,
      'SHOW COLUMNS IN TABLE "ORDER_ENTRY_DB"."ANALYTICS"."ORDER_DETAILS"',
    ]),
  );

  expect(validatePackage(context, draft, invalid)).toContainEqual(
    expect.objectContaining({
      code: "SQL_ARTIFACT_MISMATCH",
      filename: "migration-up.sql",
    }),
  );
});

it("rejects a supported rename used as direct validation SQL", () => {
  const { context, draft, rendered } = packageFor("direct");
  const invalid = replaceFile(
    rendered,
    "validation.sql",
    sqlFileWithStatements(rendered, "validation.sql", [
      'ALTER TABLE "ORDER_ENTRY_DB"."ANALYTICS"."ORDER_DETAILS" RENAME COLUMN "customer_id" TO "customer_key"',
    ]),
  );

  expect(validatePackage(context, draft, invalid)).toContainEqual(
    expect.objectContaining({
      code: "SQL_ARTIFACT_MISMATCH",
      filename: "validation.sql",
    }),
  );
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

it("accepts exact context citations when the validated draft references a subset", () => {
  const { context, draft, rendered } = packageFor("staged");
  const subsetDraft = {
    ...draft,
    evidenceIds: draft.evidenceIds.slice(0, 2),
  };

  expect(
    validatePackage(context, subsetDraft, rendered).filter(
      ({ code }) => code === "EVIDENCE_CITATION_MISSING",
    ),
  ).toEqual([]);
});

it.each([
  {
    filename: "migration-up.sql",
    content: "-- Evidence: datahub:target-dataset-suffix\n",
  },
  {
    filename: "migration-down.sql",
    content: "-- Evidence: prefixdatahub:target-dataset\n",
  },
  {
    filename: "rollout-plan.md",
    content:
      "# Rollout Plan\n\n**Evidence:** ` datahub:target-dataset-suffix `\n\n## PR Review Summary\n\nNone.\n\n## Reviewer Gates\n\nNone.\n",
  },
] as const)("rejects non-exact evidence token in $filename", ({ filename, content }) => {
  const { context, draft, rendered } = packageFor("template");

  expect(validatePackage(context, draft, replaceFile(rendered, filename, content))).toContainEqual(
    expect.objectContaining({ code: "EVIDENCE_CITATION_MISSING", filename }),
  );
});

it("rejects an unknown runtime artifact key", () => {
  const { context, draft, rendered } = packageFor("template");
  const invalid = {
    ...rendered,
    files: {
      ...rendered.files,
      "unexpected.sql": "-- Evidence: datahub:target-dataset\n",
    },
  } as unknown as RenderedMigrationPackage;

  expect(validatePackage(context, draft, invalid)).toContainEqual(
    expect.objectContaining({ code: "UNKNOWN_ARTIFACT" }),
  );
});

it("fails closed when the runtime artifact collection is not an object", () => {
  const { context, draft, rendered } = packageFor("template");
  const invalid = {
    ...rendered,
    files: null,
  } as unknown as RenderedMigrationPackage;

  expect(() => validatePackage(context, draft, invalid)).not.toThrow();
  expect(validatePackage(context, draft, invalid)).toContainEqual(
    expect.objectContaining({ code: "MISSING_ARTIFACT" }),
  );
});

it("rejects a missing runtime artifact key", () => {
  const { context, draft, rendered } = packageFor("template");
  const files: Partial<Record<MigrationArtifactFilename, string>> = {
    ...rendered.files,
  };
  delete files["validation.sql"];
  const invalid = { ...rendered, files } as unknown as RenderedMigrationPackage;

  expect(validatePackage(context, draft, invalid)).toContainEqual(
    expect.objectContaining({ code: "MISSING_ARTIFACT", filename: "validation.sql" }),
  );
});

it("requires the rendered and validated draft classifications to match", () => {
  const { context, draft, rendered } = packageFor("direct");
  const invalid = { ...rendered, classification: "ADVISORY_ONLY" as const };

  expect(validatePackage(context, draft, invalid)).toContainEqual(
    expect.objectContaining({ code: "CLASSIFICATION_MISMATCH" }),
  );
});

it("never upgrades manual-approval risk to executable", () => {
  const context = makeChangeContext({
    datasetName: "ORDER_ENTRY_DB.ANALYTICS.ORDER_DETAILS",
    score: 50,
  });
  const draft = makeMigrationDraft(context);
  const rendered = {
    ...renderMigrationPackage(context, draft),
    classification: "EXECUTABLE_WITH_REVIEW" as const,
  };

  expect(validatePackage(context, draft, rendered)).toContainEqual(
    expect.objectContaining({
      code: "RISK_CLASSIFICATION_MISMATCH",
      message: "Risk policy does not permit executable output.",
    }),
  );
});

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
    "-- Evidence: datahub:target-dataset\n-- RENAME COLUMN is a manual rollback note only.\n",
  );

  expect(validatePackage(context, draft, invalid)).toContainEqual(
    expect.objectContaining({ code: "ROLLBACK_MISMATCH" }),
  );
});

it("requires the direct rollback rename to be the exact inverse", () => {
  const { context, draft, rendered } = packageFor("direct");
  const invalid = replaceFile(
    rendered,
    "migration-down.sql",
    '-- Evidence: datahub:target-dataset\nALTER TABLE "ORDER_ENTRY_DB"."ANALYTICS"."ORDER_DETAILS" RENAME COLUMN "customer_key" TO "different_source";\n',
  );

  expect(validatePackage(context, draft, invalid)).toContainEqual(
    expect.objectContaining({ code: "ROLLBACK_MISMATCH" }),
  );
});

it.each(["migration-up.sql", "validation.sql"] as const)(
  "requires executable statements in direct artifact %s",
  (filename) => {
    const { context, draft, rendered } = packageFor("direct");
    const invalid = replaceFile(
      rendered,
      filename,
      "-- Evidence: datahub:target-dataset\n-- Review only.\n",
    );

    expect(validatePackage(context, draft, invalid)).toContainEqual(
      expect.objectContaining({ code: "MISSING_EXECUTABLE_SQL", filename }),
    );
  },
);

it("requires an executable statement in a direct rollback artifact", () => {
  const { context, draft, rendered } = packageFor("direct");
  const invalid = replaceFile(
    rendered,
    "migration-down.sql",
    "-- Evidence: datahub:target-dataset\n-- RENAME COLUMN is not executable.\n",
  );

  expect(validatePackage(context, draft, invalid)).toContainEqual(
    expect.objectContaining({
      code: "MISSING_EXECUTABLE_SQL",
      filename: "migration-down.sql",
    }),
  );
});

it("allows a staged rollback to remain an explicit advisory comment", () => {
  const { context, draft, rendered } = packageFor("staged");

  expect(validatePackage(context, draft, rendered)).not.toContainEqual(
    expect.objectContaining({
      code: "MISSING_EXECUTABLE_SQL",
      filename: "migration-down.sql",
    }),
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
