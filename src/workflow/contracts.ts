import { z } from "zod";

export const DemoModeSchema = z.enum(["LIVE", "REPLAY"]);
export type DemoMode = z.infer<typeof DemoModeSchema>;

export const WorkflowStatusSchema = z.enum([
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
]);
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export const RunRequestSchema = z
  .object({
    mode: DemoModeSchema,
    request: z.string().trim().min(1).max(500),
  })
  .strict();
export type RunRequest = z.infer<typeof RunRequestSchema>;

export const ActivityEntrySchema = z
  .object({
    at: z.string().datetime(),
    status: WorkflowStatusSchema,
    label: z.string().min(1).max(120),
    outcome: z.enum(["started", "succeeded", "failed", "waiting"]),
    durationMs: z.number().int().nonnegative().optional(),
  })
  .strict();
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;

export const ArtifactSummarySchema = z
  .object({
    filename: z.enum([
      "migration-up.sql",
      "migration-down.sql",
      "validation.sql",
      "rollout-plan.md",
    ]),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    validated: z.boolean(),
  })
  .strict();

export const compareCanonicalText = (left: string, right: string): number =>
  left.localeCompare(right, "en");

export const WorkflowFailureSchema = z
  .object({
    code: WorkflowStatusSchema.exclude([
      "DRAFT",
      "RESOLVING_CONTEXT",
      "ANALYZING_IMPACT",
      "GENERATING_ARTIFACTS",
      "VALIDATING_ARTIFACTS",
      "COMPLETED",
    ]),
    message: z.string().min(1).max(500),
    candidates: z.array(z.string().startsWith("urn:li:").max(500)).min(1).max(20).optional(),
    omittedCandidateCount: z.number().int().min(1).max(980).optional(),
    knownFields: z.array(z.string().min(1).max(500)).max(100).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const invalid =
      (value.omittedCandidateCount !== undefined && value.candidates === undefined) ||
      (value.candidates !== undefined &&
        (new Set(value.candidates).size !== value.candidates.length ||
          value.candidates.some(
            (candidate, index) =>
              index > 0 && compareCanonicalText(candidate, value.candidates![index - 1]!) <= 0,
          ))) ||
      (value.knownFields !== undefined &&
        new Set(value.knownFields).size !== value.knownFields.length);
    if (invalid) ctx.addIssue({ code: "custom", message: "Failure details are inconsistent." });
  });
export type WorkflowFailure = z.infer<typeof WorkflowFailureSchema>;

export const ValidationSummarySchema = z
  .object({
    outcome: z.enum(["NOT_RUN", "PASSED", "REJECTED"]),
    findingCount: z.number().int().min(0).max(200),
    findingCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/u)).max(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    const invalid =
      new Set(value.findingCodes).size !== value.findingCodes.length ||
      value.findingCodes.some(
        (code, index) =>
          index > 0 && compareCanonicalText(code, value.findingCodes[index - 1]!) <= 0,
      ) ||
      ((value.outcome === "NOT_RUN" || value.outcome === "PASSED") &&
        (value.findingCount !== 0 || value.findingCodes.length !== 0)) ||
      (value.outcome === "REJECTED" && value.findingCount === 0);
    if (invalid) ctx.addIssue({ code: "custom", message: "Validation summary is inconsistent." });
  });
export type ValidationSummary = z.infer<typeof ValidationSummarySchema>;

export const EvidenceSummarySchema = z
  .object({
    id: z.string().startsWith("datahub:").max(600),
    urn: z.string().min(1).max(500),
    kind: z.enum(["target_dataset", "source_column", "downstream"]),
    level: z.enum(["dataset", "schema", "table", "column"]),
    fieldPath: z.string().min(1).max(500).optional(),
    hop: z.number().int().min(0).max(2).optional(),
  })
  .strict();

export const RequiredIncompleteReasonCodeSchema = z.enum([
  "HAS_MORE",
  "TOKEN_BUDGET_TRUNCATION",
  "PAGE_LIMIT_REACHED",
  "ITEM_LIMIT_REACHED",
  "REPEATED_PAGE",
  "NO_PROGRESS",
  "INCONSISTENT_PAGINATION",
]);
export const EntityContextIncompleteReasonCodeSchema = z.enum([
  "ENTITY_CONTEXT_UNAVAILABLE",
  "ENTITY_CONTEXT_TRUNCATED",
]);

const refineCompleteness = (
  value: { complete: boolean; pages: number; offsets: number[]; reasonCodes: string[] },
  ctx: z.RefinementCtx,
): void => {
  const invalid =
    value.complete !== (value.reasonCodes.length === 0) ||
    value.pages !== value.offsets.length ||
    new Set(value.offsets).size !== value.offsets.length ||
    new Set(value.reasonCodes).size !== value.reasonCodes.length ||
    value.offsets.some(
      (offset, index) =>
        (index === 0 && offset !== 0) || (index > 0 && offset <= value.offsets[index - 1]!),
    );
  if (invalid) ctx.addIssue({ code: "custom", message: "Inconsistent collection completeness." });
};

export const RequiredCollectionCompletenessSchema = z
  .object({
    complete: z.boolean(),
    pages: z.number().int().min(0).max(100),
    itemCount: z.number().int().min(0).max(10_000),
    offsets: z.array(z.number().int().nonnegative()).max(100),
    reasonCodes: z.array(RequiredIncompleteReasonCodeSchema).max(7),
  })
  .strict()
  .superRefine(refineCompleteness);

export const EntityContextRetrievalSchema = z
  .object({
    complete: z.boolean(),
    pages: z.number().int().min(0).max(5),
    itemCount: z.number().int().min(0).max(50),
    offsets: z.array(z.number().int().nonnegative()).max(5),
    reasonCodes: z.array(EntityContextIncompleteReasonCodeSchema).max(2),
  })
  .strict()
  .superRefine(refineCompleteness)
  .superRefine((value, ctx) => {
    const expectedOffsets = Array.from({ length: value.pages }, (_, index) => index * 10);
    if (
      value.itemCount > value.pages * 10 ||
      value.offsets.some((offset, index) => offset !== expectedOffsets[index])
    ) {
      ctx.addIssue({ code: "custom", message: "Inconsistent entity retrieval." });
    }
  });

export const EvidenceCompletenessSchema = z
  .object({
    complete: z.boolean(),
    search: RequiredCollectionCompletenessSchema,
    schema: RequiredCollectionCompletenessSchema,
    tableLineage: RequiredCollectionCompletenessSchema,
    columnLineage: RequiredCollectionCompletenessSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const aggregate =
      value.search.complete &&
      value.schema.complete &&
      value.tableLineage.complete &&
      value.columnLineage.complete;
    if (value.complete !== aggregate)
      ctx.addIssue({ code: "custom", message: "Inconsistent aggregate completeness." });
  });

export const NarrativeSummarySchema = z
  .object({
    totalFacts: z.number().int().min(0).max(10_000),
    includedFacts: z.number().int().min(0).max(100),
    totalAssumptions: z.number().int().min(0).max(10_000),
    includedAssumptions: z.number().int().min(0).max(100),
    totalUnknowns: z.number().int().min(0).max(10_000),
    includedUnknowns: z.number().int().min(0).max(100),
    truncated: z.boolean(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    const invalid =
      value.includedFacts > value.totalFacts ||
      value.includedAssumptions > value.totalAssumptions ||
      value.includedUnknowns > value.totalUnknowns ||
      value.truncated !==
        (value.totalFacts > value.includedFacts ||
          value.totalAssumptions > value.includedAssumptions ||
          value.totalUnknowns > value.includedUnknowns);
    if (invalid) ctx.addIssue({ code: "custom", message: "Inconsistent narrative summary." });
  });

export const ContextCoverageSchema = z
  .object({
    retrievalComplete: z.boolean(),
    relevantAssets: z.number().int().min(0).max(101),
    inspectedAssets: z.number().int().min(0).max(50),
    retrievalPercentage: z.number().int().min(0).max(100),
    possibleSignals: z.number().int().min(0).max(150),
    coveredSignals: z.number().int().min(0).max(150),
    percentage: z.number().int().min(0).max(100).nullable(),
    withDescriptions: z.number().int().min(0).max(50),
    withOwners: z.number().int().min(0).max(50),
    withGovernance: z.number().int().min(0).max(50),
    missingMetadataUrns: z.array(z.string().startsWith("urn:li:").max(500)).max(101),
    unknownMetadataUrns: z.array(z.string().startsWith("urn:li:").max(500)).max(101),
  })
  .strict()
  .superRefine((value, ctx) => {
    const expectedRetrieval =
      value.relevantAssets === 0
        ? 0
        : Math.round((value.inspectedAssets / value.relevantAssets) * 100);
    const expectedPercentage =
      value.inspectedAssets === 0
        ? null
        : Math.round((value.coveredSignals / (value.inspectedAssets * 3)) * 100);
    const invalid =
      value.inspectedAssets > value.relevantAssets ||
      value.possibleSignals !== value.inspectedAssets * 3 ||
      value.coveredSignals > value.possibleSignals ||
      value.coveredSignals !== value.withDescriptions + value.withOwners + value.withGovernance ||
      value.withDescriptions > value.inspectedAssets ||
      value.withOwners > value.inspectedAssets ||
      value.withGovernance > value.inspectedAssets ||
      value.retrievalPercentage !== expectedRetrieval ||
      value.percentage !== expectedPercentage ||
      new Set(value.missingMetadataUrns).size !== value.missingMetadataUrns.length ||
      new Set(value.unknownMetadataUrns).size !== value.unknownMetadataUrns.length ||
      value.missingMetadataUrns.length > value.inspectedAssets ||
      value.unknownMetadataUrns.length !== value.relevantAssets - value.inspectedAssets ||
      value.retrievalComplete !== (value.unknownMetadataUrns.length === 0) ||
      value.unknownMetadataUrns.some((urn) => value.missingMetadataUrns.includes(urn));
    if (invalid) ctx.addIssue({ code: "custom", message: "Inconsistent Context Coverage." });
  });

export const ContextIndicatorSummarySchema = z
  .object({
    quality: z
      .object({
        assetsWithSignals: z.number().int().min(0).max(50),
        signalCount: z.number().int().min(0).max(1_000),
      })
      .strict(),
    usage: z
      .object({
        status: z.literal("NOT_COLLECTED"),
        assetsWithSignals: z.literal(0),
        signalCount: z.literal(0),
        reason: z.literal("OUTSIDE_FOUR_TOOL_SLICE"),
      })
      .strict(),
  })
  .strict();

export const DeadlinePolicySchema = z
  .object({
    mcpConnectMs: z.literal(15_000),
    datahubAnalysisMs: z.literal(55_000),
    analysisToolMs: z.literal(60_000),
    generationToolMs: z.literal(30_000),
    agentMs: z.literal(90_000),
    workflowMs: z.literal(95_000),
  })
  .strict();
export const DeadlineEventSchema = z
  .object({
    kind: z.enum([
      "MCP_CONNECT_TIMEOUT",
      "DATAHUB_ANALYSIS_TIMEOUT",
      "GENERATION_TIMEOUT",
      "AGENT_TIMEOUT",
      "WORKFLOW_TIMEOUT",
    ]),
    durationMs: z.number().int().positive(),
    attempt: z.number().int().min(1).max(2),
    outcome: z.enum(["completed", "expired", "cancelled"]),
  })
  .strict();

export const DataHubRunMetadataSchema = z
  .object({
    source: z.enum(["mcp", "fixture"]),
    verification: z.enum(["CAPABILITY_GATE_PASSED", "REPLAY_FIXTURE"]),
    configuredMcpPackage: z.literal("mcp-server-datahub@0.6.0"),
    allowedTools: z.tuple([
      z.literal("search"),
      z.literal("list_schema_fields"),
      z.literal("get_lineage"),
      z.literal("get_entities"),
    ]),
    reportedServerName: z.string().max(100).optional(),
    reportedServerVersion: z.string().max(100).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.source === "mcp") !== (value.verification === "CAPABILITY_GATE_PASSED"))
      ctx.addIssue({
        code: "custom",
        message: "DataHub source and verification status are inconsistent.",
      });
  });
export type DataHubRunMetadata = z.infer<typeof DataHubRunMetadataSchema>;

export const AgentRunMetadataSchema = z
  .object({
    provider: z.enum(["openai", "fixture"]),
    model: z.string().min(1).max(100),
    reasoningEffort: z.enum(["medium", "none"]),
    promptVersion: z.string().min(1).max(100),
    schemaVersion: z.string().min(1).max(20),
    generationAttempts: z.number().int().min(0).max(2),
    toolCalls: z.tuple([
      z
        .object({
          name: z.literal("analyze_rename_change"),
          calls: z.number().int().min(0).max(1),
          outcome: z.enum(["accepted", "clarification", "failed", "not_called"]),
        })
        .strict(),
      z
        .object({
          name: z.literal("generate_migration_package"),
          calls: z.number().int().min(0).max(2),
          outcome: z.enum(["accepted", "clarification", "failed", "not_called"]),
        })
        .strict(),
    ]),
    latencyMs: z.number().int().nonnegative().optional(),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        totalTokens: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const [analysis, generation] = value.toolCalls;
    if (
      (analysis.calls === 0) !== (analysis.outcome === "not_called") ||
      (generation.calls === 0) !== (generation.outcome === "not_called") ||
      generation.outcome === "clarification" ||
      value.generationAttempts !== generation.calls
    )
      ctx.addIssue({ code: "custom", message: "Agent tool-call metadata is inconsistent." });
  });

export const WorkflowSnapshotSchema = z
  .object({
    runId: z.string().min(1).max(100),
    mode: DemoModeSchema,
    status: WorkflowStatusSchema,
    analysisStatus: z
      .enum([
        "COMPLETED",
        "COMPLETED_WITH_LIMITATIONS",
        "INSUFFICIENT_METADATA",
        "INCOMPLETE_EVIDENCE",
      ])
      .optional(),
    contextHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    parentRunId: z.string().min(1).max(100).optional(),
    activity: z.array(ActivityEntrySchema).max(30),
    evidence: z.array(EvidenceSummarySchema).max(102),
    facts: z.array(z.string().min(1).max(1_200)).max(100),
    assumptions: z.array(z.string().min(1).max(1_200)).max(100),
    unknowns: z.array(z.string().min(1).max(1_200)).max(100),
    narrativeSummary: NarrativeSummarySchema.optional(),
    evidenceCompleteness: EvidenceCompletenessSchema.optional(),
    entityContextRetrieval: EntityContextRetrievalSchema.optional(),
    contextCoverage: ContextCoverageSchema.optional(),
    contextIndicators: ContextIndicatorSummarySchema.optional(),
    deadlinePolicy: DeadlinePolicySchema.optional(),
    deadlineEvents: z.array(DeadlineEventSchema).max(6).optional(),
    datahub: DataHubRunMetadataSchema.optional(),
    impact: z
      .object({
        score: z.number().int().min(0).max(100),
        level: z.enum(["low", "medium", "high", "critical"]),
        confidence: z.enum(["low", "medium", "high"]),
        advisoryDecision: z.enum([
          "PROCEED_WITH_REVIEW",
          "MANUAL_APPROVAL_REQUIRED",
          "BLOCK_DIRECT_RENAME",
        ]),
        downstreamAssets: z.number().int().nonnegative(),
        columnAffectedAssets: z.number().int().nonnegative(),
        evidenceLevel: z.enum(["none", "table", "column"]),
        factors: z.array(
          z
            .object({
              name: z.string().min(1).max(100),
              points: z.number().int(),
              explanation: z.string().min(1).max(500),
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
    executionClassification: z
      .enum(["EXECUTABLE_WITH_REVIEW", "ADVISORY_ONLY", "NON_EXECUTABLE_TEMPLATE"])
      .optional(),
    agent: AgentRunMetadataSchema.optional(),
    validation: ValidationSummarySchema.optional(),
    artifacts: z.array(ArtifactSummarySchema).max(4),
    failure: WorkflowFailureSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const runtimeProofIsContradictory =
      (value.datahub?.source === "fixture" &&
        (value.mode !== "REPLAY" || value.datahub.verification !== "REPLAY_FIXTURE")) ||
      (value.datahub?.source === "mcp" &&
        (value.mode !== "LIVE" || value.datahub.verification !== "CAPABILITY_GATE_PASSED")) ||
      (value.agent?.provider === "fixture" && value.mode !== "REPLAY") ||
      (value.agent?.provider === "openai" && value.mode !== "LIVE");
    if (runtimeProofIsContradictory)
      ctx.addIssue({ code: "custom", message: "Runtime proof metadata contradicts the run mode." });
    if (value.agent !== undefined) {
      const [analysis, generation] = value.agent.toolCalls;
      const inconsistent =
        (value.status === "COMPLETED" &&
          (analysis.outcome !== "accepted" || generation.outcome !== "accepted")) ||
        (value.status === "NEEDS_USER_CLARIFICATION" &&
          (analysis.outcome !== "clarification" || generation.outcome !== "not_called")) ||
        (generation.calls > 0 &&
          (analysis.outcome !== "accepted" || value.contextHash === undefined)) ||
        (analysis.outcome === "accepted" && value.contextHash === undefined);
      if (inconsistent)
        ctx.addIssue({
          code: "custom",
          message: "Agent tool proof contradicts the workflow snapshot.",
        });
    }
    const nonTerminal = new Set([
      "DRAFT",
      "RESOLVING_CONTEXT",
      "ANALYZING_IMPACT",
      "GENERATING_ARTIFACTS",
      "VALIDATING_ARTIFACTS",
    ]);
    const failureExpected = value.status !== "COMPLETED" && !nonTerminal.has(value.status);
    if (
      failureExpected !== (value.failure !== undefined) ||
      (value.failure !== undefined && value.failure.code !== value.status)
    )
      ctx.addIssue({ code: "custom", message: "Workflow failure must match terminal status." });
    if (
      (!nonTerminal.has(value.status) && value.validation === undefined) ||
      (value.status === "COMPLETED" && value.validation?.outcome !== "PASSED") ||
      (value.status === "VALIDATION_FAILED" && value.validation?.outcome !== "REJECTED")
    )
      ctx.addIssue({ code: "custom", message: "Terminal validation summary is inconsistent." });
    if (
      value.narrativeSummary !== undefined &&
      (value.narrativeSummary.includedFacts !== value.facts.length ||
        value.narrativeSummary.includedAssumptions !== value.assumptions.length ||
        value.narrativeSummary.includedUnknowns !== value.unknowns.length)
    )
      ctx.addIssue({ code: "custom", message: "Narrative summary does not match the snapshot." });
    const hasRetrieval = value.entityContextRetrieval !== undefined;
    const hasCoverage = value.contextCoverage !== undefined;
    const hasIndicators = value.contextIndicators !== undefined;
    if (hasRetrieval !== hasCoverage || hasCoverage !== hasIndicators)
      ctx.addIssue({
        code: "custom",
        message:
          "Entity-context retrieval, Context Coverage, and context indicators must be serialized together.",
      });
    if (
      value.entityContextRetrieval !== undefined &&
      value.contextCoverage !== undefined &&
      (value.entityContextRetrieval.complete !== value.contextCoverage.retrievalComplete ||
        value.entityContextRetrieval.itemCount !== value.contextCoverage.inspectedAssets)
    )
      ctx.addIssue({
        code: "custom",
        message: "Entity-context retrieval is inconsistent with Context Coverage.",
      });
    if (value.deadlineEvents !== undefined) {
      const keys = value.deadlineEvents.map(({ kind, attempt }) => `${kind}:${attempt}`);
      if (new Set(keys).size !== keys.length)
        ctx.addIssue({
          code: "custom",
          message: "Deadline events must be unique by owner and attempt.",
        });
      if (
        value.deadlineEvents.some(
          ({ kind, attempt }) => kind !== "GENERATION_TIMEOUT" && attempt !== 1,
        )
      )
        ctx.addIssue({ code: "custom", message: "Only generation may have a second attempt." });
      if (value.deadlinePolicy === undefined)
        ctx.addIssue({ code: "custom", message: "Deadline events require a deadline policy." });
      else {
        const expectedDuration = {
          MCP_CONNECT_TIMEOUT: value.deadlinePolicy.mcpConnectMs,
          DATAHUB_ANALYSIS_TIMEOUT: value.deadlinePolicy.datahubAnalysisMs,
          GENERATION_TIMEOUT: value.deadlinePolicy.generationToolMs,
          AGENT_TIMEOUT: value.deadlinePolicy.agentMs,
          WORKFLOW_TIMEOUT: value.deadlinePolicy.workflowMs,
        } as const;
        if (value.deadlineEvents.some((event) => event.durationMs !== expectedDuration[event.kind]))
          ctx.addIssue({
            code: "custom",
            message: "Deadline event duration must match the configured policy.",
          });
      }
    }
  });
export type WorkflowSnapshot = z.infer<typeof WorkflowSnapshotSchema>;

export const WorkflowEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("activity"), entry: ActivityEntrySchema }).strict(),
  z.object({ type: z.literal("snapshot"), snapshot: WorkflowSnapshotSchema }).strict(),
]);
export type WorkflowEvent = z.infer<typeof WorkflowEventSchema>;
