import { describe, expect, it, vi } from "vitest";
import { makeChangeContext } from "../../tests/helpers/factories.js";
import type { ChangeContext } from "../workflow/change-context.js";
import { FakeAgentProvider, createGoldenDraft } from "./fake-agent-provider.js";

function withIncompleteEvidence(
  context: ChangeContext,
  dimension: "search" | "schema" | "tableLineage" | "columnLineage",
): ChangeContext {
  return {
    ...context,
    evidenceCompleteness: {
      ...context.evidenceCompleteness,
      complete: false,
      [dimension]: {
        ...context.evidenceCompleteness[dimension],
        complete: false,
        reasonCodes: ["ITEM_LIMIT_REACHED"],
      },
    },
  };
}

describe("FakeAgentProvider", () => {
  it("calls exactly analysis then generation and identifies itself as replay", async () => {
    const context = makeChangeContext();
    const analyzeRenameChange = vi.fn().mockResolvedValue({ kind: "ready", context });
    const generateMigrationPackage = vi.fn().mockResolvedValue({
      kind: "accepted",
      classification: "ADVISORY_ONLY",
    });

    const result = await new FakeAgentProvider().run({
      request: context.request,
      tools: { analyzeRenameChange, generateMigrationPackage },
      signal: new AbortController().signal,
    });

    expect(analyzeRenameChange).toHaveBeenCalledOnce();
    expect(generateMigrationPackage).toHaveBeenCalledOnce();
    expect(analyzeRenameChange).toHaveBeenCalledWith(
      { request: context.request },
      expect.any(AbortSignal),
    );
    expect(analyzeRenameChange.mock.invocationCallOrder[0]).toBeLessThan(
      generateMigrationPackage.mock.invocationCallOrder[0]!,
    );
    expect(result).toMatchObject({
      status: "completed",
      provider: "fixture",
      model: "replay-v1",
      analysisCalls: 1,
      generationAttempts: 1,
    });
  });

  it("returns clarification without calling generation", async () => {
    const generateMigrationPackage = vi.fn();
    const result = await new FakeAgentProvider().run({
      request: "Rename column a to b in dataset ambiguous",
      tools: {
        analyzeRenameChange: vi.fn().mockResolvedValue({
          kind: "clarification",
          candidates: ["urn:li:dataset:(one)", "urn:li:dataset:(two)"],
        }),
        generateMigrationPackage,
      },
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      status: "needs_clarification",
      analysisCalls: 1,
      generationAttempts: 0,
      candidates: ["urn:li:dataset:(one)", "urn:li:dataset:(two)"],
    });
    expect(generateMigrationPackage).not.toHaveBeenCalled();
  });

  it.each(["search", "schema"] as const)(
    "uses a non-executable template when %s evidence is incomplete",
    (dimension) => {
      const draft = createGoldenDraft(withIncompleteEvidence(makeChangeContext(), dimension));

      expect(draft).toMatchObject({
        strategy: "NON_EXECUTABLE_TEMPLATE",
        executionClassification: "NON_EXECUTABLE_TEMPLATE",
        rationale: "METADATA_LIMITED",
      });
    },
  );

  it.each(["tableLineage", "columnLineage"] as const)(
    "uses a staged advisory package when %s evidence is incomplete",
    (dimension) => {
      const draft = createGoldenDraft(withIncompleteEvidence(makeChangeContext(), dimension));

      expect(draft).toMatchObject({
        strategy: "STAGED_COMPATIBILITY",
        executionClassification: "ADVISORY_ONLY",
        rationale: "METADATA_LIMITED",
      });
      expect(draft.warnings).toContain("COLUMN_LINEAGE_INCOMPLETE");
    },
  );

  it("permits executable-with-review only for complete evidence and proceed-with-review", () => {
    const draft = createGoldenDraft(makeChangeContext({ score: 10 }));

    expect(draft).toMatchObject({
      strategy: "STAGED_COMPATIBILITY",
      executionClassification: "EXECUTABLE_WITH_REVIEW",
      rationale: "DOWNSTREAM_COORDINATION_REQUIRED",
    });
  });

  it("keeps complete critical evidence advisory", () => {
    const draft = createGoldenDraft(makeChangeContext());

    expect(draft).toMatchObject({
      strategy: "STAGED_COMPATIBILITY",
      executionClassification: "ADVISORY_ONLY",
      rationale: "CRITICAL_DOWNSTREAM_IMPACT",
    });
    expect(draft.warnings).toContain("DIRECT_RENAME_BLOCKED");
  });
});
