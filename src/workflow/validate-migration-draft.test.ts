import { expect, it } from "vitest";
import { makeChangeContext, makeMigrationDraft } from "../../tests/helpers/factories.js";
import { MigrationPackageDraftSchema } from "./migration-draft.js";
import { validateMigrationDraft } from "./validate-migration-draft.js";

it("rejects a direct rename for the critical golden context", () => {
  const context = makeChangeContext();
  const findings = validateMigrationDraft(context, {
    ...makeMigrationDraft(context),
    strategy: "DIRECT_RENAME",
    executionClassification: "EXECUTABLE_WITH_REVIEW",
  });
  expect(findings.map(({ code }) => code)).toContain("DIRECT_RENAME_BLOCKED");
});

it("rejects unknown evidence IDs", () => {
  const context = makeChangeContext();
  const findings = validateMigrationDraft(context, {
    ...makeMigrationDraft(context),
    evidenceIds: ["datahub:invented-asset"],
  });
  expect(findings).toContainEqual(expect.objectContaining({ code: "UNKNOWN_EVIDENCE_REFERENCE" }));
});

it("requires a non-executable template when the platform is not Snowflake", () => {
  const context = makeChangeContext({ platform: "dbt" });
  const findings = validateMigrationDraft(context, makeMigrationDraft(context));
  expect(findings).toContainEqual(expect.objectContaining({ code: "UNSUPPORTED_PLATFORM" }));
});

it("prevents executable output when required DataHub evidence is incomplete", () => {
  const complete = makeChangeContext({ score: 10 });
  const context = {
    ...complete,
    analysisStatus: "INCOMPLETE_EVIDENCE" as const,
    evidenceCompleteness: {
      ...complete.evidenceCompleteness,
      complete: false,
      tableLineage: {
        ...complete.evidenceCompleteness.tableLineage,
        complete: false,
        reasonCodes: ["TOKEN_BUDGET_TRUNCATION" as const],
      },
    },
  };
  const findings = validateMigrationDraft(context, {
    ...makeMigrationDraft(complete),
    strategy: "DIRECT_RENAME",
    executionClassification: "EXECUTABLE_WITH_REVIEW",
  });
  expect(findings.map(({ code }) => code)).toContain("INCOMPLETE_EVIDENCE_CLASSIFICATION");
});

it("rejects a non-executable strategy paired with executable classification", () => {
  const context = makeChangeContext({ score: 10 });
  const invalid = {
    ...makeMigrationDraft(context),
    strategy: "NON_EXECUTABLE_TEMPLATE" as const,
    executionClassification: "EXECUTABLE_WITH_REVIEW" as const,
  };
  expect(() => MigrationPackageDraftSchema.parse(invalid)).toThrow(
    "Strategy and classification are inconsistent",
  );
  expect(validateMigrationDraft(context, invalid)).toContainEqual(
    expect.objectContaining({ code: "STRATEGY_CLASSIFICATION_MISMATCH" }),
  );
});
