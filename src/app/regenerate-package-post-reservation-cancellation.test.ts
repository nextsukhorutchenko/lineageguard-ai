import { afterEach, expect, it, vi } from "vitest";
import { fixtureAgentProviderIdentity, type AgentProvider } from "../agent/provider.js";
import { readRunEnvelope } from "../artifacts/run-envelope-files.js";
import { loadRunSnapshot } from "../runs/run-store.js";
import type { WorkflowEvent } from "../workflow/contracts.js";
import {
  cleanupWorkflowRoots,
  makeWorkflowDependencies,
} from "../../tests/helpers/workflow-dependencies.js";
import { runAgentWorkflow } from "./run-agent-workflow.js";

const reservationCancellation = vi.hoisted(() => ({
  controller: undefined as AbortController | undefined,
}));

vi.mock("../runs/run-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../runs/run-store.js")>();
  return {
    ...actual,
    reserveGenerationRetry: async (input: Parameters<typeof actual.reserveGenerationRetry>[0]) => {
      const reservation = await actual.reserveGenerationRetry(input);
      reservationCancellation.controller?.abort(new Error("private post-reservation abort"));
      return reservation;
    },
  };
});

const { regeneratePackage } = await import("./regenerate-package.js");

afterEach(async () => {
  reservationCancellation.controller = undefined;
  await cleanupWorkflowRoots();
});

it("persists one reloadable parent-linked CANCELLED child after reservation commits", async () => {
  const parentDependencies = await makeWorkflowDependencies();
  const parent = await runAgentWorkflow(parentDependencies);
  const controller = new AbortController();
  reservationCancellation.controller = controller;
  const events: WorkflowEvent[] = [];
  let providerCalls = 0;
  const provider: AgentProvider = {
    identity: fixtureAgentProviderIdentity,
    async run({ signal }) {
      providerCalls += 1;
      signal.throwIfAborted();
      throw new Error("The aborted provider must not continue.");
    },
  };

  const child = await regeneratePackage({
    parentRunId: parent.runId,
    runId: "post-reservation-cancelled-child",
    runsRoot: parentDependencies.runsRoot,
    mode: "REPLAY",
    provider,
    signal: controller.signal,
    clock: parentDependencies.clock,
    secrets: [],
    onEvent: (event) => events.push(event),
  });

  expect(providerCalls).toBe(1);
  expect(child).toMatchObject({
    runId: "post-reservation-cancelled-child",
    parentRunId: parent.runId,
    mode: "REPLAY",
    status: "CANCELLED",
    contextHash: parent.contextHash,
  });
  await expect(
    loadRunSnapshot({
      runsRoot: parentDependencies.runsRoot,
      runId: child.runId,
    }),
  ).resolves.toEqual(child);
  await expect(
    readRunEnvelope({
      runsRoot: parentDependencies.runsRoot,
      runId: child.runId,
    }),
  ).resolves.toMatchObject({
    kind: "failed",
    parentRunId: parent.runId,
    generationAttempt: 2,
    snapshot: { status: "CANCELLED" },
  });
  expect(
    events.some(
      (event) =>
        (event.type === "activity" && event.entry.status === "COMPLETED") ||
        (event.type === "snapshot" && event.snapshot.status === "COMPLETED"),
    ),
  ).toBe(false);
  await expect(
    regeneratePackage({
      parentRunId: parent.runId,
      runId: "later-child-must-not-run",
      runsRoot: parentDependencies.runsRoot,
      mode: "REPLAY",
      provider,
      signal: new AbortController().signal,
      clock: parentDependencies.clock,
      secrets: [],
    }),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    message: "The parent run cannot be regenerated.",
  });
});
