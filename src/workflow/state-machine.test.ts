import { describe, expect, it } from "vitest";
import { isTerminalWorkflowStatus, transitionWorkflow } from "./state-machine.js";

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

  it("identifies terminal statuses and prevents terminal transitions", () => {
    expect(isTerminalWorkflowStatus("COMPLETED")).toBe(true);
    expect(isTerminalWorkflowStatus("ANALYZING_IMPACT")).toBe(false);
    expect(() => transitionWorkflow("CANCELLED", "RESOLVING_CONTEXT")).toThrow(
      "Invalid workflow transition: CANCELLED -> RESOLVING_CONTEXT",
    );
  });
});
