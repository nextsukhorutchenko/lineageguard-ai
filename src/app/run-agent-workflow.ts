import type {
  AgentProvider,
  AgentProviderResult,
  AgentToolset,
  AnalyzeRenameResult,
} from "../agent/provider.js";
import { MIGRATION_AGENT_PROMPT_VERSION } from "../agent/prompt.js";
import { analyzeImpact, ImpactReportPersistenceError } from "./run-impact-analysis.js";
import type { DataHubCatalog, DataHubServerInfo } from "../datahub/catalog.js";
import { AppError } from "../errors/app-error.js";
import {
  renderMigrationPackage,
  type RenderedMigrationPackage,
} from "../migrations/render-snowflake-package.js";
import { validatePackage } from "../migrations/validate-package.js";
import type { PackageFinding } from "../migrations/validate-sql.js";
import { persistCompletedRun, persistFailedRun, type ReservedChildRun } from "../runs/run-store.js";
import {
  createDeadlineEventRecorder,
  type RecordDeadlineEvent,
} from "../runtime/deadline-events.js";
import {
  createDeadline,
  createRequestAbortScope,
  DEADLINES_MS,
  type ClassifiedAbortScope,
} from "../runtime/deadlines.js";
import { sanitizeBoundaryText } from "../security/sanitize-output.js";
import { sanitizeValidationFindings } from "../security/sanitize-validation-findings.js";
import {
  buildChangeContext,
  ChangeContextSchema,
  type ChangeContext,
} from "../workflow/change-context.js";
import {
  compareCanonicalText,
  DataHubRunMetadataSchema,
  RunRequestSchema,
  ValidationSummarySchema,
  WorkflowFailureSchema,
  WorkflowSnapshotSchema,
  type ActivityEntry,
  type DataHubRunMetadata,
  type DemoMode,
  type ValidationSummary,
  type WorkflowEvent,
  type WorkflowSnapshot,
  type WorkflowStatus,
} from "../workflow/contracts.js";
import {
  MigrationPackageDraftSchema,
  type MigrationPackageDraft,
} from "../workflow/migration-draft.js";
import { isTerminalWorkflowStatus, transitionWorkflow } from "../workflow/state-machine.js";
import { validateMigrationDraft } from "../workflow/validate-migration-draft.js";

export interface RunAgentWorkflowDependencies {
  readonly request: string;
  readonly mode: DemoMode;
  readonly provider: AgentProvider;
  readonly createCatalog: (
    scope: ClassifiedAbortScope,
    recordDeadlineEvent: RecordDeadlineEvent,
  ) => Promise<DataHubCatalog>;
  readonly runsRoot: string;
  readonly runId: string;
  readonly parentRunId?: string;
  readonly clock: () => Date;
  readonly signal: AbortSignal;
  readonly secrets: readonly string[];
  readonly onEvent?: (event: WorkflowEvent) => void;
}

export interface RunAgentWorkflowFromContextDependencies {
  readonly request: string;
  readonly context: ChangeContext;
  readonly mode: DemoMode;
  readonly provider: AgentProvider;
  readonly runsRoot: string;
  readonly runId: string;
  readonly parentRunId: string;
  readonly datahubMetadata: DataHubRunMetadata;
  readonly reservedChild: ReservedChildRun;
  readonly clock: () => Date;
  readonly signal: AbortSignal;
  readonly secrets: readonly string[];
  readonly onEvent?: (event: WorkflowEvent) => void;
}

interface InternalWorkflowDependencies {
  readonly request: string;
  readonly mode: DemoMode;
  readonly provider: AgentProvider;
  readonly runsRoot: string;
  readonly runId: string;
  readonly parentRunId?: string;
  readonly clock: () => Date;
  readonly signal: AbortSignal;
  readonly secrets: readonly string[];
  readonly onEvent?: (event: WorkflowEvent) => void;
  readonly createCatalog?: (
    scope: ClassifiedAbortScope,
    recordDeadlineEvent: RecordDeadlineEvent,
  ) => Promise<DataHubCatalog>;
  readonly initialContext?: ChangeContext;
  readonly initialDataHubMetadata?: DataHubRunMetadata;
  readonly reservedChild?: ReservedChildRun;
}

const allowedDataHubTools = [
  "search",
  "list_schema_fields",
  "get_lineage",
  "get_entities",
] as const;

const workflowFailureMessages = {
  DATAHUB_UNAVAILABLE: "DataHub analysis is unavailable.",
  MCP_UNAVAILABLE: "The DataHub MCP integration is unavailable.",
  TARGET_NOT_FOUND: "The requested dataset was not found.",
  COLUMN_NOT_FOUND: "The requested source column was not found.",
  ANALYSIS_FAILED: "Deterministic impact analysis failed.",
  ARTIFACT_WRITE_FAILED: "The analyzed run could not be persisted.",
} as const satisfies Readonly<
  Record<Extract<AnalyzeRenameResult, { kind: "failed" }>["code"], string>
>;

function fixedWorkflowFailureMessage(
  code: Extract<AnalyzeRenameResult, { kind: "failed" }>["code"],
): string {
  return workflowFailureMessages[code];
}

type ClassifiedWorkflowFailure = {
  readonly code: "CANCELLED" | "DATAHUB_UNAVAILABLE" | "MCP_UNAVAILABLE" | "GENERATION_FAILED";
  readonly message: string;
};

function classifiedWorkflowFailure(error: unknown): ClassifiedWorkflowFailure | undefined {
  if (!(error instanceof AppError)) return undefined;
  switch (error.code) {
    case "CANCELLED":
    case "DATAHUB_UNAVAILABLE":
    case "MCP_UNAVAILABLE":
    case "GENERATION_FAILED":
      return { code: error.code, message: error.message };
    default:
      return undefined;
  }
}

function sanitizedUniqueStrings(
  value: unknown,
  secrets: readonly string[],
  maximumInspected: number,
): readonly string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .slice(0, maximumInspected)
        .filter((item): item is string => typeof item === "string")
        .map((item) => sanitizeBoundaryText(item, secrets, 500))
        .filter((item) => item.length > 0),
    ),
  ].sort(compareCanonicalText);
}

function boundClarificationCandidates(
  value: unknown,
  secrets: readonly string[],
): readonly string[] {
  return sanitizedUniqueStrings(value, secrets, 1_000).filter((item) => item.startsWith("urn:li:"));
}

function boundKnownFields(value: unknown, secrets: readonly string[]): readonly string[] {
  return sanitizedUniqueStrings(value, secrets, 1_000).slice(0, 100);
}

function sanitizeDataHubServerInfo(
  value: DataHubServerInfo,
  secrets: readonly string[],
): Pick<DataHubRunMetadata, "reportedServerName" | "reportedServerVersion"> {
  const safeOptional = (candidate: unknown): string | undefined => {
    if (typeof candidate !== "string") return undefined;
    const safe = sanitizeBoundaryText(candidate, secrets, 100);
    if (safe.length === 0 || safe.replaceAll("[REDACTED]", "").trim().length === 0) {
      return undefined;
    }
    return safe;
  };
  const reportedServerName = safeOptional(value.reportedServerName);
  const reportedServerVersion = safeOptional(value.reportedServerVersion);
  return {
    ...(reportedServerName === undefined ? {} : { reportedServerName }),
    ...(reportedServerVersion === undefined ? {} : { reportedServerVersion }),
  };
}

function summarizeValidation(
  outcome: ValidationSummary["outcome"],
  findings: readonly PackageFinding[] = [],
): ValidationSummary {
  return ValidationSummarySchema.parse({
    outcome,
    findingCount: findings.length,
    findingCodes: [...new Set(findings.map(({ code }) => code))]
      .sort(compareCanonicalText)
      .slice(0, 20),
  });
}

const invalidDraftFindings = [
  {
    code: "INVALID_DRAFT",
    message: "Migration draft did not match the required schema.",
  },
] as const satisfies readonly PackageFinding[];

function normalizeMigrationDraft(
  context: ChangeContext,
  value: unknown,
):
  | { readonly kind: "valid"; readonly draft: MigrationPackageDraft }
  | { readonly kind: "invalid"; readonly findings: readonly PackageFinding[] } {
  const parsed = MigrationPackageDraftSchema.safeParse(value);
  if (!parsed.success) return { kind: "invalid", findings: invalidDraftFindings };

  const knownEvidenceIds = new Set(context.evidence.map(({ id }) => id));
  const normalizedEvidenceIds = new Set<string>();
  let placeholderIndex = 0;
  const evidenceIds = parsed.data.evidenceIds.map((id) => {
    if (knownEvidenceIds.has(id)) {
      normalizedEvidenceIds.add(id);
      return id;
    }

    let placeholder: string;
    do {
      placeholderIndex += 1;
      placeholder = `datahub:untrusted-evidence:[REDACTED]:${placeholderIndex}`;
    } while (knownEvidenceIds.has(placeholder) || normalizedEvidenceIds.has(placeholder));
    normalizedEvidenceIds.add(placeholder);
    return placeholder;
  });
  const normalized = MigrationPackageDraftSchema.safeParse({
    ...parsed.data,
    evidenceIds,
  });
  return normalized.success
    ? { kind: "valid", draft: normalized.data }
    : { kind: "invalid", findings: invalidDraftFindings };
}

function previewCompletion(input: {
  readonly currentStatus: WorkflowStatus;
  readonly activity: readonly ActivityEntry[];
  readonly startedAt: ReadonlyMap<WorkflowStatus, number>;
  readonly completedAt: Date;
  readonly label: string;
}): {
  readonly status: "COMPLETED";
  readonly activity: readonly ActivityEntry[];
  readonly completedEntry: ActivityEntry;
} {
  const status = transitionWorkflow(input.currentStatus, "COMPLETED") as "COMPLETED";
  const activity = input.activity.map((entry) => ({ ...entry }));
  const previous = activity.at(-1);
  if (previous?.outcome === "started") {
    activity[activity.length - 1] = {
      ...previous,
      outcome: "succeeded",
      durationMs: Math.max(
        0,
        input.completedAt.getTime() -
          (input.startedAt.get(previous.status) ?? input.completedAt.getTime()),
      ),
    };
  }
  const completedEntry: ActivityEntry = {
    at: input.completedAt.toISOString(),
    status,
    label: input.label,
    outcome: "succeeded",
  };
  activity.push(completedEntry);
  return { status, activity, completedEntry };
}

function terminalSnapshot(
  deps: InternalWorkflowDependencies & {
    readonly getVerifiedDataHubMetadata: () => DataHubRunMetadata | undefined;
  },
  status: WorkflowStatus,
  activity: readonly ActivityEntry[],
  context: ChangeContext | undefined,
  provider: AgentProviderResult,
  validation: ValidationSummary,
  deadlineEvents: readonly NonNullable<WorkflowSnapshot["deadlineEvents"]>[number][],
  executionClassification?: "EXECUTABLE_WITH_REVIEW" | "ADVISORY_ONLY" | "NON_EXECUTABLE_TEMPLATE",
): WorkflowSnapshot {
  const failureCode =
    status === "COMPLETED" ? undefined : WorkflowFailureSchema.shape.code.parse(status);
  const safeContext = context === undefined ? undefined : ChangeContextSchema.parse(context);
  const safeMessage = sanitizeBoundaryText(
    provider.message ?? "The workflow did not complete.",
    deps.secrets,
    500,
  );
  const safeCandidates =
    failureCode === "NEEDS_USER_CLARIFICATION"
      ? boundClarificationCandidates(provider.candidates, deps.secrets).slice(0, 20)
      : undefined;
  const safeKnownFields =
    failureCode === "COLUMN_NOT_FOUND"
      ? boundKnownFields(provider.failure?.knownFields, deps.secrets)
      : undefined;
  const verifiedDataHubMetadata = deps.getVerifiedDataHubMetadata();
  return WorkflowSnapshotSchema.parse({
    runId: deps.runId,
    mode: deps.mode,
    status,
    ...(verifiedDataHubMetadata === undefined ? {} : { datahub: verifiedDataHubMetadata }),
    ...(deps.parentRunId === undefined ? {} : { parentRunId: deps.parentRunId }),
    ...(safeContext === undefined
      ? {}
      : {
          analysisStatus: safeContext.analysisStatus,
          contextHash: safeContext.contextHash,
          evidenceCompleteness: safeContext.evidenceCompleteness,
          entityContextRetrieval: safeContext.entityContextRetrieval,
          contextCoverage: safeContext.contextCoverage,
          contextIndicators: safeContext.contextIndicators,
          impact: {
            score: safeContext.assessment.score,
            level: safeContext.assessment.level,
            confidence: safeContext.assessment.confidence,
            advisoryDecision: safeContext.advisoryDecision,
            downstreamAssets: safeContext.evidence.filter(({ kind }) => kind === "downstream")
              .length,
            columnAffectedAssets: safeContext.evidence.filter(
              ({ kind, level }) => kind === "downstream" && level === "column",
            ).length,
            evidenceLevel: safeContext.evidence.some(
              ({ kind, level }) => kind === "downstream" && level === "column",
            )
              ? "column"
              : safeContext.evidence.some(({ kind }) => kind === "downstream")
                ? "table"
                : "none",
            factors: safeContext.assessment.factors,
          },
        }),
    activity,
    evidence: safeContext?.evidence ?? [],
    facts: safeContext?.facts ?? [],
    assumptions: safeContext?.assumptions ?? [],
    unknowns: safeContext?.unknowns ?? [],
    ...(safeContext === undefined ? {} : { narrativeSummary: safeContext.narrativeSummary }),
    ...(executionClassification === undefined ? {} : { executionClassification }),
    deadlinePolicy: {
      mcpConnectMs: DEADLINES_MS.mcpConnect,
      datahubAnalysisMs: DEADLINES_MS.datahubAnalysis,
      analysisToolMs: DEADLINES_MS.analysisTool,
      generationToolMs: DEADLINES_MS.generationTool,
      agentMs: DEADLINES_MS.agent,
      workflowMs: DEADLINES_MS.workflow,
    },
    deadlineEvents,
    agent: {
      provider: provider.provider,
      model: sanitizeBoundaryText(provider.model, deps.secrets, 100),
      reasoningEffort: provider.reasoningEffort,
      promptVersion:
        provider.provider === "openai" ? MIGRATION_AGENT_PROMPT_VERSION : "fixture-replay-v1",
      schemaVersion: "1",
      generationAttempts: provider.generationAttempts,
      toolCalls: [
        {
          name: "analyze_rename_change",
          calls: provider.analysisCalls,
          outcome:
            provider.analysisCalls === 0
              ? "not_called"
              : provider.status === "needs_clarification"
                ? "clarification"
                : safeContext === undefined
                  ? "failed"
                  : "accepted",
        },
        {
          name: "generate_migration_package",
          calls: provider.generationAttempts,
          outcome:
            provider.generationAttempts === 0
              ? "not_called"
              : status === "COMPLETED"
                ? "accepted"
                : "failed",
        },
      ],
      ...(provider.latencyMs === undefined ? {} : { latencyMs: provider.latencyMs }),
      ...(provider.usage === undefined ? {} : { usage: provider.usage }),
    },
    validation,
    artifacts: [],
    ...(failureCode === undefined
      ? {}
      : {
          failure: {
            code: failureCode,
            message: safeMessage.length === 0 ? "The workflow did not complete." : safeMessage,
            ...(safeCandidates === undefined ? {} : { candidates: safeCandidates }),
            ...(safeCandidates === undefined || provider.omittedCandidateCount === undefined
              ? {}
              : { omittedCandidateCount: provider.omittedCandidateCount }),
            ...(safeKnownFields === undefined ? {} : { knownFields: safeKnownFields }),
          },
        }),
  });
}

function emit(deps: InternalWorkflowDependencies, event: WorkflowEvent): void {
  try {
    deps.onEvent?.(event);
  } catch {
    // Run persistence is authoritative when a response consumer disconnects.
  }
}

async function executeWorkflow(inputDeps: InternalWorkflowDependencies): Promise<WorkflowSnapshot> {
  const safeRequest = RunRequestSchema.shape.request.parse(
    sanitizeBoundaryText(inputDeps.request, inputDeps.secrets, 500),
  );
  const deadlineEvents = createDeadlineEventRecorder();
  const requestScope = createRequestAbortScope(inputDeps.signal);
  const workflowScope = createDeadline(requestScope, DEADLINES_MS.workflow, "WORKFLOW_TIMEOUT");
  const agentScope = createDeadline(workflowScope, DEADLINES_MS.agent, "AGENT_TIMEOUT");
  let agentFinalized = false;
  let workflowFinalized = false;
  const deadlineOutcome = (
    scope: ClassifiedAbortScope,
    ownKind: "AGENT_TIMEOUT" | "WORKFLOW_TIMEOUT",
  ): "completed" | "expired" | "cancelled" => {
    if (!scope.signal.aborted) return "completed";
    return scope.classifyAbort().owner === ownKind ? "expired" : "cancelled";
  };
  const finalizeAgent = (): void => {
    if (agentFinalized) return;
    deadlineEvents.record({
      kind: "AGENT_TIMEOUT",
      durationMs: DEADLINES_MS.agent,
      attempt: 1,
      outcome: deadlineOutcome(agentScope, "AGENT_TIMEOUT"),
    });
    agentFinalized = true;
    agentScope.dispose();
  };
  const finalizeWorkflow = (): void => {
    if (workflowFinalized) return;
    deadlineEvents.record({
      kind: "WORKFLOW_TIMEOUT",
      durationMs: DEADLINES_MS.workflow,
      attempt: 1,
      outcome: deadlineOutcome(workflowScope, "WORKFLOW_TIMEOUT"),
    });
    workflowFinalized = true;
    workflowScope.dispose();
    requestScope.dispose();
  };
  const throwIfScopeAborted = (scope: ClassifiedAbortScope): void => {
    if (scope.signal.aborted) throw scope.classifyAbort().error;
  };
  let verifiedDataHubMetadata = inputDeps.initialDataHubMetadata;
  const deps = {
    ...inputDeps,
    request: safeRequest,
    getVerifiedDataHubMetadata: () => verifiedDataHubMetadata,
  };
  let status: WorkflowStatus = "DRAFT";
  const activity: ActivityEntry[] = [];
  const startedAt = new Map<WorkflowStatus, number>();
  let context =
    inputDeps.initialContext === undefined
      ? undefined
      : ChangeContextSchema.parse(inputDeps.initialContext);
  let analysisOutcome: AnalyzeRenameResult | undefined;
  let applicationAnalysisCalls = 0;
  let applicationGenerationAttempts = 0;
  let accepted: { draft: MigrationPackageDraft; rendered: RenderedMigrationPackage } | undefined;
  let lastRejected:
    | { readonly draft?: MigrationPackageDraft; readonly findings: readonly PackageFinding[] }
    | undefined;

  const move = (next: WorkflowStatus, label: string, outcome: ActivityEntry["outcome"]): void => {
    const now = deps.clock();
    const previous = activity.at(-1);
    if (previous?.outcome === "started") {
      activity[activity.length - 1] = {
        ...previous,
        outcome: outcome === "failed" ? "failed" : "succeeded",
        durationMs: Math.max(0, now.getTime() - (startedAt.get(previous.status) ?? now.getTime())),
      };
    }
    status = transitionWorkflow(status, next);
    if (outcome === "started") startedAt.set(status, now.getTime());
    const safeLabel = sanitizeBoundaryText(label, deps.secrets, 120);
    const entry: ActivityEntry = {
      at: now.toISOString(),
      status,
      label: safeLabel.length === 0 ? "Workflow update" : safeLabel,
      outcome,
    };
    activity.push(entry);
    emit(deps, { type: "activity", entry });
  };

  try {
    if (context === undefined) {
      move("RESOLVING_CONTEXT", "Resolve the requested dataset and column", "started");
    } else {
      move("GENERATING_ARTIFACTS", "Generate a grounded migration strategy", "started");
    }

    const tools: AgentToolset = {
      analyzeRenameChange: async () => {
        if (applicationAnalysisCalls >= 1) {
          return {
            kind: "failed",
            code: "ANALYSIS_FAILED",
            message: "Analysis may be called only once per run.",
          };
        }
        applicationAnalysisCalls += 1;
        if (context !== undefined) {
          analysisOutcome = { kind: "ready", context };
          return analysisOutcome;
        }
        move("ANALYZING_IMPACT", "Analyze two-hop DataHub impact", "started");
        const datahubScope = createDeadline(
          agentScope,
          DEADLINES_MS.datahubAnalysis,
          "DATAHUB_ANALYSIS_TIMEOUT",
        );
        try {
          if (deps.createCatalog === undefined) {
            throw new Error("Catalog creation is unavailable.");
          }
          const catalog = await deps.createCatalog(datahubScope, deadlineEvents.record);
          if (datahubScope.signal.aborted) {
            await catalog.close().catch(() => undefined);
            throw datahubScope.classifyAbort().error;
          }
          let serverInfo: DataHubServerInfo;
          try {
            serverInfo = catalog.getServerInfo();
            throwIfScopeAborted(datahubScope);
          } catch (error) {
            await catalog.close().catch(() => undefined);
            throw error;
          }
          verifiedDataHubMetadata = DataHubRunMetadataSchema.parse({
            source: deps.mode === "LIVE" ? "mcp" : "fixture",
            verification: deps.mode === "LIVE" ? "CAPABILITY_GATE_PASSED" : "REPLAY_FIXTURE",
            configuredMcpPackage: "mcp-server-datahub@0.6.0",
            allowedTools: allowedDataHubTools,
            ...sanitizeDataHubServerInfo(serverInfo, deps.secrets),
          });
          const report = await analyzeImpact({
            request: deps.request,
            catalog,
            clock: deps.clock,
            runId: deps.runId,
            runsRoot: deps.runsRoot,
            signal: datahubScope.signal,
            secrets: deps.secrets,
          });
          throwIfScopeAborted(datahubScope);
          context = buildChangeContext(report, deps.secrets);
          throwIfScopeAborted(datahubScope);
          move("GENERATING_ARTIFACTS", "Generate a grounded migration strategy", "started");
          analysisOutcome = { kind: "ready", context };
          return analysisOutcome;
        } catch (error) {
          if (datahubScope.signal.aborted) throw datahubScope.classifyAbort().error;
          if (error instanceof AppError && error.code === "NEEDS_USER_CLARIFICATION") {
            const allCandidates = boundClarificationCandidates(
              error.details.candidates,
              deps.secrets,
            );
            if (allCandidates.length === 0) {
              analysisOutcome = {
                kind: "failed",
                code: "ANALYSIS_FAILED",
                message: "Dataset clarification could not be prepared.",
              };
              return analysisOutcome;
            }
            analysisOutcome = {
              kind: "clarification",
              candidates: allCandidates.slice(0, 20),
              ...(allCandidates.length <= 20
                ? {}
                : { omittedCandidateCount: allCandidates.length - 20 }),
            };
            return analysisOutcome;
          }
          if (error instanceof ImpactReportPersistenceError) {
            context = buildChangeContext(error.report, deps.secrets);
            analysisOutcome = {
              kind: "failed",
              code: "ARTIFACT_WRITE_FAILED",
              message: "The impact report could not be persisted.",
            };
            return analysisOutcome;
          }
          if (error instanceof AppError) {
            const code =
              error.code === "DATAHUB_UNAVAILABLE" ||
              error.code === "MCP_UNAVAILABLE" ||
              error.code === "TARGET_NOT_FOUND" ||
              error.code === "COLUMN_NOT_FOUND" ||
              error.code === "ARTIFACT_WRITE_FAILED"
                ? error.code
                : "ANALYSIS_FAILED";
            const knownFields =
              code === "COLUMN_NOT_FOUND"
                ? boundKnownFields(error.details.knownFields, deps.secrets)
                : undefined;
            analysisOutcome = {
              kind: "failed",
              code,
              message: fixedWorkflowFailureMessage(code),
              ...(knownFields === undefined ? {} : { knownFields }),
            };
            return analysisOutcome;
          }
          analysisOutcome = {
            kind: "failed",
            code: "ANALYSIS_FAILED",
            message: fixedWorkflowFailureMessage("ANALYSIS_FAILED"),
          };
          return analysisOutcome;
        } finally {
          deadlineEvents.record({
            kind: "DATAHUB_ANALYSIS_TIMEOUT",
            durationMs: DEADLINES_MS.datahubAnalysis,
            attempt: 1,
            outcome: datahubScope.signal.aborted
              ? datahubScope.classifyAbort().owner === "DATAHUB_ANALYSIS_TIMEOUT"
                ? "expired"
                : "cancelled"
              : "completed",
          });
          datahubScope.dispose();
        }
      },
      generateMigrationPackage: async (draft, signal) => {
        signal.throwIfAborted();
        if (analysisOutcome?.kind !== "ready" || context === undefined) {
          return {
            kind: "rejected",
            findings: [{ code: "MISSING_CONTEXT", message: "Analyze the request first." }],
          };
        }
        if (accepted !== undefined) {
          return {
            kind: "rejected",
            findings: [
              { code: "ATTEMPT_AFTER_ACCEPTED", message: "A package was already accepted." },
            ],
          };
        }
        if (applicationGenerationAttempts >= 2) {
          return {
            kind: "rejected",
            findings: [{ code: "ATTEMPT_LIMIT", message: "Generation attempt limit reached." }],
          };
        }
        applicationGenerationAttempts += 1;
        move("VALIDATING_ARTIFACTS", "Validate grounding, SQL, rollback, and paths", "started");
        signal.throwIfAborted();
        const normalized = normalizeMigrationDraft(context, draft);
        signal.throwIfAborted();
        if (normalized.kind === "invalid") {
          lastRejected = { findings: normalized.findings };
          move("GENERATING_ARTIFACTS", "Repair the rejected structured draft", "started");
          return { kind: "rejected", findings: normalized.findings };
        }
        const safeDraft = normalized.draft;
        const draftFindings = validateMigrationDraft(context, safeDraft);
        signal.throwIfAborted();
        const rendered = renderMigrationPackage(context, safeDraft);
        signal.throwIfAborted();
        const findings = sanitizeValidationFindings(
          [...draftFindings, ...validatePackage(context, safeDraft, rendered)],
          deps.secrets,
        ).slice(0, 200);
        signal.throwIfAborted();
        if (findings.length > 0) {
          lastRejected = { draft: safeDraft, findings };
          move("GENERATING_ARTIFACTS", "Repair the rejected structured draft", "started");
          return { kind: "rejected", findings };
        }
        signal.throwIfAborted();
        lastRejected = undefined;
        accepted = { draft: safeDraft, rendered };
        return { kind: "accepted", classification: rendered.classification };
      },
    };

    const reportedProviderResult = await deps.provider.run({
      request: deps.request,
      tools,
      signal: agentScope.signal,
      abortScope: agentScope,
      recordDeadlineEvent: deadlineEvents.record,
    });
    throwIfScopeAborted(agentScope);
    finalizeAgent();
    const providerResult: AgentProviderResult = {
      ...reportedProviderResult,
      ...deps.provider.identity,
      analysisCalls: applicationAnalysisCalls,
      generationAttempts: applicationGenerationAttempts,
    };

    if (analysisOutcome?.kind === "clarification") {
      move("NEEDS_USER_CLARIFICATION", "Select one exact DataHub dataset", "waiting");
      finalizeWorkflow();
      const authoritativeProvider: AgentProviderResult = {
        ...providerResult,
        status: "needs_clarification",
        candidates: analysisOutcome.candidates,
        ...(analysisOutcome.omittedCandidateCount === undefined
          ? {}
          : { omittedCandidateCount: analysisOutcome.omittedCandidateCount }),
        message:
          analysisOutcome.omittedCandidateCount === undefined
            ? "Multiple exact DataHub datasets matched. Select one candidate."
            : `Multiple exact DataHub datasets matched. Select one of the listed candidates; ${analysisOutcome.omittedCandidateCount} additional candidates were omitted.`,
      };
      const snapshot = terminalSnapshot(
        deps,
        status,
        activity,
        context,
        authoritativeProvider,
        summarizeValidation("NOT_RUN"),
        deadlineEvents.snapshot(),
      );
      await persistFailedRun({
        runsRoot: deps.runsRoot,
        runId: deps.runId,
        secrets: deps.secrets,
        snapshot,
        ...(context === undefined ? {} : { context }),
        ...(deps.reservedChild === undefined ? {} : { reservedChild: deps.reservedChild }),
      });
      emit(deps, { type: "snapshot", snapshot });
      return snapshot;
    }

    if (analysisOutcome?.kind === "failed") {
      move(analysisOutcome.code, analysisOutcome.message, "failed");
      finalizeWorkflow();
      const authoritativeProvider: AgentProviderResult = {
        ...providerResult,
        status: "failed",
        message: analysisOutcome.message,
        failure: {
          code: analysisOutcome.code,
          message: analysisOutcome.message,
          ...(analysisOutcome.knownFields === undefined
            ? {}
            : { knownFields: analysisOutcome.knownFields }),
        },
      };
      const snapshot = terminalSnapshot(
        deps,
        status,
        activity,
        context,
        authoritativeProvider,
        summarizeValidation("NOT_RUN"),
        deadlineEvents.snapshot(),
      );
      await persistFailedRun({
        runsRoot: deps.runsRoot,
        runId: deps.runId,
        secrets: deps.secrets,
        snapshot,
        ...(context === undefined ? {} : { context }),
        ...(deps.reservedChild === undefined ? {} : { reservedChild: deps.reservedChild }),
      });
      emit(deps, { type: "snapshot", snapshot });
      return snapshot;
    }

    if (providerResult.status !== "completed" || context === undefined || accepted === undefined) {
      const currentStatus = status as WorkflowStatus;
      const next =
        currentStatus === "ANALYZING_IMPACT" &&
        providerResult.failure?.code !== undefined &&
        providerResult.failure.code !== "GENERATION_FAILED"
          ? providerResult.failure.code
          : currentStatus === "RESOLVING_CONTEXT"
            ? "ANALYSIS_FAILED"
            : applicationGenerationAttempts >= 2 && lastRejected !== undefined
              ? "VALIDATION_FAILED"
              : "GENERATION_FAILED";
      move(next, providerResult.message ?? "Artifact generation failed", "failed");
      finalizeWorkflow();
      const snapshot = terminalSnapshot(
        deps,
        status,
        activity,
        context,
        providerResult,
        lastRejected === undefined
          ? summarizeValidation("NOT_RUN")
          : summarizeValidation("REJECTED", lastRejected.findings),
        deadlineEvents.snapshot(),
      );
      await persistFailedRun({
        runsRoot: deps.runsRoot,
        runId: deps.runId,
        secrets: deps.secrets,
        snapshot,
        ...(context === undefined ? {} : { context }),
        ...(lastRejected === undefined
          ? {}
          : {
              ...(lastRejected.draft === undefined ? {} : { draft: lastRejected.draft }),
              findings: lastRejected.findings,
            }),
        ...(deps.reservedChild === undefined ? {} : { reservedChild: deps.reservedChild }),
      });
      emit(deps, { type: "snapshot", snapshot });
      return snapshot;
    }

    const draft = accepted.draft;
    const rendered = accepted.rendered;
    const completion = previewCompletion({
      currentStatus: status,
      activity,
      startedAt,
      completedAt: deps.clock(),
      label: "Migration package validated and committed",
    });
    const completedWorkflowEvent = {
      kind: "WORKFLOW_TIMEOUT",
      durationMs: DEADLINES_MS.workflow,
      attempt: 1,
      outcome: "completed",
    } as const;
    const base = terminalSnapshot(
      deps,
      completion.status,
      completion.activity,
      context,
      providerResult,
      summarizeValidation("PASSED"),
      deadlineEvents.preview(completedWorkflowEvent),
      rendered.classification,
    );
    let snapshot: WorkflowSnapshot;
    try {
      snapshot = await persistCompletedRun({
        runsRoot: deps.runsRoot,
        runId: deps.runId,
        context,
        draft,
        rendered,
        snapshot: base,
        signal: workflowScope.signal,
        ...(deps.reservedChild === undefined ? {} : { reservedChild: deps.reservedChild }),
      });
    } catch (error) {
      if (workflowScope.signal.aborted) throw workflowScope.classifyAbort().error;
      if (!(error instanceof AppError) || error.code !== "ARTIFACT_WRITE_FAILED") throw error;
      move("ARTIFACT_WRITE_FAILED", "Validated artifacts could not be persisted", "failed");
      finalizeWorkflow();
      snapshot = terminalSnapshot(
        deps,
        status,
        activity,
        context,
        {
          ...providerResult,
          status: "failed",
          message: "Validated artifacts could not be persisted.",
        },
        summarizeValidation("PASSED"),
        deadlineEvents.snapshot(),
        rendered.classification,
      );
      await persistFailedRun({
        runsRoot: deps.runsRoot,
        runId: deps.runId,
        secrets: deps.secrets,
        snapshot,
        context,
        draft,
        findings: [],
        ...(deps.reservedChild === undefined ? {} : { reservedChild: deps.reservedChild }),
      });
      emit(deps, { type: "snapshot", snapshot });
      return snapshot;
    }
    deadlineEvents.adopt(completedWorkflowEvent);
    workflowFinalized = true;
    workflowScope.dispose();
    requestScope.dispose();
    status = completion.status;
    activity.splice(0, activity.length, ...completion.activity);
    emit(deps, { type: "activity", entry: completion.completedEntry });
    emit(deps, { type: "snapshot", snapshot });
    return snapshot;
  } catch (error) {
    const classifiedFailure = agentScope.signal.aborted
      ? classifiedWorkflowFailure(agentScope.classifyAbort().error)
      : workflowScope.signal.aborted
        ? classifiedWorkflowFailure(workflowScope.classifyAbort().error)
        : classifiedWorkflowFailure(error);
    if (classifiedFailure !== undefined) {
      if (!isTerminalWorkflowStatus(status)) {
        move(classifiedFailure.code, classifiedFailure.message, "failed");
      }
      finalizeAgent();
      finalizeWorkflow();
      const fallbackProvider: AgentProviderResult = {
        status: "failed",
        ...deps.provider.identity,
        analysisCalls: applicationAnalysisCalls,
        generationAttempts: applicationGenerationAttempts,
        message: classifiedFailure.message,
        ...(classifiedFailure.code === "CANCELLED"
          ? {}
          : {
              failure: {
                code: classifiedFailure.code,
                message: classifiedFailure.message,
              },
            }),
      };
      const snapshot = terminalSnapshot(
        deps,
        status,
        activity,
        context,
        fallbackProvider,
        accepted !== undefined
          ? summarizeValidation("PASSED")
          : lastRejected === undefined
            ? summarizeValidation("NOT_RUN")
            : summarizeValidation("REJECTED", lastRejected.findings),
        deadlineEvents.snapshot(),
      );
      await persistFailedRun({
        runsRoot: deps.runsRoot,
        runId: deps.runId,
        secrets: deps.secrets,
        snapshot,
        ...(context === undefined ? {} : { context }),
        ...(accepted !== undefined
          ? { draft: accepted.draft, findings: [] }
          : lastRejected === undefined
            ? {}
            : {
                ...(lastRejected.draft === undefined ? {} : { draft: lastRejected.draft }),
                findings: lastRejected.findings,
              }),
        ...(deps.reservedChild === undefined ? {} : { reservedChild: deps.reservedChild }),
      });
      emit(deps, { type: "snapshot", snapshot });
      return snapshot;
    }
    agentScope.dispose();
    workflowScope.dispose();
    requestScope.dispose();
    throw error;
  }
}

export async function runAgentWorkflow(
  inputDeps: RunAgentWorkflowDependencies,
): Promise<WorkflowSnapshot> {
  return executeWorkflow(inputDeps);
}

export async function runAgentWorkflowFromContext(
  inputDeps: RunAgentWorkflowFromContextDependencies,
): Promise<WorkflowSnapshot> {
  return executeWorkflow({
    ...inputDeps,
    initialContext: ChangeContextSchema.parse(inputDeps.context),
    initialDataHubMetadata: DataHubRunMetadataSchema.parse(inputDeps.datahubMetadata),
  });
}
