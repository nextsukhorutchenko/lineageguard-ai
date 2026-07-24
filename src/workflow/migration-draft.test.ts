import { describe, expect, it } from "vitest";
import { MigrationPackageDraftSchema } from "./migration-draft.js";

describe("MigrationPackageDraftSchema", () => {
  it("accepts the bounded staged strategy", () => {
    expect(
      MigrationPackageDraftSchema.parse({
        schemaVersion: "1",
        strategy: "STAGED_COMPATIBILITY",
        executionClassification: "ADVISORY_ONLY",
        rationale: "CRITICAL_DOWNSTREAM_IMPACT",
        evidenceIds: ["datahub:target-dataset", "datahub:source-column:customer_id"],
        stages: [
          "PREPARE",
          "ADD_COMPATIBLE_COLUMN",
          "BACKFILL",
          "MIGRATE_DOWNSTREAM",
          "VALIDATE",
          "RETIRE_SOURCE_COLUMN",
        ],
        validationChecks: ["SOURCE_COLUMN_EXISTS", "TARGET_COLUMN_EXISTS", "BACKFILL_COMPLETE"],
        rollback: "KEEP_SOURCE_AND_REMOVE_TARGET_AFTER_REVIEW",
        warnings: ["DIRECT_RENAME_BLOCKED", "HUMAN_APPROVAL_REQUIRED"],
      }).strategy,
    ).toBe("STAGED_COMPATIBILITY");
  });

  it("rejects free-form strategy and warning values", () => {
    expect(() =>
      MigrationPackageDraftSchema.parse({
        schemaVersion: "1",
        strategy: "DROP_AND_RECREATE",
        executionClassification: "EXECUTABLE_WITH_REVIEW",
        rationale: "MODEL_DECIDED",
        evidenceIds: [],
        stages: [],
        validationChecks: [],
        rollback: "NONE",
        warnings: [],
      }),
    ).toThrow();
  });

  it("accepts all target, source-column, and 100 downstream evidence IDs", () => {
    const evidenceIds = [
      "datahub:target-dataset",
      "datahub:source-column:customer_id",
      ...Array.from(
        { length: 100 },
        (_, index) => `datahub:downstream:${String(index + 1).padStart(3, "0")}`,
      ),
    ];
    const draft = {
      schemaVersion: "1" as const,
      strategy: "STAGED_COMPATIBILITY" as const,
      executionClassification: "ADVISORY_ONLY" as const,
      rationale: "CRITICAL_DOWNSTREAM_IMPACT" as const,
      evidenceIds,
      stages: [
        "PREPARE",
        "ADD_COMPATIBLE_COLUMN",
        "BACKFILL",
        "MIGRATE_DOWNSTREAM",
        "VALIDATE",
        "RETIRE_SOURCE_COLUMN",
      ],
      validationChecks: ["SOURCE_COLUMN_EXISTS", "TARGET_COLUMN_EXISTS"],
      rollback: "KEEP_SOURCE_AND_REMOVE_TARGET_AFTER_REVIEW" as const,
      warnings: [],
    };

    expect(MigrationPackageDraftSchema.parse(draft).evidenceIds).toHaveLength(102);
    expect(() =>
      MigrationPackageDraftSchema.parse({
        ...draft,
        evidenceIds: [...evidenceIds, evidenceIds[0]],
      }),
    ).toThrow("Evidence IDs must be unique");
    expect(() =>
      MigrationPackageDraftSchema.parse({
        ...draft,
        evidenceIds: [...evidenceIds, "datahub:downstream:103"],
      }),
    ).toThrow();
  });
});
