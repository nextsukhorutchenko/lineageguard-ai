import { describe, expect, it } from "vitest";
import type { ImpactContext } from "./contracts.js";
import { buildImpactReport, renderImpactMarkdown } from "./report.js";

const context: ImpactContext = {
  schemaVersion: "1",
  source: "PULL_REQUEST",
  disposition: "MAPPED",
  changedPaths: ["app/page.tsx"],
  impactedAreas: ["browser-ui"],
  expectedTags: ["@golden-flow", "@shell", "@workflow-terminal"],
  reasonCodes: [],
};

describe("PR impact report", () => {
  it("aggregates terminal outcomes, retries, and stable tags", () => {
    const report = buildImpactReport(context, "failed", [
      {
        id: "skipped",
        tags: ["@workflow-terminal"],
        expectedStatus: "passed",
        attempts: [{ retry: 0, status: "skipped" }],
      },
      {
        id: "expected-failure",
        tags: ["@golden-flow"],
        expectedStatus: "failed",
        attempts: [{ retry: 0, status: "failed" }],
      },
      {
        id: "retried",
        tags: ["@shell", "@not-allowed"],
        expectedStatus: "passed",
        attempts: [
          { retry: 0, status: "failed" },
          { retry: 1, status: "passed" },
        ],
      },
      {
        id: "timed",
        tags: ["@workflow-terminal"],
        expectedStatus: "passed",
        attempts: [{ retry: 0, status: "timedOut" }],
      },
      {
        id: "interrupted",
        tags: ["@shell"],
        expectedStatus: "passed",
        attempts: [{ retry: 0, status: "interrupted" }],
      },
    ]);

    expect(report).toMatchObject({
      discoveredTags: ["@golden-flow", "@shell", "@workflow-terminal"],
      completedTags: ["@golden-flow", "@shell", "@workflow-terminal"],
      failedTags: ["@shell", "@workflow-terminal"],
      missingTags: [],
      passedTests: 2,
      failedTests: 0,
      timedOutTests: 1,
      interruptedTests: 1,
      skippedTests: 1,
      retriedTests: 1,
      playwrightStatus: "failed",
    });
  });

  it("is byte-identical for permuted test and tag order", () => {
    const tests = [
      {
        id: "b",
        tags: ["@shell", "@golden-flow"],
        expectedStatus: "passed",
        attempts: [{ retry: 0, status: "passed" }],
      },
      {
        id: "a",
        tags: ["@workflow-terminal"],
        expectedStatus: "passed",
        attempts: [{ retry: 0, status: "failed" }],
      },
    ] as const;
    const first = renderImpactMarkdown(buildImpactReport(context, "failed", tests));
    const second = renderImpactMarkdown(
      buildImpactReport(
        context,
        "failed",
        [...tests].reverse().map((test) => ({ ...test, tags: [...test.tags].reverse() })),
      ),
    );

    expect(second).toBe(first);
  });

  it("reports missing expected tags when no matching test was discovered", () => {
    const report = buildImpactReport(context, "passed", []);
    expect(report.missingTags).toEqual(["@golden-flow", "@shell", "@workflow-terminal"]);
  });

  it("escapes Markdown control syntax and stays bounded", () => {
    const report = {
      ...buildImpactReport(context, "passed", []),
      impactedAreas: ["area*_[x]`<y>|"],
    };
    const markdown = renderImpactMarkdown(report);

    expect(markdown).toContain("area\\*\\_\\[x\\]\\`&lt;y&gt;\\|");
    expect(Buffer.byteLength(markdown, "utf8")).toBeLessThanOrEqual(32 * 1_024);
  });
});
