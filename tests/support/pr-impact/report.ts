import {
  ImpactReportSchema,
  MAX_REPORT_MARKDOWN_BYTES,
  type ImpactContext,
  type ImpactReport,
} from "./contracts.js";
import { SCENARIO_TAGS, type ScenarioTag } from "./scenario-tags.js";

export interface ObservedTestResult {
  readonly id: string;
  readonly tags: readonly string[];
  readonly expectedStatus: string;
  readonly attempts: readonly {
    readonly retry: number;
    readonly status: string;
  }[];
}

const compareCodePoints = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const allowedTags = (values: readonly string[]): ScenarioTag[] => {
  const allowed = new Set<string>(SCENARIO_TAGS);
  return [...new Set(values.filter((value): value is ScenarioTag => allowed.has(value)))].sort(
    compareCodePoints,
  );
};

export function buildImpactReport(
  context: ImpactContext,
  playwrightStatus: "passed" | "failed" | "timedout" | "interrupted",
  tests: readonly ObservedTestResult[],
): ImpactReport {
  const discovered = new Set<ScenarioTag>();
  const completed = new Set<ScenarioTag>();
  const failed = new Set<ScenarioTag>();
  let passedTests = 0;
  let failedTests = 0;
  let timedOutTests = 0;
  let interruptedTests = 0;
  let skippedTests = 0;
  let retriedTests = 0;

  for (const test of [...tests].sort((left, right) => compareCodePoints(left.id, right.id))) {
    const tags = allowedTags(test.tags);
    tags.forEach((tag) => discovered.add(tag));
    if (test.attempts.length === 0) continue;
    if (test.attempts.length > 1) retriedTests += 1;
    tags.forEach((tag) => completed.add(tag));
    const terminal = test.attempts.at(-1)!.status;
    if (terminal === test.expectedStatus) {
      passedTests += 1;
      continue;
    }
    if (terminal === "failed") {
      failedTests += 1;
      tags.forEach((tag) => failed.add(tag));
    } else if (terminal === "timedOut") {
      timedOutTests += 1;
      tags.forEach((tag) => failed.add(tag));
    } else if (terminal === "interrupted") {
      interruptedTests += 1;
      tags.forEach((tag) => failed.add(tag));
    } else if (terminal === "skipped") {
      skippedTests += 1;
    } else {
      interruptedTests += 1;
      tags.forEach((tag) => failed.add(tag));
    }
  }

  const discoveredTags = [...discovered].sort(compareCodePoints);
  return ImpactReportSchema.parse({
    ...context,
    discoveredTags,
    completedTags: [...completed].sort(compareCodePoints),
    failedTags: [...failed].sort(compareCodePoints),
    missingTags: context.expectedTags.filter((tag) => !discovered.has(tag)).sort(compareCodePoints),
    passedTests,
    failedTests,
    timedOutTests,
    interruptedTests,
    skippedTests,
    retriedTests,
    playwrightStatus,
  });
}

const escapeMarkdown = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/([\\*_`[\]|])/gu, "\\$1");

const list = (values: readonly string[]): string =>
  values.length === 0 ? "none" : values.map(escapeMarkdown).join(", ");

export function renderImpactMarkdown(report: ImpactReport): string {
  const validated = ImpactReportSchema.parse(report);
  const markdown = [
    "# Advisory PR impact",
    "",
    `- Disposition: ${escapeMarkdown(validated.disposition)}`,
    `- Playwright status: ${escapeMarkdown(validated.playwrightStatus)}`,
    `- Impacted areas: ${list(validated.impactedAreas)}`,
    `- Reason codes: ${list(validated.reasonCodes)}`,
    "",
    "## Stable tag reconciliation",
    "",
    `- Expected: ${list(validated.expectedTags)}`,
    `- Discovered: ${list(validated.discoveredTags)}`,
    `- Completed: ${list(validated.completedTags)}`,
    `- Failed: ${list(validated.failedTags)}`,
    `- Missing: ${list(validated.missingTags)}`,
    "",
    "## Aggregate results",
    "",
    `- Passed: ${validated.passedTests}`,
    `- Failed: ${validated.failedTests}`,
    `- Timed out: ${validated.timedOutTests}`,
    `- Interrupted: ${validated.interruptedTests}`,
    `- Skipped: ${validated.skippedTests}`,
    `- Retried: ${validated.retriedTests}`,
    "",
    "The complete Chromium suite runs regardless of this advisory classification.",
    "",
  ].join("\n");
  if (Buffer.byteLength(markdown, "utf8") > MAX_REPORT_MARKDOWN_BYTES) {
    throw new Error("PR impact report is unavailable.");
  }
  return markdown;
}
