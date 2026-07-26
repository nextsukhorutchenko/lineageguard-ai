import { expect, it } from "vitest";
import { makeChangeContext, makeMigrationDraft } from "../../tests/helpers/factories.js";
import { MigrationPackageDraftSchema } from "./migration-draft.js";
import { validateMigrationDraft } from "./validate-migration-draft.js";

it("accepts a grounded executable staged draft for a low-risk Snowflake context", () => {
  const context = makeChangeContext({ score: 10 });

  expect(validateMigrationDraft(context, makeMigrationDraft(context))).toEqual([]);
});

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
  const draft = MigrationPackageDraftSchema.parse({
    ...makeMigrationDraft(context),
    evidenceIds: [
      "datahub:target-dataset",
      "datahub:source-column:customer_id",
      "datahub:invented-asset",
    ],
  });
  const findings = validateMigrationDraft(context, draft);

  expect(findings).toEqual([
    expect.objectContaining({
      code: "UNKNOWN_EVIDENCE_REFERENCE",
      message: "Evidence reference datahub:invented-asset is not present in ChangeContext.",
    }),
  ]);
});

it("requires target and source-column evidence", () => {
  const context = makeChangeContext({ score: 10 });
  const findings = validateMigrationDraft(context, {
    ...makeMigrationDraft(context),
    evidenceIds: ["datahub:target-dataset", "datahub:downstream:001"],
  });

  expect(findings).toContainEqual(expect.objectContaining({ code: "MISSING_REQUIRED_EVIDENCE" }));
});

it("rejects executable classification when risk policy requires review", () => {
  const context = makeChangeContext();
  const findings = validateMigrationDraft(context, {
    ...makeMigrationDraft(context),
    executionClassification: "EXECUTABLE_WITH_REVIEW",
  });

  expect(findings).toContainEqual(
    expect.objectContaining({ code: "RISK_CLASSIFICATION_MISMATCH" }),
  );
});

it("requires a non-executable template when the platform is not Snowflake", () => {
  const context = makeChangeContext({ platform: "dbt" });
  const findings = validateMigrationDraft(context, makeMigrationDraft(context));
  expect(findings).toContainEqual(expect.objectContaining({ code: "UNSUPPORTED_PLATFORM" }));
});

it("requires a non-executable template when search evidence is incomplete", () => {
  const complete = makeChangeContext({ score: 10 });
  const context = {
    ...complete,
    analysisStatus: "INCOMPLETE_EVIDENCE" as const,
    evidenceCompleteness: {
      ...complete.evidenceCompleteness,
      complete: false,
      search: {
        ...complete.evidenceCompleteness.search,
        complete: false,
        reasonCodes: ["TOKEN_BUDGET_TRUNCATION" as const],
      },
    },
  };
  const template = {
    ...makeMigrationDraft(complete),
    strategy: "NON_EXECUTABLE_TEMPLATE" as const,
    executionClassification: "NON_EXECUTABLE_TEMPLATE" as const,
  };
  const advisory = {
    ...makeMigrationDraft(complete),
    executionClassification: "ADVISORY_ONLY" as const,
  };

  expect(validateMigrationDraft(context, template)).toEqual([]);
  expect(validateMigrationDraft(context, advisory)).toContainEqual(
    expect.objectContaining({ code: "INCOMPLETE_EVIDENCE_CLASSIFICATION" }),
  );
});

it("requires a non-executable template when schema evidence is incomplete", () => {
  const complete = makeChangeContext({ score: 10 });
  const context = {
    ...complete,
    analysisStatus: "INCOMPLETE_EVIDENCE" as const,
    evidenceCompleteness: {
      ...complete.evidenceCompleteness,
      complete: false,
      schema: {
        ...complete.evidenceCompleteness.schema,
        complete: false,
        reasonCodes: ["TOKEN_BUDGET_TRUNCATION" as const],
      },
    },
  };
  const template = {
    ...makeMigrationDraft(complete),
    strategy: "NON_EXECUTABLE_TEMPLATE" as const,
    executionClassification: "NON_EXECUTABLE_TEMPLATE" as const,
  };
  const executable = makeMigrationDraft(complete);

  expect(validateMigrationDraft(context, template)).toEqual([]);
  expect(validateMigrationDraft(context, executable)).toContainEqual(
    expect.objectContaining({ code: "INCOMPLETE_EVIDENCE_CLASSIFICATION" }),
  );
});

it("allows advisory output but rejects executable output when only lineage is incomplete", () => {
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
  const advisory = {
    ...makeMigrationDraft(complete),
    executionClassification: "ADVISORY_ONLY" as const,
  };
  const executable = makeMigrationDraft(complete);

  expect(validateMigrationDraft(context, advisory)).toEqual([]);
  expect(validateMigrationDraft(context, executable)).toContainEqual(
    expect.objectContaining({ code: "INCOMPLETE_EVIDENCE_CLASSIFICATION" }),
  );
});

it("does not downgrade policy for optional entity-context gaps", () => {
  const context = makeChangeContext({ score: 10 });

  expect(context.entityContextRetrieval.complete).toBe(false);
  expect(validateMigrationDraft(context, makeMigrationDraft(context))).toEqual([]);
});

it("requires the approved staged sequence", () => {
  const context = makeChangeContext({ score: 10 });
  const findings = validateMigrationDraft(context, {
    ...makeMigrationDraft(context),
    stages: ["PREPARE", "BACKFILL"],
  });

  expect(findings).toContainEqual(expect.objectContaining({ code: "STAGED_SEQUENCE_REQUIRED" }));
});

it("requires staged rollback to preserve the source column", () => {
  const context = makeChangeContext({ score: 10 });
  const findings = validateMigrationDraft(context, {
    ...makeMigrationDraft(context),
    rollback: "MANUAL_ROLLBACK_REQUIRED",
  });

  expect(findings).toContainEqual(expect.objectContaining({ code: "ROLLBACK_POLICY_MISMATCH" }));
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
