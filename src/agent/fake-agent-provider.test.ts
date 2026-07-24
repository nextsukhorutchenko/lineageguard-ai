import { describe, expect, it, vi } from "vitest";
import { makeChangeContext } from "../../tests/helpers/factories.js";
import type { PackageFinding } from "../migrations/validate-sql.js";
import type { ChangeContext } from "../workflow/change-context.js";
import { FakeAgentProvider, createGoldenDraft } from "./fake-agent-provider.js";
import type { AnalyzeRenameResult } from "./provider.js";

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
  it("does not call either tool when the signal is already aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled-before-run");
    const analyzeRenameChange = vi.fn();
    const generateMigrationPackage = vi.fn().mockResolvedValue({
      kind: "accepted",
      classification: "ADVISORY_ONLY",
    });
    controller.abort(reason);

    await expect(
      new FakeAgentProvider().run({
        request: "Rename column a to b in dataset example",
        tools: { analyzeRenameChange, generateMigrationPackage },
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(analyzeRenameChange).not.toHaveBeenCalled();
    expect(generateMigrationPackage).not.toHaveBeenCalled();
  });

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
    const generateMigrationPackage = vi.fn().mockResolvedValue({
      kind: "accepted",
      classification: "ADVISORY_ONLY",
    });
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

  it("does not call generation when ready analysis completes by aborting the signal", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled-at-analysis-completion");
    const context = makeChangeContext();
    const generateMigrationPackage = vi.fn().mockResolvedValue({
      kind: "accepted",
      classification: "ADVISORY_ONLY",
    });

    await expect(
      new FakeAgentProvider().run({
        request: context.request,
        tools: {
          analyzeRenameChange: vi.fn().mockImplementation(async () => {
            controller.abort(reason);
            return { kind: "ready", context };
          }),
          generateMigrationPackage,
        },
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(generateMigrationPackage).not.toHaveBeenCalled();
  });

  it("rechecks cancellation immediately before invoking generation", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled-while-building-draft");
    const baseContext = makeChangeContext();
    const context: ChangeContext = {
      ...baseContext,
      get evidenceCompleteness() {
        controller.abort(reason);
        return baseContext.evidenceCompleteness;
      },
    };
    const generateMigrationPackage = vi.fn().mockResolvedValue({
      kind: "accepted",
      classification: "ADVISORY_ONLY",
    });

    await expect(
      new FakeAgentProvider().run({
        request: context.request,
        tools: {
          analyzeRenameChange: vi.fn().mockResolvedValue({ kind: "ready", context }),
          generateMigrationPackage,
        },
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(generateMigrationPackage).not.toHaveBeenCalled();
  });

  it.each([
    {
      knownFields: undefined,
      expectedFailure: {
        code: "COLUMN_NOT_FOUND",
        message: "The source column was not found.",
      },
    },
    {
      knownFields: ["customer_key", "order_id"],
      expectedFailure: {
        code: "COLUMN_NOT_FOUND",
        message: "The source column was not found.",
        knownFields: ["customer_key", "order_id"],
      },
    },
  ])("preserves an authoritative analysis failure ($knownFields)", async (testCase) => {
    const generateMigrationPackage = vi.fn();
    const analysis = {
      kind: "failed",
      code: "COLUMN_NOT_FOUND",
      message: "The source column was not found.",
      ...(testCase.knownFields === undefined ? {} : { knownFields: testCase.knownFields }),
    } satisfies AnalyzeRenameResult;

    const result = await new FakeAgentProvider().run({
      request: "Rename column absent to customer_key in dataset example",
      tools: {
        analyzeRenameChange: vi.fn().mockResolvedValue(analysis),
        generateMigrationPackage,
      },
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      status: "failed",
      provider: "fixture",
      model: "replay-v1",
      reasoningEffort: "none",
      analysisCalls: 1,
      generationAttempts: 0,
      message: "The source column was not found.",
      failure: testCase.expectedFailure,
    });
    expect(generateMigrationPackage).not.toHaveBeenCalled();
  });

  it("reports rejected generation with exact bounded finding messages and counters", async () => {
    const context = makeChangeContext();
    const findings = [
      {
        code: "EVIDENCE_REFERENCE_MISSING",
        message: "The draft cites an unknown evidence identifier.",
      },
      {
        code: "RISK_POLICY_MISMATCH",
        message: "The package classification exceeds the deterministic policy.",
        filename: "rollout-plan.md",
      },
    ] satisfies readonly PackageFinding[];

    const result = await new FakeAgentProvider().run({
      request: context.request,
      tools: {
        analyzeRenameChange: vi.fn().mockResolvedValue({ kind: "ready", context }),
        generateMigrationPackage: vi.fn().mockResolvedValue({ kind: "rejected", findings }),
      },
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      status: "failed",
      provider: "fixture",
      model: "replay-v1",
      reasoningEffort: "none",
      analysisCalls: 1,
      generationAttempts: 1,
      message:
        "The draft cites an unknown evidence identifier. The package classification exceeds the deterministic policy.",
    });
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
