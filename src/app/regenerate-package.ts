import type { AgentProvider } from "../agent/provider.js";
import { AppError } from "../errors/app-error.js";
import { loadRegenerationContext, reserveGenerationRetry } from "../runs/run-store.js";
import type { DemoMode, WorkflowEvent, WorkflowSnapshot } from "../workflow/contracts.js";
import { runAgentWorkflowFromContext } from "./run-agent-workflow.js";

export async function regeneratePackage(input: {
  readonly parentRunId: string;
  readonly runId: string;
  readonly runsRoot: string;
  readonly mode: DemoMode;
  readonly provider: AgentProvider;
  readonly signal: AbortSignal;
  readonly clock: () => Date;
  readonly secrets: readonly string[];
  readonly onEvent?: (event: WorkflowEvent) => void;
}): Promise<WorkflowSnapshot> {
  if (input.parentRunId === input.runId) {
    throw new AppError("INVALID_REQUEST", "Regeneration requires a fresh run ID.");
  }
  const { snapshot: parent, context } = await loadRegenerationContext({
    runsRoot: input.runsRoot,
    runId: input.parentRunId,
    expectedMode: input.mode,
  });
  if (
    parent.mode !== input.mode ||
    parent.parentRunId !== undefined ||
    parent.datahub === undefined
  ) {
    throw new AppError("INVALID_REQUEST", "The parent run cannot be regenerated.");
  }
  const reservedChild = await reserveGenerationRetry({
    runsRoot: input.runsRoot,
    parentRunId: input.parentRunId,
    childRunId: input.runId,
    signal: input.signal,
  });
  return runAgentWorkflowFromContext({
    ...input,
    context,
    request: context.request,
    parentRunId: input.parentRunId,
    datahubMetadata: parent.datahub,
    reservedChild,
  });
}
