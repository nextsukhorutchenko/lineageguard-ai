import { z } from "zod";
import { SCENARIO_TAGS } from "./scenario-tags.js";

export const MAX_CHANGED_PATHS = 2_000;
export const MAX_CHANGED_PATH_BYTES = 512;
export const MAX_CHANGED_PATHS_BYTES = 256 * 1_024;
export const MAX_REPORT_JSON_BYTES = 256 * 1_024;
export const MAX_REPORT_MARKDOWN_BYTES = 32 * 1_024;

export const ImpactDispositionSchema = z.enum(["MAPPED", "FULL_SUITE_REQUIRED"]);
export const ImpactSourceSchema = z.enum(["PULL_REQUEST", "IMPACT_CONTEXT_UNAVAILABLE"]);
export const ImpactReasonCodeSchema = z.enum([
  "CRITICAL_TOOLING_CHANGE",
  "EMPTY_CHANGE_SET",
  "GIT_COMPARISON_UNAVAILABLE",
  "IMPACT_INPUT_INVALID",
  "IMPACT_INPUT_LIMIT_REACHED",
  "NON_PULL_REQUEST",
  "UNMAPPED_PATH",
]);
export const PlaywrightStatusSchema = z.enum(["passed", "failed", "timedout", "interrupted"]);
export const ScenarioTagSchema = z.enum(SCENARIO_TAGS);

const sortedUnique = (values: readonly string[]): boolean =>
  values.every((value, index) => index === 0 || values[index - 1]! < value);

const BoundedPathSchema = z
  .string()
  .min(1)
  .refine((value) => Buffer.byteLength(value, "utf8") <= MAX_CHANGED_PATH_BYTES);

const SortedStringArraySchema = z.array(z.string().min(1)).refine(sortedUnique);
const SortedTagArraySchema = z.array(ScenarioTagSchema).refine(sortedUnique);
const SortedReasonArraySchema = z.array(ImpactReasonCodeSchema).refine(sortedUnique);

export const ImpactContextSchema = z
  .object({
    schemaVersion: z.literal("1"),
    source: ImpactSourceSchema,
    disposition: ImpactDispositionSchema,
    changedPaths: z
      .array(BoundedPathSchema)
      .max(MAX_CHANGED_PATHS)
      .refine(sortedUnique)
      .refine(
        (paths) =>
          paths.reduce((total, path) => total + Buffer.byteLength(path, "utf8"), 0) <=
          MAX_CHANGED_PATHS_BYTES,
      ),
    impactedAreas: SortedStringArraySchema,
    expectedTags: SortedTagArraySchema,
    reasonCodes: SortedReasonArraySchema,
  })
  .strict();

export const ImpactReportSchema = ImpactContextSchema.extend({
  discoveredTags: SortedTagArraySchema,
  completedTags: SortedTagArraySchema,
  failedTags: SortedTagArraySchema,
  missingTags: SortedTagArraySchema,
  passedTests: z.number().int().nonnegative(),
  failedTests: z.number().int().nonnegative(),
  timedOutTests: z.number().int().nonnegative(),
  interruptedTests: z.number().int().nonnegative(),
  skippedTests: z.number().int().nonnegative(),
  retriedTests: z.number().int().nonnegative(),
  playwrightStatus: PlaywrightStatusSchema,
}).strict();

export type ImpactContext = z.infer<typeof ImpactContextSchema>;
export type ImpactReport = z.infer<typeof ImpactReportSchema>;
