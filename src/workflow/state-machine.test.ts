import { describe, expect, it } from "vitest";
import type { WorkflowStatus } from "./contracts.js";
import { isTerminalWorkflowStatus, transitionWorkflow } from "./state-machine.js";

const statuses = [
  "DRAFT",
  "RESOLVING_CONTEXT",
  "NEEDS_USER_CLARIFICATION",
  "ANALYZING_IMPACT",
  "GENERATING_ARTIFACTS",
  "VALIDATING_ARTIFACTS",
  "COMPLETED",
  "DATAHUB_UNAVAILABLE",
  "MCP_UNAVAILABLE",
  "TARGET_NOT_FOUND",
  "COLUMN_NOT_FOUND",
  "ANALYSIS_FAILED",
  "GENERATION_FAILED",
  "VALIDATION_FAILED",
  "ARTIFACT_WRITE_FAILED",
  "CANCELLED",
] as const satisfies readonly WorkflowStatus[];

const allowed: Readonly<Record<WorkflowStatus, readonly WorkflowStatus[]>> = {
  DRAFT: ["RESOLVING_CONTEXT", "GENERATING_ARTIFACTS", "CANCELLED"],
  RESOLVING_CONTEXT: [
    "NEEDS_USER_CLARIFICATION",
    "ANALYZING_IMPACT",
    "DATAHUB_UNAVAILABLE",
    "MCP_UNAVAILABLE",
    "TARGET_NOT_FOUND",
    "COLUMN_NOT_FOUND",
    "ANALYSIS_FAILED",
    "ARTIFACT_WRITE_FAILED",
    "GENERATION_FAILED",
    "CANCELLED",
  ],
  NEEDS_USER_CLARIFICATION: [],
  ANALYZING_IMPACT: [
    "NEEDS_USER_CLARIFICATION",
    "GENERATING_ARTIFACTS",
    "DATAHUB_UNAVAILABLE",
    "MCP_UNAVAILABLE",
    "TARGET_NOT_FOUND",
    "COLUMN_NOT_FOUND",
    "ANALYSIS_FAILED",
    "ARTIFACT_WRITE_FAILED",
    "GENERATION_FAILED",
    "CANCELLED",
  ],
  GENERATING_ARTIFACTS: [
    "VALIDATING_ARTIFACTS",
    "GENERATION_FAILED",
    "VALIDATION_FAILED",
    "CANCELLED",
  ],
  VALIDATING_ARTIFACTS: [
    "GENERATING_ARTIFACTS",
    "COMPLETED",
    "GENERATION_FAILED",
    "VALIDATION_FAILED",
    "ARTIFACT_WRITE_FAILED",
    "CANCELLED",
  ],
  COMPLETED: [],
  DATAHUB_UNAVAILABLE: [],
  MCP_UNAVAILABLE: [],
  TARGET_NOT_FOUND: [],
  COLUMN_NOT_FOUND: [],
  ANALYSIS_FAILED: [],
  GENERATION_FAILED: [],
  VALIDATION_FAILED: [],
  ARTIFACT_WRITE_FAILED: [],
  CANCELLED: [],
};

const terminal = new Set<WorkflowStatus>([
  "NEEDS_USER_CLARIFICATION",
  "COMPLETED",
  "DATAHUB_UNAVAILABLE",
  "MCP_UNAVAILABLE",
  "TARGET_NOT_FOUND",
  "COLUMN_NOT_FOUND",
  "ANALYSIS_FAILED",
  "GENERATION_FAILED",
  "VALIDATION_FAILED",
  "ARTIFACT_WRITE_FAILED",
  "CANCELLED",
]);

describe("transitionWorkflow", () => {
  it("allows the successful lifecycle", () => {
    expect(transitionWorkflow("DRAFT", "RESOLVING_CONTEXT")).toBe("RESOLVING_CONTEXT");
    expect(transitionWorkflow("RESOLVING_CONTEXT", "ANALYZING_IMPACT")).toBe("ANALYZING_IMPACT");
    expect(transitionWorkflow("ANALYZING_IMPACT", "GENERATING_ARTIFACTS")).toBe(
      "GENERATING_ARTIFACTS",
    );
    expect(transitionWorkflow("GENERATING_ARTIFACTS", "VALIDATING_ARTIFACTS")).toBe(
      "VALIDATING_ARTIFACTS",
    );
    expect(transitionWorkflow("VALIDATING_ARTIFACTS", "COMPLETED")).toBe("COMPLETED");
  });

  it("rejects completion before validation", () => {
    expect(() => transitionWorkflow("ANALYZING_IMPACT", "COMPLETED")).toThrow(
      "Invalid workflow transition",
    );
  });

  it("allows authoritative analysis clarification and persistence failure", () => {
    expect(transitionWorkflow("ANALYZING_IMPACT", "NEEDS_USER_CLARIFICATION")).toBe(
      "NEEDS_USER_CLARIFICATION",
    );
    expect(transitionWorkflow("ANALYZING_IMPACT", "ARTIFACT_WRITE_FAILED")).toBe(
      "ARTIFACT_WRITE_FAILED",
    );
  });

  it.each([
    "RESOLVING_CONTEXT",
    "ANALYZING_IMPACT",
    "GENERATING_ARTIFACTS",
    "VALIDATING_ARTIFACTS",
  ] as const)("allows the agent deadline to fail from %s", (source) => {
    expect(transitionWorkflow(source, "GENERATION_FAILED")).toBe("GENERATION_FAILED");
  });

  it("identifies terminal statuses and prevents terminal transitions", () => {
    expect(isTerminalWorkflowStatus("COMPLETED")).toBe(true);
    expect(isTerminalWorkflowStatus("ANALYZING_IMPACT")).toBe(false);
    expect(() => transitionWorkflow("CANCELLED", "RESOLVING_CONTEXT")).toThrow(
      "Invalid workflow transition: CANCELLED -> RESOLVING_CONTEXT",
    );
  });

  it.each(
    statuses.flatMap((current) =>
      statuses.map((next) => [current, next, allowed[current].includes(next)] as const),
    ),
  )("enforces the exact transition matrix: %s -> %s", (current, next, isAllowed) => {
    if (isAllowed) expect(transitionWorkflow(current, next)).toBe(next);
    else
      expect(() => transitionWorkflow(current, next)).toThrow(
        `Invalid workflow transition: ${current} -> ${next}`,
      );
  });

  it.each(statuses)("classifies terminal status %s exactly", (status) => {
    expect(isTerminalWorkflowStatus(status)).toBe(terminal.has(status));
  });
});
