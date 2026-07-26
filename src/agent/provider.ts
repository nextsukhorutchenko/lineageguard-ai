import type { PackageFinding } from "../migrations/validate-sql.js";
import type { RecordDeadlineEvent } from "../runtime/deadline-events.js";
import type { ClassifiedAbortScope } from "../runtime/deadlines.js";
import type { ChangeContext } from "../workflow/change-context.js";
import type {
  ExecutionClassification,
  MigrationPackageDraft,
} from "../workflow/migration-draft.js";

export type AnalyzeRenameResult =
  | { readonly kind: "ready"; readonly context: ChangeContext }
  | {
      readonly kind: "clarification";
      readonly candidates: readonly string[];
      readonly omittedCandidateCount?: number;
    }
  | {
      readonly kind: "failed";
      readonly code:
        | "DATAHUB_UNAVAILABLE"
        | "MCP_UNAVAILABLE"
        | "TARGET_NOT_FOUND"
        | "COLUMN_NOT_FOUND"
        | "ANALYSIS_FAILED"
        | "ARTIFACT_WRITE_FAILED";
      readonly message: string;
      readonly knownFields?: readonly string[];
    };

export type GeneratePackageResult =
  | { readonly kind: "accepted"; readonly classification: ExecutionClassification }
  | { readonly kind: "rejected"; readonly findings: readonly PackageFinding[] };

export interface AgentToolset {
  readonly analyzeRenameChange: (
    input: { readonly request: string },
    signal: AbortSignal,
  ) => Promise<AnalyzeRenameResult>;
  readonly generateMigrationPackage: (
    draft: MigrationPackageDraft,
    signal: AbortSignal,
  ) => Promise<GeneratePackageResult>;
}

export interface AgentProviderResult {
  readonly status: "completed" | "needs_clarification" | "failed";
  readonly provider: "openai" | "fixture";
  readonly model: string;
  readonly reasoningEffort: "medium" | "none";
  readonly analysisCalls: number;
  readonly generationAttempts: number;
  readonly latencyMs?: number;
  readonly candidates?: readonly string[];
  readonly omittedCandidateCount?: number;
  readonly message?: string;
  readonly failure?: {
    readonly code:
      | "DATAHUB_UNAVAILABLE"
      | "MCP_UNAVAILABLE"
      | "TARGET_NOT_FOUND"
      | "COLUMN_NOT_FOUND"
      | "ANALYSIS_FAILED"
      | "ARTIFACT_WRITE_FAILED"
      | "GENERATION_FAILED";
    readonly message: string;
    readonly knownFields?: readonly string[];
  };
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
  };
}

export type AgentProviderIdentity = Readonly<
  Pick<AgentProviderResult, "provider" | "model" | "reasoningEffort">
>;

export const fixtureAgentProviderIdentity: AgentProviderIdentity = Object.freeze({
  provider: "fixture",
  model: "replay-v1",
  reasoningEffort: "none",
});

export function createOpenAIAgentProviderIdentity(model: string): AgentProviderIdentity {
  return Object.freeze({
    provider: "openai",
    model,
    reasoningEffort: "medium",
  });
}

export interface AgentProvider {
  readonly identity: AgentProviderIdentity;
  run(input: {
    readonly request: string;
    readonly tools: AgentToolset;
    readonly signal: AbortSignal;
    readonly abortScope: ClassifiedAbortScope;
    readonly recordDeadlineEvent: RecordDeadlineEvent;
  }): Promise<AgentProviderResult>;
}
