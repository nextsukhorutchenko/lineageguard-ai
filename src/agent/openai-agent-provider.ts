import { Agent, OpenAIProvider, Runner, tool } from "@openai/agents";
import { z } from "zod";
import { AppError } from "../errors/app-error.js";
import type { RecordDeadlineEvent } from "../runtime/deadline-events.js";
import { createDeadline, DEADLINES_MS, type ClassifiedAbortScope } from "../runtime/deadlines.js";
import { MigrationPackageDraftSchema } from "../workflow/migration-draft.js";
import { MIGRATION_AGENT_PROMPT_VERSION, migrationAgentInstructions } from "./prompt.js";
import type {
  AgentProvider,
  AgentProviderIdentity,
  AgentProviderResult,
  AgentToolset,
  AnalyzeRenameResult,
} from "./provider.js";
import { createOpenAIAgentProviderIdentity } from "./provider.js";

const CompletionSchema = z
  .object({
    status: z.enum(["completed", "needs_clarification", "failed"]),
    candidates: z.array(z.string().startsWith("urn:li:").max(500)).min(1).max(20).nullish(),
    failure: z
      .object({
        code: z.enum([
          "DATAHUB_UNAVAILABLE",
          "MCP_UNAVAILABLE",
          "TARGET_NOT_FOUND",
          "COLUMN_NOT_FOUND",
          "ANALYSIS_FAILED",
          "ARTIFACT_WRITE_FAILED",
          "GENERATION_FAILED",
        ]),
        message: z.string().min(1).max(500),
        knownFields: z.array(z.string().min(1).max(500)).max(100).optional(),
      })
      .strict()
      .nullish(),
  })
  .strict()
  .superRefine((completion, ctx) => {
    const candidatesAbsent = completion.candidates == null;
    const failureAbsent = completion.failure == null;
    const valid =
      (completion.status === "completed" && candidatesAbsent && failureAbsent) ||
      (completion.status === "needs_clarification" && !candidatesAbsent && failureAbsent) ||
      (completion.status === "failed" && candidatesAbsent && !failureAbsent);
    if (!valid) {
      ctx.addIssue({
        code: "custom",
        message: "Completion fields do not match the closed status contract.",
      });
    }
  });

export interface OpenAIAgentProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly runner?: Runner;
}

interface ExecutionState {
  analysisCalls: number;
  generationAttempts: number;
  accepted: boolean;
  analysisResult?: AnalyzeRenameResult;
}

const toolDeadlinePolicy = {
  analysisSdkTimeoutMs: DEADLINES_MS.analysisTool,
  generationApplicationDeadlineMs: DEADLINES_MS.generationTool,
  generationSdkTimeoutMs: undefined,
} as const;

export class OpenAIAgentProvider implements AgentProvider {
  readonly identity: AgentProviderIdentity;
  readonly #model: string;
  readonly #runner: Runner;

  constructor(options: OpenAIAgentProviderOptions) {
    if (options.apiKey.trim().length === 0) {
      throw new Error("OpenAI configuration is missing.");
    }
    this.#model = options.model ?? "gpt-5.6-sol";
    this.identity = createOpenAIAgentProviderIdentity(this.#model);
    this.#runner =
      options.runner ??
      new Runner({
        modelProvider: new OpenAIProvider({ apiKey: options.apiKey }),
        tracingDisabled: true,
        traceIncludeSensitiveData: false,
        workflowName: "LineageGuard migration package",
      });
  }

  async run(input: Parameters<AgentProvider["run"]>[0]): Promise<AgentProviderResult> {
    const startedAt = performance.now();
    const execution: ExecutionState = {
      analysisCalls: 0,
      generationAttempts: 0,
      accepted: false,
    };
    const signal = input.abortScope.signal;
    const tools = this.createTools(
      input.tools,
      input.abortScope,
      input.recordDeadlineEvent,
      execution,
    );
    const agent = new Agent({
      name: "LineageGuard migration planner",
      instructions: migrationAgentInstructions,
      model: this.#model,
      modelSettings: {
        parallelToolCalls: false,
        reasoning: { effort: "medium" },
        store: false,
      },
      outputType: CompletionSchema,
      tools,
    });
    const attempt = await (async () => {
      try {
        const result = await this.#runner.run(agent, input.request, {
          maxTurns: 8,
          signal,
          toolExecution: { maxFunctionToolConcurrency: 1 },
        });
        signal.throwIfAborted();
        return {
          kind: "result" as const,
          result,
          output: CompletionSchema.parse(result.finalOutput),
        };
      } catch (error) {
        if (input.abortScope.signal.aborted) {
          throw input.abortScope.classifyAbort().error;
        }
        if (error instanceof AppError) throw error;
        return {
          kind: "generation_failure" as const,
          message: "OpenAI generation failed.",
        };
      }
    })();
    const usage = attempt.kind === "result" ? attempt.result.state.usage : undefined;
    const metadata = {
      provider: "openai" as const,
      model: this.#model,
      reasoningEffort: "medium" as const,
      analysisCalls: execution.analysisCalls,
      generationAttempts: execution.generationAttempts,
      latencyMs: Math.round(performance.now() - startedAt),
      ...(usage === undefined
        ? {}
        : {
            usage: {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.totalTokens,
            },
          }),
    };
    if (execution.analysisResult?.kind === "failed") {
      return {
        ...metadata,
        status: "failed",
        message: execution.analysisResult.message,
        failure: execution.analysisResult,
      };
    }
    if (execution.analysisResult?.kind === "clarification") {
      return {
        ...metadata,
        status: "needs_clarification",
        candidates: execution.analysisResult.candidates,
        ...(execution.analysisResult.omittedCandidateCount === undefined
          ? {}
          : { omittedCandidateCount: execution.analysisResult.omittedCandidateCount }),
      };
    }
    if (attempt.kind === "generation_failure") {
      return {
        ...metadata,
        status: "failed",
        message: attempt.message,
        failure: { code: "GENERATION_FAILED", message: attempt.message },
      };
    }
    if (execution.analysisResult?.kind !== "ready") {
      const message = "The agent did not complete deterministic analysis.";
      return {
        ...metadata,
        status: "failed",
        message,
        failure: {
          code: "ANALYSIS_FAILED",
          message,
        },
      };
    }
    if (attempt.output.status !== "completed" || !execution.accepted) {
      const message = "The agent did not produce an accepted migration package.";
      return {
        ...metadata,
        status: "failed",
        message,
        failure: { code: "GENERATION_FAILED", message },
      };
    }
    return { ...metadata, status: "completed" };
  }

  private createTools(
    tools: AgentToolset,
    abortScope: ClassifiedAbortScope,
    recordDeadlineEvent: RecordDeadlineEvent,
    execution: ExecutionState,
  ) {
    const signal = abortScope.signal;
    return [
      tool({
        name: "analyze_rename_change",
        description: "Resolve and deterministically analyze the one supported rename request.",
        parameters: z.object({ request: z.string().min(1).max(500) }).strict(),
        timeoutMs: toolDeadlinePolicy.analysisSdkTimeoutMs,
        timeoutBehavior: "raise_exception",
        execute: async ({ request }) => {
          signal.throwIfAborted();
          if (execution.analysisCalls >= 1) {
            return {
              kind: "failed" as const,
              code: "ANALYSIS_FAILED" as const,
              message: "Analysis may be called only once per run.",
            };
          }
          execution.analysisCalls += 1;
          const result = await tools.analyzeRenameChange({ request }, signal);
          signal.throwIfAborted();
          execution.analysisResult = result;
          return result;
        },
      }),
      tool({
        name: "generate_migration_package",
        description: "Validate, render, and persist one grounded structured migration package.",
        parameters: MigrationPackageDraftSchema,
        execute: async (draft) => {
          signal.throwIfAborted();
          if (execution.analysisResult?.kind !== "ready") {
            return {
              kind: "rejected" as const,
              findings: [
                { code: "ANALYSIS_REQUIRED", message: "Complete analysis before generation." },
              ],
            };
          }
          if (execution.accepted) {
            return {
              kind: "rejected" as const,
              findings: [
                { code: "ATTEMPT_AFTER_ACCEPTED", message: "A package was already accepted." },
              ],
            };
          }
          if (execution.generationAttempts >= 2) {
            return {
              kind: "rejected" as const,
              findings: [{ code: "ATTEMPT_LIMIT", message: "Generation attempt limit reached." }],
            };
          }
          execution.generationAttempts += 1;
          const attempt = execution.generationAttempts;
          const generationScope = createDeadline(
            abortScope,
            toolDeadlinePolicy.generationApplicationDeadlineMs,
            "GENERATION_TIMEOUT",
          );
          try {
            const result = await tools.generateMigrationPackage(draft, generationScope.signal);
            generationScope.signal.throwIfAborted();
            recordDeadlineEvent({
              kind: "GENERATION_TIMEOUT",
              durationMs: toolDeadlinePolicy.generationApplicationDeadlineMs,
              attempt,
              outcome: "completed",
            });
            if (result.kind === "accepted") {
              execution.accepted = true;
            }
            return result;
          } catch (error) {
            if (generationScope.signal.aborted) {
              const classification = generationScope.classifyAbort();
              recordDeadlineEvent({
                kind: "GENERATION_TIMEOUT",
                durationMs: toolDeadlinePolicy.generationApplicationDeadlineMs,
                attempt,
                outcome: classification.owner === "GENERATION_TIMEOUT" ? "expired" : "cancelled",
              });
              throw classification.error;
            }
            recordDeadlineEvent({
              kind: "GENERATION_TIMEOUT",
              durationMs: toolDeadlinePolicy.generationApplicationDeadlineMs,
              attempt,
              outcome: "completed",
            });
            throw error;
          } finally {
            generationScope.dispose();
          }
        },
      }),
    ];
  }
}

export const openAIAgentMetadata = {
  promptVersion: MIGRATION_AGENT_PROMPT_VERSION,
  schemaVersion: "1",
} as const;
