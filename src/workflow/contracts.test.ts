import { describe, expect, it } from "vitest";
import {
  AgentRunMetadataSchema,
  ContextCoverageSchema,
  ContextIndicatorSummarySchema,
  DeadlineEventSchema,
  DeadlinePolicySchema,
  EntityContextRetrievalSchema,
  EvidenceCompletenessSchema,
  RequiredCollectionCompletenessSchema,
  RunRequestSchema,
  ValidationSummarySchema,
  WorkflowEventSchema,
  WorkflowFailureSchema,
} from "./contracts.js";

const completeCollection = {
  complete: true,
  pages: 1,
  itemCount: 1,
  offsets: [0],
  reasonCodes: [],
};

const emptySnapshot = {
  runId: "run-1",
  mode: "REPLAY",
  status: "COMPLETED",
  activity: [],
  evidence: [],
  facts: [],
  assumptions: [],
  unknowns: [],
  validation: { outcome: "PASSED", findingCount: 0, findingCodes: [] },
  artifacts: [],
};

const agentMetadata = {
  provider: "fixture",
  model: "fixture-model",
  reasoningEffort: "none",
  promptVersion: "v1",
  schemaVersion: "1",
  generationAttempts: 0,
  toolCalls: [
    { name: "analyze_rename_change", calls: 0, outcome: "not_called" },
    { name: "generate_migration_package", calls: 0, outcome: "not_called" },
  ],
};

const datahubMetadata = {
  source: "fixture",
  verification: "REPLAY_FIXTURE",
  configuredMcpPackage: "mcp-server-datahub@0.6.0",
  allowedTools: ["search", "list_schema_fields", "get_lineage", "get_entities"],
};

describe("workflow contracts", () => {
  it("accepts one bounded rename request", () => {
    expect(
      RunRequestSchema.parse({
        mode: "REPLAY",
        request:
          "Rename column customer_id to customer_key in dataset snowflake:b2fd91.order_entry_db.analytics.order_details",
      }),
    ).toMatchObject({ mode: "REPLAY" });
  });

  it("rejects unknown client fields", () => {
    expect(() =>
      RunRequestSchema.parse({ mode: "LIVE", request: "rename x", apiKey: "secret" }),
    ).toThrow();
  });

  it("parses a completed snapshot event", () => {
    expect(
      WorkflowEventSchema.parse({
        type: "snapshot",
        snapshot: {
          ...emptySnapshot,
          evidence: [
            {
              id: "datahub:source-column:customer_id",
              urn: "urn:li:dataset:(orders)",
              kind: "source_column",
              level: "schema",
              fieldPath: "customer_id",
            },
          ],
        },
      }).type,
    ).toBe("snapshot");
  });

  it("rejects internally inconsistent Context Coverage", () => {
    expect(() =>
      ContextCoverageSchema.parse({
        retrievalComplete: false,
        relevantAssets: 3,
        inspectedAssets: 2,
        retrievalPercentage: 100,
        possibleSignals: 9,
        coveredSignals: 3,
        percentage: 33,
        withDescriptions: 1,
        withOwners: 1,
        withGovernance: 1,
        missingMetadataUrns: ["urn:li:dataset:(two)"],
        unknownMetadataUrns: ["urn:li:dataset:(three)"],
      }),
    ).toThrow("Inconsistent Context Coverage");
  });

  it("keeps quality and uncollected usage indicators separate from coverage", () => {
    expect(
      ContextIndicatorSummarySchema.parse({
        quality: { assetsWithSignals: 2, signalCount: 3 },
        usage: {
          status: "NOT_COLLECTED",
          assetsWithSignals: 0,
          signalCount: 0,
          reason: "OUTSIDE_FOUR_TOOL_SLICE",
        },
      }).usage.status,
    ).toBe("NOT_COLLECTED");
    expect(() =>
      ContextIndicatorSummarySchema.parse({
        quality: { assetsWithSignals: 2, signalCount: 3 },
        usage: { status: "NOT_COLLECTED", assetsWithSignals: 1, signalCount: 1 },
      }),
    ).toThrow();
  });

  it("accepts the exact policy and only sanitized deadline events", () => {
    expect(
      DeadlinePolicySchema.parse({
        mcpConnectMs: 15_000,
        datahubAnalysisMs: 55_000,
        analysisToolMs: 60_000,
        generationToolMs: 30_000,
        agentMs: 90_000,
        workflowMs: 95_000,
      }),
    ).toMatchObject({ datahubAnalysisMs: 55_000 });
    expect(
      DeadlineEventSchema.parse({
        kind: "DATAHUB_ANALYSIS_TIMEOUT",
        durationMs: 55_000,
        attempt: 1,
        outcome: "expired",
      }),
    ).toMatchObject({ outcome: "expired" });
    expect(() =>
      DeadlineEventSchema.parse({
        kind: "DATAHUB_ANALYSIS_TIMEOUT",
        durationMs: 55_000,
        attempt: 1,
        outcome: "expired",
        reason: "raw AbortSignal reason",
      }),
    ).toThrow();
  });

  it.each([
    "HAS_MORE",
    "TOKEN_BUDGET_TRUNCATION",
    "PAGE_LIMIT_REACHED",
    "ITEM_LIMIT_REACHED",
    "REPEATED_PAGE",
    "NO_PROGRESS",
    "INCONSISTENT_PAGINATION",
  ] as const)("accepts required incompleteness reason %s only on required evidence", (reason) => {
    expect(
      RequiredCollectionCompletenessSchema.parse({
        complete: false,
        pages: 1,
        itemCount: 1,
        offsets: [0],
        reasonCodes: [reason],
      }).reasonCodes,
    ).toEqual([reason]);
    expect(() =>
      EntityContextRetrievalSchema.parse({
        complete: false,
        pages: 1,
        itemCount: 1,
        offsets: [0],
        reasonCodes: [reason],
      }),
    ).toThrow();
  });

  it.each([
    { complete: false, pages: 1, itemCount: 1, offsets: [0], reasonCodes: [] },
    { complete: true, pages: 1, itemCount: 1, offsets: [0], reasonCodes: ["HAS_MORE"] },
    { complete: true, pages: 2, itemCount: 1, offsets: [0], reasonCodes: [] },
    { complete: true, pages: 2, itemCount: 1, offsets: [0, 0], reasonCodes: [] },
    { complete: true, pages: 2, itemCount: 1, offsets: [10, 0], reasonCodes: [] },
  ])("rejects contradictory collection completeness %#", (value) => {
    expect(() => RequiredCollectionCompletenessSchema.parse(value)).toThrow(
      "Inconsistent collection completeness",
    );
  });

  it("rejects contradictory aggregate completeness in either direction", () => {
    expect(() =>
      EvidenceCompletenessSchema.parse({
        complete: false,
        search: completeCollection,
        schema: completeCollection,
        tableLineage: completeCollection,
        columnLineage: completeCollection,
      }),
    ).toThrow("Inconsistent aggregate completeness");
    expect(() =>
      EvidenceCompletenessSchema.parse({
        complete: true,
        search: { ...completeCollection, complete: false, reasonCodes: ["HAS_MORE"] },
        schema: completeCollection,
        tableLineage: completeCollection,
        columnLineage: completeCollection,
      }),
    ).toThrow("Inconsistent aggregate completeness");
  });

  it("rejects entity retrieval that disagrees with persisted Context Coverage", () => {
    expect(() =>
      WorkflowEventSchema.parse({
        type: "snapshot",
        snapshot: {
          ...emptySnapshot,
          entityContextRetrieval: {
            complete: true,
            pages: 1,
            itemCount: 1,
            offsets: [0],
            reasonCodes: [],
          },
          contextCoverage: {
            retrievalComplete: false,
            relevantAssets: 2,
            inspectedAssets: 1,
            retrievalPercentage: 50,
            possibleSignals: 3,
            coveredSignals: 0,
            percentage: 0,
            withDescriptions: 0,
            withOwners: 0,
            withGovernance: 0,
            missingMetadataUrns: ["urn:li:dataset:(one)"],
            unknownMetadataUrns: ["urn:li:dataset:(two)"],
          },
          contextIndicators: {
            quality: { assetsWithSignals: 0, signalCount: 0 },
            usage: {
              status: "NOT_COLLECTED",
              assetsWithSignals: 0,
              signalCount: 0,
              reason: "OUTSIDE_FOUR_TOOL_SLICE",
            },
          },
        },
      }),
    ).toThrow("Entity-context retrieval is inconsistent with Context Coverage");
  });

  it("requires a matching failure only for terminal failure statuses", () => {
    expect(() =>
      WorkflowEventSchema.parse({
        type: "snapshot",
        snapshot: { ...emptySnapshot, status: "GENERATION_FAILED" },
      }),
    ).toThrow("Workflow failure must match terminal status");
    expect(() =>
      WorkflowEventSchema.parse({
        type: "snapshot",
        snapshot: {
          ...emptySnapshot,
          failure: { code: "GENERATION_FAILED", message: "wrong" },
        },
      }),
    ).toThrow("Workflow failure must match terminal status");
  });

  it("rejects inconsistent failure candidate ordering and omission details", () => {
    const failure = { code: "TARGET_NOT_FOUND", message: "missing" };
    expect(() => WorkflowFailureSchema.parse({ ...failure, omittedCandidateCount: 1 })).toThrow(
      "Failure details are inconsistent",
    );
    expect(() =>
      WorkflowFailureSchema.parse({
        ...failure,
        candidates: ["urn:li:dataset:(b)", "urn:li:dataset:(b)"],
      }),
    ).toThrow("Failure details are inconsistent");
    expect(() =>
      WorkflowFailureSchema.parse({
        ...failure,
        candidates: ["urn:li:dataset:(z)", "urn:li:dataset:(a)"],
      }),
    ).toThrow("Failure details are inconsistent");
    expect(() =>
      WorkflowFailureSchema.parse({
        ...failure,
        candidates: ["urn:li:dataset:(B)", "urn:li:dataset:(%61)"],
      }),
    ).toThrow("Failure details are inconsistent");
  });

  it("enforces terminal validation summaries and canonical findings", () => {
    expect(() =>
      WorkflowEventSchema.parse({
        type: "snapshot",
        snapshot: { ...emptySnapshot, validation: undefined },
      }),
    ).toThrow("Terminal validation summary is inconsistent");
    expect(() =>
      WorkflowEventSchema.parse({
        type: "snapshot",
        snapshot: {
          ...emptySnapshot,
          validation: { outcome: "REJECTED", findingCount: 1, findingCodes: ["X"] },
        },
      }),
    ).toThrow("Terminal validation summary is inconsistent");
    expect(() =>
      WorkflowEventSchema.parse({
        type: "snapshot",
        snapshot: {
          ...emptySnapshot,
          status: "VALIDATION_FAILED",
          validation: { outcome: "PASSED", findingCount: 0, findingCodes: [] },
          failure: { code: "VALIDATION_FAILED", message: "rejected" },
        },
      }),
    ).toThrow("Terminal validation summary is inconsistent");
    expect(() =>
      ValidationSummarySchema.parse({
        outcome: "REJECTED",
        findingCount: 1,
        findingCodes: ["B", "A"],
      }),
    ).toThrow("Validation summary is inconsistent");
    expect(() =>
      ValidationSummarySchema.parse({
        outcome: "REJECTED",
        findingCount: 1,
        findingCodes: ["A", "A"],
      }),
    ).toThrow("Validation summary is inconsistent");
    expect(() =>
      ValidationSummarySchema.parse({
        outcome: "REJECTED",
        findingCount: 201,
        findingCodes: Array.from({ length: 21 }, (_, index) => `CODE_${index}`),
      }),
    ).toThrow();
  });

  it.each([
    ["REPLAY", "fixture", "REPLAY_FIXTURE", "fixture", true],
    ["REPLAY", "fixture", "REPLAY_FIXTURE", "openai", false],
    ["REPLAY", "fixture", "CAPABILITY_GATE_PASSED", "fixture", false],
    ["REPLAY", "fixture", "CAPABILITY_GATE_PASSED", "openai", false],
    ["REPLAY", "mcp", "REPLAY_FIXTURE", "fixture", false],
    ["REPLAY", "mcp", "REPLAY_FIXTURE", "openai", false],
    ["REPLAY", "mcp", "CAPABILITY_GATE_PASSED", "fixture", false],
    ["REPLAY", "mcp", "CAPABILITY_GATE_PASSED", "openai", false],
    ["LIVE", "fixture", "REPLAY_FIXTURE", "fixture", false],
    ["LIVE", "fixture", "REPLAY_FIXTURE", "openai", false],
    ["LIVE", "fixture", "CAPABILITY_GATE_PASSED", "fixture", false],
    ["LIVE", "fixture", "CAPABILITY_GATE_PASSED", "openai", false],
    ["LIVE", "mcp", "REPLAY_FIXTURE", "fixture", false],
    ["LIVE", "mcp", "REPLAY_FIXTURE", "openai", false],
    ["LIVE", "mcp", "CAPABILITY_GATE_PASSED", "fixture", false],
    ["LIVE", "mcp", "CAPABILITY_GATE_PASSED", "openai", true],
  ] as const)(
    "accepts only coherent runtime proof %s/%s/%s/%s",
    (mode, source, verification, provider, valid) => {
      const event = {
        type: "snapshot",
        snapshot: {
          ...emptySnapshot,
          mode,
          status: "DRAFT",
          validation: undefined,
          datahub: { ...datahubMetadata, source, verification },
          agent: { ...agentMetadata, provider },
        },
      };
      if (valid) expect(() => WorkflowEventSchema.parse(event)).not.toThrow();
      else
        expect(() => WorkflowEventSchema.parse(event)).toThrow(
          "Runtime proof metadata contradicts the run mode",
        );
    },
  );

  it.each([
    [{ ...agentMetadata, toolCalls: [agentMetadata.toolCalls[0]] }],
    [{ ...agentMetadata, toolCalls: [agentMetadata.toolCalls[0], agentMetadata.toolCalls[0]] }],
    [{ ...agentMetadata, toolCalls: [agentMetadata.toolCalls[1], agentMetadata.toolCalls[0]] }],
    [{ ...agentMetadata, toolCalls: [...agentMetadata.toolCalls, agentMetadata.toolCalls[1]] }],
    [
      {
        ...agentMetadata,
        toolCalls: [{ ...agentMetadata.toolCalls[0], name: "wrong" }, agentMetadata.toolCalls[1]],
      },
    ],
    [
      {
        ...agentMetadata,
        toolCalls: [{ ...agentMetadata.toolCalls[0], calls: 2 }, agentMetadata.toolCalls[1]],
      },
    ],
  ])("rejects malformed agent tool-call tuples", (value) => {
    expect(() => AgentRunMetadataSchema.parse(value)).toThrow();
  });

  it.each([
    {
      toolCalls: [
        { ...agentMetadata.toolCalls[0], outcome: "accepted" },
        agentMetadata.toolCalls[1],
      ],
    },
    { toolCalls: [{ ...agentMetadata.toolCalls[0], calls: 1 }, agentMetadata.toolCalls[1]] },
    {
      toolCalls: [
        agentMetadata.toolCalls[0],
        { ...agentMetadata.toolCalls[1], outcome: "accepted" },
      ],
    },
    { toolCalls: [agentMetadata.toolCalls[0], { ...agentMetadata.toolCalls[1], calls: 1 }] },
    {
      toolCalls: [
        agentMetadata.toolCalls[0],
        { ...agentMetadata.toolCalls[1], calls: 1, outcome: "clarification" },
      ],
    },
    { generationAttempts: 1 },
  ])("rejects contradictory agent call outcomes and attempt counts", (change) => {
    expect(() => AgentRunMetadataSchema.parse({ ...agentMetadata, ...change })).toThrow(
      "Agent tool-call metadata is inconsistent",
    );
  });

  it("requires status-compatible agent proof and a context hash", () => {
    const acceptedAgent = {
      ...agentMetadata,
      toolCalls: [
        { name: "analyze_rename_change", calls: 1, outcome: "accepted" },
        { name: "generate_migration_package", calls: 1, outcome: "accepted" },
      ],
      generationAttempts: 1,
    };
    expect(() =>
      WorkflowEventSchema.parse({
        type: "snapshot",
        snapshot: { ...emptySnapshot, agent: acceptedAgent },
      }),
    ).toThrow("Agent tool proof contradicts the workflow snapshot");
    expect(() =>
      WorkflowEventSchema.parse({
        type: "snapshot",
        snapshot: {
          ...emptySnapshot,
          agent: {
            ...acceptedAgent,
            toolCalls: [
              acceptedAgent.toolCalls[0],
              { ...acceptedAgent.toolCalls[1], calls: 0, outcome: "not_called" },
            ],
            generationAttempts: 0,
          },
          contextHash: "a".repeat(64),
        },
      }),
    ).toThrow("Agent tool proof contradicts the workflow snapshot");
    expect(() =>
      WorkflowEventSchema.parse({
        type: "snapshot",
        snapshot: {
          ...emptySnapshot,
          status: "NEEDS_USER_CLARIFICATION",
          validation: { outcome: "NOT_RUN", findingCount: 0, findingCodes: [] },
          failure: { code: "NEEDS_USER_CLARIFICATION", message: "clarify" },
          agent: {
            ...agentMetadata,
            toolCalls: [
              { ...agentMetadata.toolCalls[0], calls: 1, outcome: "clarification" },
              agentMetadata.toolCalls[1],
            ],
          },
        },
      }),
    ).not.toThrow();
  });
});
