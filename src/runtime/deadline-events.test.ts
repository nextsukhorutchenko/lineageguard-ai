import { describe, expect, it } from "vitest";
import {
  DeadlineEventSchema,
  DeadlinePolicySchema,
  WorkflowSnapshotSchema,
  type WorkflowSnapshot,
} from "../workflow/contracts.js";
import { createDeadlineEventRecorder } from "./deadline-events.js";

type DeadlineEvent = NonNullable<WorkflowSnapshot["deadlineEvents"]>[number];

const events = {
  mcp: {
    kind: "MCP_CONNECT_TIMEOUT",
    durationMs: 15_000,
    attempt: 1,
    outcome: "completed",
  },
  datahub: {
    kind: "DATAHUB_ANALYSIS_TIMEOUT",
    durationMs: 55_000,
    attempt: 1,
    outcome: "completed",
  },
  generationOne: {
    kind: "GENERATION_TIMEOUT",
    durationMs: 30_000,
    attempt: 1,
    outcome: "expired",
  },
  generationTwo: {
    kind: "GENERATION_TIMEOUT",
    durationMs: 30_000,
    attempt: 2,
    outcome: "completed",
  },
  agent: {
    kind: "AGENT_TIMEOUT",
    durationMs: 90_000,
    attempt: 1,
    outcome: "completed",
  },
  workflow: {
    kind: "WORKFLOW_TIMEOUT",
    durationMs: 95_000,
    attempt: 1,
    outcome: "completed",
  },
} as const satisfies Readonly<Record<string, DeadlineEvent>>;

const exactPolicy = {
  mcpConnectMs: 15_000,
  datahubAnalysisMs: 55_000,
  analysisToolMs: 60_000,
  generationToolMs: 30_000,
  agentMs: 90_000,
  workflowMs: 95_000,
} as const;

describe("createDeadlineEventRecorder", () => {
  it("validates and sorts the six unique owner-attempt events", () => {
    const recorder = createDeadlineEventRecorder();

    recorder.record(events.workflow);
    recorder.record(events.generationTwo);
    recorder.record(events.datahub);
    recorder.record(events.agent);
    recorder.record(events.generationOne);
    recorder.record(events.mcp);

    expect(recorder.snapshot()).toEqual([
      events.mcp,
      events.datahub,
      events.generationOne,
      events.generationTwo,
      events.agent,
      events.workflow,
    ]);
    expect(Object.isFrozen(recorder.snapshot())).toBe(true);
  });

  it("rejects a duplicate owner-attempt and a seventh event", () => {
    const recorder = createDeadlineEventRecorder();
    recorder.record(events.generationOne);
    expect(() => recorder.record({ ...events.generationOne, outcome: "completed" })).toThrow(
      "Deadline event already recorded.",
    );

    const full = createDeadlineEventRecorder();
    for (const event of Object.values(events)) full.record(event);
    expect(() =>
      full.record({
        kind: "GENERATION_TIMEOUT",
        durationMs: 30_000,
        attempt: 2,
        outcome: "cancelled",
      }),
    ).toThrow();
  });

  it("previews without mutation and adopts only after publication", () => {
    const recorder = createDeadlineEventRecorder();
    recorder.record(events.agent);

    expect(recorder.preview(events.workflow)).toEqual([events.agent, events.workflow]);
    expect(recorder.snapshot()).toEqual([events.agent]);

    recorder.adopt(events.workflow);

    expect(recorder.snapshot()).toEqual([events.agent, events.workflow]);
  });
});

describe("deadline snapshot schema", () => {
  it("accepts only the exact six-value policy and all five event kinds", () => {
    expect(DeadlinePolicySchema.parse(exactPolicy)).toEqual(exactPolicy);
    for (const event of [
      events.mcp,
      events.datahub,
      events.generationOne,
      events.agent,
      events.workflow,
    ]) {
      expect(DeadlineEventSchema.parse(event)).toEqual(event);
    }
  });

  it("accepts generation attempts one and two but rejects other second attempts", () => {
    expect(DeadlineEventSchema.parse(events.generationOne).attempt).toBe(1);
    expect(DeadlineEventSchema.parse(events.generationTwo).attempt).toBe(2);
    expect(() =>
      WorkflowSnapshotSchema.parse({
        runId: "run-deadline-schema",
        mode: "REPLAY",
        status: "CANCELLED",
        activity: [],
        evidence: [],
        facts: [],
        assumptions: [],
        unknowns: [],
        deadlinePolicy: exactPolicy,
        deadlineEvents: [{ ...events.agent, attempt: 2 }],
        artifacts: [],
        failure: { code: "CANCELLED", message: "The workflow was cancelled." },
        validation: { outcome: "NOT_RUN", findingCount: 0, findingCodes: [] },
      }),
    ).toThrow("Only generation may have a second attempt.");
  });

  it("rejects duplicates, mismatched durations, and raw abort reasons", () => {
    const base = {
      runId: "run-deadline-schema",
      mode: "REPLAY",
      status: "CANCELLED",
      activity: [],
      evidence: [],
      facts: [],
      assumptions: [],
      unknowns: [],
      deadlinePolicy: exactPolicy,
      artifacts: [],
      failure: { code: "CANCELLED", message: "The workflow was cancelled." },
      validation: { outcome: "NOT_RUN", findingCount: 0, findingCodes: [] },
    } as const;

    expect(() =>
      WorkflowSnapshotSchema.parse({
        ...base,
        deadlineEvents: [events.agent, events.agent],
      }),
    ).toThrow("Deadline events must be unique by owner and attempt.");
    expect(() =>
      WorkflowSnapshotSchema.parse({
        ...base,
        deadlineEvents: [{ ...events.agent, durationMs: 1 }],
      }),
    ).toThrow("Deadline event duration must match the configured policy.");
    expect(() =>
      DeadlineEventSchema.parse({ ...events.agent, reason: "raw AbortSignal reason" }),
    ).toThrow();
  });
});
