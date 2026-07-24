import { z } from "zod";

export const MigrationStrategySchema = z.enum([
  "DIRECT_RENAME",
  "STAGED_COMPATIBILITY",
  "NON_EXECUTABLE_TEMPLATE",
]);
export const ExecutionClassificationSchema = z.enum([
  "EXECUTABLE_WITH_REVIEW",
  "ADVISORY_ONLY",
  "NON_EXECUTABLE_TEMPLATE",
]);

export const MigrationPackageDraftSchema = z
  .object({
    schemaVersion: z.literal("1"),
    strategy: MigrationStrategySchema,
    executionClassification: ExecutionClassificationSchema,
    rationale: z.enum([
      "LOW_RISK_CONFIRMED_RENAME",
      "DOWNSTREAM_COORDINATION_REQUIRED",
      "CRITICAL_DOWNSTREAM_IMPACT",
      "PLATFORM_OR_OBJECT_NAME_UNCONFIRMED",
      "METADATA_LIMITED",
    ]),
    evidenceIds: z
      .array(z.string().startsWith("datahub:").max(600))
      .min(2)
      .max(102)
      .refine((ids) => new Set(ids).size === ids.length, "Evidence IDs must be unique."),
    stages: z
      .array(
        z.enum([
          "PREPARE",
          "ADD_COMPATIBLE_COLUMN",
          "BACKFILL",
          "MIGRATE_DOWNSTREAM",
          "VALIDATE",
          "RETIRE_SOURCE_COLUMN",
          "DIRECT_RENAME",
        ]),
      )
      .min(1)
      .max(7),
    validationChecks: z
      .array(
        z.enum([
          "SOURCE_COLUMN_EXISTS",
          "TARGET_COLUMN_ABSENT_BEFORE_CHANGE",
          "TARGET_COLUMN_EXISTS",
          "ROW_COUNT_STABLE",
          "NULL_COUNT_COMPARE",
          "BACKFILL_COMPLETE",
          "SAMPLED_VALUE_COMPARE",
        ]),
      )
      .min(2)
      .max(7),
    rollback: z.enum([
      "RENAME_TARGET_BACK_TO_SOURCE",
      "KEEP_SOURCE_AND_REMOVE_TARGET_AFTER_REVIEW",
      "MANUAL_ROLLBACK_REQUIRED",
    ]),
    warnings: z
      .array(
        z.enum([
          "DIRECT_RENAME_BLOCKED",
          "HUMAN_APPROVAL_REQUIRED",
          "DOWNSTREAM_COORDINATION_REQUIRED",
          "COLUMN_LINEAGE_INCOMPLETE",
          "PHYSICAL_OBJECT_NAME_UNCONFIRMED",
          "ROLLBACK_REQUIRES_DATA_REVIEW",
        ]),
      )
      .max(6),
  })
  .strict()
  .superRefine((draft, ctx) => {
    const invalid =
      (draft.strategy === "NON_EXECUTABLE_TEMPLATE") !==
        (draft.executionClassification === "NON_EXECUTABLE_TEMPLATE") ||
      (draft.strategy === "DIRECT_RENAME" &&
        draft.executionClassification !== "EXECUTABLE_WITH_REVIEW") ||
      (draft.executionClassification === "ADVISORY_ONLY" &&
        draft.strategy !== "STAGED_COMPATIBILITY");
    if (invalid) {
      ctx.addIssue({ code: "custom", message: "Strategy and classification are inconsistent." });
    }
  });

export type MigrationPackageDraft = z.infer<typeof MigrationPackageDraftSchema>;
export type ExecutionClassification = z.infer<typeof ExecutionClassificationSchema>;
