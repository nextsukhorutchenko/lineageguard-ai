import { describe, expect, it } from "vitest";
import {
  AgentRunMetadataSchema,
  ContextCoverageSchema,
  ContextIndicatorSummarySchema,
  DataHubRunMetadataSchema,
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

  it("accepts exact deadline policy durations for generation attempts one and two", () => {
    expect(() =>
      WorkflowEventSchema.parse({
        type: "snapshot",
        snapshot: {
          ...emptySnapshot,
          status: "DRAFT",
          validation: undefined,
          deadlinePolicy: {
            mcpConnectMs: 15_000,
            datahubAnalysisMs: 55_000,
            analysisToolMs: 60_000,
            generationToolMs: 30_000,
            agentMs: 90_000,
            workflowMs: 95_000,
          },
          deadlineEvents: [
            { kind: "GENERATION_TIMEOUT", durationMs: 30_000, attempt: 1, outcome: "completed" },
            { kind: "GENERATION_TIMEOUT", durationMs: 30_000, attempt: 2, outcome: "expired" },
          ],
        },
      }),
    ).not.toThrow();
  });

  it("rejects duplicate deadline ownership and attempts", () => {
    const deadlinePolicy = {
      mcpConnectMs: 15_000,
      datahubAnalysisMs: 55_000,
      analysisToolMs: 60_000,
      generationToolMs: 30_000,
      agentMs: 90_000,
      workflowMs: 95_000,
    };
    expect(() =>
      WorkflowEventSchema.parse({
        type: "snapshot",
        snapshot: {
          ...emptySnapshot,
          status: "DRAFT",
          validation: undefined,
          deadlinePolicy,
          deadlineEvents: [
            { kind: "GENERATION_TIMEOUT", durationMs: 30_000, attempt: 1, outcome: "expired" },
            { kind: "GENERATION_TIMEOUT", durationMs: 30_000, attempt: 1, outcome: "cancelled" },
          ],
        },
      }),
    ).toThrow("Deadline events must be unique by owner and attempt");
  });

  it.each([
    ["MCP_CONNECT_TIMEOUT", 15_000],
    ["DATAHUB_ANALYSIS_TIMEOUT", 55_000],
    ["AGENT_TIMEOUT", 90_000],
    ["WORKFLOW_TIMEOUT", 95_000],
  ] as const)("rejects a second attempt for non-generation owner %s", (kind, durationMs) => {
    expect(() =>
      WorkflowEventSchema.parse({
        type: "snapshot",
        snapshot: {
          ...emptySnapshot,
          status: "DRAFT",
          validation: undefined,
          deadlinePolicy: {
            mcpConnectMs: 15_000,
            datahubAnalysisMs: 55_000,
            analysisToolMs: 60_000,
            generationToolMs: 30_000,
            agentMs: 90_000,
            workflowMs: 95_000,
          },
          deadlineEvents: [{ kind, durationMs, attempt: 2, outcome: "expired" }],
        },
      }),
    ).toThrow("Only generation may have a second attempt");
  });

  it("rejects deadline events without a policy", () => {
    expect(() =>
      WorkflowEventSchema.parse({
        type: "snapshot",
        snapshot: {
          ...emptySnapshot,
          status: "DRAFT",
          validation: undefined,
          deadlineEvents: [
            { kind: "GENERATION_TIMEOUT", durationMs: 30_000, attempt: 1, outcome: "expired" },
          ],
        },
      }),
    ).toThrow("Deadline events require a deadline policy");
  });

  it.each([
    ["MCP_CONNECT_TIMEOUT", 15_000],
    ["DATAHUB_ANALYSIS_TIMEOUT", 55_000],
    ["GENERATION_TIMEOUT", 30_000],
    ["AGENT_TIMEOUT", 90_000],
    ["WORKFLOW_TIMEOUT", 95_000],
  ] as const)("rejects a mismatched deadline duration for %s", (kind, durationMs) => {
    expect(() =>
      WorkflowEventSchema.parse({
        type: "snapshot",
        snapshot: {
          ...emptySnapshot,
          status: "DRAFT",
          validation: undefined,
          deadlinePolicy: {
            mcpConnectMs: 15_000,
            datahubAnalysisMs: 55_000,
            analysisToolMs: 60_000,
            generationToolMs: 30_000,
            agentMs: 90_000,
            workflowMs: 95_000,
          },
          deadlineEvents: [{ kind, durationMs: durationMs + 1, attempt: 1, outcome: "expired" }],
        },
      }),
    ).toThrow("Deadline event duration must match the configured policy");
  });

  it.each([
    [false, false, false, true],
    [true, true, true, true],
    [true, false, false, false],
    [false, true, false, false],
    [false, false, true, false],
    [true, true, false, false],
    [true, false, true, false],
    [false, true, true, false],
  ])(
    "serializes entity-context data only as an all-or-nothing group: %s/%s/%s",
    (hasRetrieval, hasCoverage, hasIndicators, valid) => {
      const event = {
        type: "snapshot",
        snapshot: {
          ...emptySnapshot,
          status: "DRAFT",
          validation: undefined,
          ...(hasRetrieval
            ? {
                entityContextRetrieval: {
                  complete: true,
                  pages: 1,
                  itemCount: 1,
                  offsets: [0],
                  reasonCodes: [],
                },
              }
            : {}),
          ...(hasCoverage
            ? {
                contextCoverage: {
                  retrievalComplete: true,
                  relevantAssets: 1,
                  inspectedAssets: 1,
                  retrievalPercentage: 100,
                  possibleSignals: 3,
                  coveredSignals: 0,
                  percentage: 0,
                  withDescriptions: 0,
                  withOwners: 0,
                  withGovernance: 0,
                  missingMetadataUrns: [],
                  unknownMetadataUrns: [],
                },
              }
            : {}),
          ...(hasIndicators
            ? {
                contextIndicators: {
                  quality: { assetsWithSignals: 0, signalCount: 0 },
                  usage: {
                    status: "NOT_COLLECTED",
                    assetsWithSignals: 0,
                    signalCount: 0,
                    reason: "OUTSIDE_FOUR_TOOL_SLICE",
                  },
                },
              }
            : {}),
        },
      };
      if (valid) expect(() => WorkflowEventSchema.parse(event)).not.toThrow();
      else expect(() => WorkflowEventSchema.parse(event)).toThrow("must be serialized together");
    },
  );

  it.each([
    ["REPLAY", "fixture", "REPLAY_FIXTURE", true],
    ["REPLAY", "mcp", "CAPABILITY_GATE_PASSED", false],
    ["LIVE", "mcp", "CAPABILITY_GATE_PASSED", true],
    ["LIVE", "fixture", "REPLAY_FIXTURE", false],
  ] as const)(
    "enforces DataHub-only runtime proof %s/%s/%s",
    (mode, source, verification, valid) => {
      const event = {
        type: "snapshot",
        snapshot: {
          ...emptySnapshot,
          mode,
          status: "DRAFT",
          validation: undefined,
          datahub: { ...datahubMetadata, source, verification },
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
    ["REPLAY", "fixture", true],
    ["REPLAY", "openai", false],
    ["LIVE", "openai", true],
    ["LIVE", "fixture", false],
  ] as const)("enforces agent-only runtime proof %s/%s", (mode, provider, valid) => {
    const event = {
      type: "snapshot",
      snapshot: {
        ...emptySnapshot,
        mode,
        status: "DRAFT",
        validation: undefined,
        agent: { ...agentMetadata, provider },
      },
    };
    if (valid) expect(() => WorkflowEventSchema.parse(event)).not.toThrow();
    else
      expect(() => WorkflowEventSchema.parse(event)).toThrow(
        "Runtime proof metadata contradicts the run mode",
      );
  });

  it.each([
    ["accepted", "analysis"],
    ["clarification", "analysis"],
    ["failed", "analysis"],
    ["accepted", "generation"],
    ["clarification", "generation"],
    ["failed", "generation"],
  ] as const)("rejects every non-not-called zero-call %s outcome for %s", (outcome, tool) => {
    const toolCalls: unknown[] = [...agentMetadata.toolCalls];
    const index = tool === "analysis" ? 0 : 1;
    toolCalls[index] = {
      name: tool === "analysis" ? "analyze_rename_change" : "generate_migration_package",
      calls: 0,
      outcome,
    };
    expect(() => AgentRunMetadataSchema.parse({ ...agentMetadata, toolCalls })).toThrow(
      "Agent tool-call metadata is inconsistent",
    );
  });

  it.each([
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 2],
  ] as const)(
    "accepts exact analysis/generation call boundaries %i/%i",
    (analysisCalls, generationCalls) => {
      expect(() =>
        AgentRunMetadataSchema.parse({
          ...agentMetadata,
          generationAttempts: generationCalls,
          toolCalls: [
            {
              ...agentMetadata.toolCalls[0],
              calls: analysisCalls,
              outcome: analysisCalls === 0 ? "not_called" : "accepted",
            },
            {
              ...agentMetadata.toolCalls[1],
              calls: generationCalls,
              outcome: generationCalls === 0 ? "not_called" : "accepted",
            },
          ],
        }),
      ).not.toThrow();
    },
  );

  it.each([
    {
      toolCalls: [
        { ...agentMetadata.toolCalls[0], calls: 1, outcome: "not_called" },
        agentMetadata.toolCalls[1],
      ],
    },
    {
      toolCalls: [
        agentMetadata.toolCalls[0],
        { ...agentMetadata.toolCalls[1], calls: 1, outcome: "not_called" },
      ],
    },
    {
      toolCalls: [
        agentMetadata.toolCalls[0],
        { ...agentMetadata.toolCalls[1], calls: 2, outcome: "not_called" },
      ],
    },
    {
      toolCalls: [
        agentMetadata.toolCalls[0],
        { ...agentMetadata.toolCalls[1], calls: 1, outcome: "clarification" },
      ],
    },
    {
      toolCalls: [
        agentMetadata.toolCalls[0],
        { ...agentMetadata.toolCalls[1], calls: 2, outcome: "clarification" },
      ],
    },
    {
      toolCalls: [
        { ...agentMetadata.toolCalls[0], calls: 2, outcome: "accepted" },
        agentMetadata.toolCalls[1],
      ],
    },
    {
      toolCalls: [
        agentMetadata.toolCalls[0],
        { ...agentMetadata.toolCalls[1], calls: 3, outcome: "accepted" },
      ],
    },
  ])("rejects invalid positive agent call boundaries and outcomes", ({ toolCalls }) => {
    expect(() => AgentRunMetadataSchema.parse({ ...agentMetadata, toolCalls })).toThrow();
  });

  it.each([
    [1, 0],
    [1, 2],
    [2, 0],
    [2, 1],
  ] as const)(
    "rejects generation attempt mismatches in both directions: calls %i, attempts %i",
    (calls, generationAttempts) => {
      expect(() =>
        AgentRunMetadataSchema.parse({
          ...agentMetadata,
          generationAttempts,
          toolCalls: [
            agentMetadata.toolCalls[0],
            { ...agentMetadata.toolCalls[1], calls, outcome: "accepted" },
          ],
        }),
      ).toThrow("Agent tool-call metadata is inconsistent");
    },
  );

  it.each([
    [datahubMetadata.allowedTools.slice(0, 3)],
    [["search", "search", "get_lineage", "get_entities"]],
    [["get_entities", "get_lineage", "list_schema_fields", "search"]],
    [["search", "list_schema_fields", "get_lineage", "get_entities", "search"]],
    [["search", "wrong", "get_lineage", "get_entities"]],
  ])("rejects malformed DataHub allowed-tools tuple", (allowedTools) => {
    expect(() => DataHubRunMetadataSchema.parse({ ...datahubMetadata, allowedTools })).toThrow();
  });

  it("accepts exact validation limits", () => {
    expect(
      ValidationSummarySchema.parse({
        outcome: "REJECTED",
        findingCount: 200,
        findingCodes: Array.from(
          { length: 20 },
          (_, index) => `CODE_${String(index).padStart(2, "0")}`,
        ),
      }),
    ).toMatchObject({ findingCount: 200 });
  });

  it("rejects validation limits immediately above each boundary", () => {
    expect(() =>
      ValidationSummarySchema.parse({
        outcome: "REJECTED",
        findingCount: 1,
        findingCodes: Array.from(
          { length: 21 },
          (_, index) => `CODE_${String(index).padStart(2, "0")}`,
        ),
      }),
    ).toThrow();
    expect(() =>
      ValidationSummarySchema.parse({
        outcome: "REJECTED",
        findingCount: 201,
        findingCodes: ["CODE"],
      }),
    ).toThrow();
  });

  it.each([
    ["analysis", "clarification", 1, "accepted", 1],
    ["analysis", "failed", 1, "accepted", 1],
    ["analysis", "not_called", 0, "accepted", 1],
    ["generation", "clarification", 1, "accepted", 1],
    ["generation", "failed", 1, "accepted", 1],
    ["generation", "not_called", 0, "accepted", 1],
  ] as const)(
    "rejects COMPLETED snapshots with wrong %s outcome %s",
    (wrongTool, wrongOutcome, wrongCalls, otherOutcome, otherCalls) => {
      const analysis = {
        ...agentMetadata.toolCalls[0],
        calls: wrongTool === "analysis" ? wrongCalls : 1,
        outcome: wrongTool === "analysis" ? wrongOutcome : otherOutcome,
      };
      const generation = {
        ...agentMetadata.toolCalls[1],
        calls: wrongTool === "generation" ? wrongCalls : otherCalls,
        outcome: wrongTool === "generation" ? wrongOutcome : otherOutcome,
      };
      expect(() =>
        WorkflowEventSchema.parse({
          type: "snapshot",
          snapshot: {
            ...emptySnapshot,
            contextHash: "a".repeat(64),
            agent: {
              ...agentMetadata,
              generationAttempts: generation.calls,
              toolCalls: [analysis, generation],
            },
          },
        }),
      ).toThrow();
    },
  );

  it.each([
    ["accepted", 1],
    ["failed", 1],
    ["not_called", 0],
  ] as const)(
    "rejects NEEDS_USER_CLARIFICATION with non-clarification analysis outcome %s",
    (outcome, calls) => {
      expect(() =>
        WorkflowEventSchema.parse({
          type: "snapshot",
          snapshot: {
            ...emptySnapshot,
            status: "NEEDS_USER_CLARIFICATION",
            validation: { outcome: "NOT_RUN", findingCount: 0, findingCodes: [] },
            failure: { code: "NEEDS_USER_CLARIFICATION", message: "clarify" },
            contextHash: "a".repeat(64),
            agent: {
              ...agentMetadata,
              toolCalls: [
                { ...agentMetadata.toolCalls[0], calls, outcome },
                agentMetadata.toolCalls[1],
              ],
            },
          },
        }),
      ).toThrow("Agent tool proof contradicts the workflow snapshot");
    },
  );

  it("rejects NEEDS_USER_CLARIFICATION when generation was called", () => {
    expect(() =>
      WorkflowEventSchema.parse({
        type: "snapshot",
        snapshot: {
          ...emptySnapshot,
          status: "NEEDS_USER_CLARIFICATION",
          validation: { outcome: "NOT_RUN", findingCount: 0, findingCodes: [] },
          failure: { code: "NEEDS_USER_CLARIFICATION", message: "clarify" },
          contextHash: "a".repeat(64),
          agent: {
            ...agentMetadata,
            generationAttempts: 1,
            toolCalls: [
              { ...agentMetadata.toolCalls[0], calls: 1, outcome: "clarification" },
              { ...agentMetadata.toolCalls[1], calls: 1, outcome: "accepted" },
            ],
          },
        },
      }),
    ).toThrow("Agent tool proof contradicts the workflow snapshot");
  });

  it.each([
    {
      name: "accepted analysis with zero generation",
      generationAttempts: 0,
      toolCalls: [
        { ...agentMetadata.toolCalls[0], calls: 1, outcome: "accepted" },
        agentMetadata.toolCalls[1],
      ],
    },
    {
      name: "positive generation",
      generationAttempts: 1,
      toolCalls: [
        { ...agentMetadata.toolCalls[0], calls: 1, outcome: "accepted" },
        { ...agentMetadata.toolCalls[1], calls: 1, outcome: "accepted" },
      ],
    },
  ])("requires contextHash for $name", ({ generationAttempts, toolCalls }) => {
    const snapshot = {
      ...emptySnapshot,
      status: "DRAFT",
      validation: undefined,
      agent: { ...agentMetadata, generationAttempts, toolCalls },
    };
    expect(() => WorkflowEventSchema.parse({ type: "snapshot", snapshot })).toThrow(
      "Agent tool proof contradicts the workflow snapshot",
    );
    expect(() =>
      WorkflowEventSchema.parse({
        type: "snapshot",
        snapshot: { ...snapshot, contextHash: "a".repeat(64) },
      }),
    ).not.toThrow();
  });
});
