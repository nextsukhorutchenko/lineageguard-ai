import type { WorkflowStatus } from "./contracts.js";

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

export function isTerminalWorkflowStatus(status: WorkflowStatus): boolean {
  return terminal.has(status);
}

export function transitionWorkflow(current: WorkflowStatus, next: WorkflowStatus): WorkflowStatus {
  if (!allowed[current].includes(next))
    throw new Error(`Invalid workflow transition: ${current} -> ${next}`);
  return next;
}
