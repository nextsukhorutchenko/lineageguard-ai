import {
  WorkflowSnapshotSchema,
  type WorkflowFailure,
  type WorkflowSnapshot,
} from "../../../src/workflow/contracts.js";
import { sanitizeBoundaryText } from "../../../src/security/sanitize-output.js";

type FailureStatus = WorkflowFailure["code"];

export const failedSnapshot = (status: FailureStatus, message: string): WorkflowSnapshot => {
  const snapshot: WorkflowSnapshot = {
    runId: `fixture-${status.toLocaleLowerCase("en-US")}`,
    mode: "REPLAY",
    status,
    activity: [],
    artifacts: [],
    evidence: [],
    facts: [],
    assumptions: [],
    unknowns: [],
    validation:
      status === "VALIDATION_FAILED"
        ? { outcome: "REJECTED", findingCount: 2, findingCodes: ["PROHIBITED_SQL"] }
        : { outcome: "NOT_RUN", findingCount: 0, findingCodes: [] },
    failure: { code: status, message },
  };
  return WorkflowSnapshotSchema.parse(snapshot);
};

export const ndjson = (snapshot: WorkflowSnapshot): string =>
  `${JSON.stringify({ type: "snapshot", snapshot })}\n`;

export const sanitizedFailedSnapshot = (
  status: FailureStatus,
  unsafeMessage: string,
  secrets: readonly string[],
): WorkflowSnapshot => failedSnapshot(status, sanitizeBoundaryText(unsafeMessage, secrets, 500));

export const incompleteEvidenceSnapshot = (): WorkflowSnapshot => ({
  runId: "fixture-incomplete-evidence",
  mode: "REPLAY",
  status: "COMPLETED",
  analysisStatus: "INCOMPLETE_EVIDENCE",
  activity: [],
  artifacts: [
    { filename: "migration-up.sql", sha256: "a".repeat(64), validated: true },
    { filename: "migration-down.sql", sha256: "b".repeat(64), validated: true },
    { filename: "validation.sql", sha256: "c".repeat(64), validated: true },
    { filename: "rollout-plan.md", sha256: "d".repeat(64), validated: true },
  ],
  evidence: [],
  facts: [],
  assumptions: [],
  unknowns: ["Table-lineage count is a collected lower bound."],
  evidenceCompleteness: {
    complete: false,
    search: { complete: true, pages: 1, itemCount: 1, offsets: [0], reasonCodes: [] },
    schema: { complete: true, pages: 1, itemCount: 2, offsets: [0], reasonCodes: [] },
    tableLineage: {
      complete: false,
      pages: 1,
      itemCount: 100,
      offsets: [0],
      reasonCodes: ["ITEM_LIMIT_REACHED"],
    },
    columnLineage: {
      complete: false,
      pages: 1,
      itemCount: 70,
      offsets: [0],
      reasonCodes: ["TOKEN_BUDGET_TRUNCATION"],
    },
  },
  entityContextRetrieval: {
    complete: false,
    pages: 5,
    itemCount: 50,
    offsets: [0, 10, 20, 30, 40],
    reasonCodes: ["ENTITY_CONTEXT_TRUNCATED"],
  },
  contextCoverage: {
    retrievalComplete: false,
    relevantAssets: 101,
    inspectedAssets: 50,
    retrievalPercentage: 50,
    possibleSignals: 150,
    coveredSignals: 60,
    percentage: 40,
    withDescriptions: 20,
    withOwners: 20,
    withGovernance: 20,
    missingMetadataUrns: Array.from(
      { length: 30 },
      (_, index) => `urn:li:dataset:(missing-${index})`,
    ),
    unknownMetadataUrns: Array.from(
      { length: 51 },
      (_, index) => `urn:li:dataset:(unknown-${index})`,
    ),
  },
  contextIndicators: {
    quality: { assetsWithSignals: 10, signalCount: 12 },
    usage: {
      status: "NOT_COLLECTED",
      assetsWithSignals: 0,
      signalCount: 0,
      reason: "OUTSIDE_FOUR_TOOL_SLICE",
    },
  },
  executionClassification: "ADVISORY_ONLY",
  validation: { outcome: "PASSED", findingCount: 0, findingCodes: [] },
});
