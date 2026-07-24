import { Agent, OpenAIProvider, Runner, tool } from "@openai/agents";
import { z } from "zod";
import { MigrationPackageDraftSchema } from "../workflow/migration-draft.js";
import { MIGRATION_AGENT_PROMPT_VERSION, migrationAgentInstructions } from "./prompt.js";
import type {
  AgentProvider,
  AgentProviderResult,
  AgentToolset,
  AnalyzeRenameResult,
} from "./provider.js";

const CompletionSchema = z
  .object({
    status: z.enum(["completed", "needs_clarification", "failed"]),
    candidates: z.array(z.string().startsWith("urn:li:").max(500)).min(1).max(20).optional(),
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
      .optional(),
  })
  .strict()
  .superRefine((completion, ctx) => {
    const valid =
      (completion.status === "completed" &&
        completion.candidates === undefined &&
        completion.failure === undefined) ||
      (completion.status === "needs_clarification" &&
        completion.candidates !== undefined &&
        completion.failure === undefined) ||
      (completion.status === "failed" &&
        completion.candidates === undefined &&
        completion.failure !== undefined);
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

export class OpenAIAgentProvider implements AgentProvider {
  readonly #model: string;
  readonly #runner: Runner;

  constructor(options: OpenAIAgentProviderOptions) {
    if (options.apiKey.trim().length === 0) {
      throw new Error("OpenAI configuration is missing.");
    }
    this.#model = options.model ?? "gpt-5.6-sol";
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
    const tools = this.createTools(input.tools, input.signal, execution);
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
    const deadline = AbortSignal.timeout(90_000);
    const signal = AbortSignal.any([input.signal, deadline]);
    const attempt = await (async () => {
      try {
        const result = await this.#runner.run(agent, input.request, {
          maxTurns: 8,
          signal,
          toolExecution: { maxFunctionToolConcurrency: 1 },
        });
        return {
          kind: "result" as const,
          result,
          output: CompletionSchema.parse(result.finalOutput),
        };
      } catch (error) {
        if (signal.aborted || input.signal.aborted) {
          throw error;
        }
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

  private createTools(tools: AgentToolset, signal: AbortSignal, execution: ExecutionState) {
    return [
      tool({
        name: "analyze_rename_change",
        description: "Resolve and deterministically analyze the one supported rename request.",
        parameters: z.object({ request: z.string().min(1).max(500) }).strict(),
        timeoutMs: 60_000,
        timeoutBehavior: "raise_exception",
        execute: async ({ request }) => {
          if (execution.analysisCalls >= 1) {
            return {
              kind: "failed" as const,
              code: "ANALYSIS_FAILED" as const,
              message: "Analysis may be called only once per run.",
            };
          }
          execution.analysisCalls += 1;
          const result = await tools.analyzeRenameChange({ request }, signal);
          execution.analysisResult = result;
          return result;
        },
      }),
      tool({
        name: "generate_migration_package",
        description: "Validate, render, and persist one grounded structured migration package.",
        parameters: MigrationPackageDraftSchema,
        execute: async (draft) => {
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
          const result = await tools.generateMigrationPackage(draft, signal);
          if (result.kind === "accepted") {
            execution.accepted = true;
          }
          return result;
        },
      }),
    ];
  }
}

export const openAIAgentMetadata = {
  promptVersion: MIGRATION_AGENT_PROMPT_VERSION,
  schemaVersion: "1",
} as const;
