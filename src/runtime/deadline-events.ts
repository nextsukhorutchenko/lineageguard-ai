import { DeadlineEventSchema, type WorkflowSnapshot } from "../workflow/contracts.js";

type DeadlineEvent = NonNullable<WorkflowSnapshot["deadlineEvents"]>[number];

export type RecordDeadlineEvent = (event: DeadlineEvent) => void;

const ownerOrder = {
  MCP_CONNECT_TIMEOUT: 0,
  DATAHUB_ANALYSIS_TIMEOUT: 1,
  GENERATION_TIMEOUT: 2,
  AGENT_TIMEOUT: 3,
  WORKFLOW_TIMEOUT: 4,
} as const satisfies Readonly<Record<DeadlineEvent["kind"], number>>;

function eventKey(event: DeadlineEvent): string {
  return `${event.kind}:${event.attempt}`;
}

function immutableSorted(events: Iterable<DeadlineEvent>): readonly DeadlineEvent[] {
  return Object.freeze(
    [...events]
      .sort(
        (left, right) =>
          ownerOrder[left.kind] - ownerOrder[right.kind] || left.attempt - right.attempt,
      )
      .map((event) => Object.freeze({ ...event })),
  );
}

export function createDeadlineEventRecorder() {
  const recorded = new Map<string, DeadlineEvent>();

  const parseProspective = (event: DeadlineEvent): DeadlineEvent => {
    const parsed = DeadlineEventSchema.parse(event);
    if (recorded.has(eventKey(parsed))) {
      throw new Error("Deadline event already recorded.");
    }
    if (recorded.size >= 6) {
      throw new Error("Deadline event limit reached.");
    }
    return parsed;
  };

  const record: RecordDeadlineEvent = (event) => {
    const parsed = parseProspective(event);
    recorded.set(eventKey(parsed), Object.freeze({ ...parsed }));
  };

  return Object.freeze({
    record,
    snapshot(): readonly DeadlineEvent[] {
      return immutableSorted(recorded.values());
    },
    preview(event: DeadlineEvent): readonly DeadlineEvent[] {
      const parsed = parseProspective(event);
      return immutableSorted([...recorded.values(), parsed]);
    },
    adopt(event: DeadlineEvent): void {
      record(event);
    },
  });
}
