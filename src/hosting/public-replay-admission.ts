import { lstat, readdir } from "node:fs/promises";
import { readRunEnvelope } from "../artifacts/run-envelope-files.js";
import { SafeRunIdSchema } from "../runs/run-envelope.js";

export const PUBLIC_REPLAY_CONCURRENCY_LIMIT = 2;
export const PUBLIC_REPLAY_ENVELOPE_LIMIT = 64;

export interface PublicReplayLease {
  release(): void;
}

export type PublicReplayAdmissionDecision =
  | { readonly kind: "accepted"; readonly lease: PublicReplayLease }
  | {
      readonly kind: "rejected";
      readonly code: "DEMO_BUSY" | "DEMO_CAPACITY_REACHED";
    };

export interface PublicReplayAdmission {
  acquire(runsRoot: string): Promise<PublicReplayAdmissionDecision>;
}

interface RunsRootIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
}

async function readRunsRootIdentity(runsRoot: string): Promise<RunsRootIdentity> {
  const stats = await lstat(runsRoot, { bigint: true });
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("Public replay storage is unavailable.");
  }
  return { dev: stats.dev, ino: stats.ino };
}

function isSameRootIdentity(expected: RunsRootIdentity, actual: RunsRootIdentity): boolean {
  return expected.dev === actual.dev && expected.ino === actual.ino;
}

async function countPublishedRunEnvelopes(runsRoot: string): Promise<number> {
  const entries = await readdir(runsRoot, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    const match = /^run-(.+)\.json$/u.exec(entry.name);
    const runId = match?.[1];
    if (!entry.isFile() || runId === undefined || !SafeRunIdSchema.safeParse(runId).success) {
      throw new Error("Public replay storage is unavailable.");
    }
    await readRunEnvelope({ runsRoot, runId });
    count += 1;
  }
  return count;
}

export function createPublicReplayAdmission(
  options: {
    readonly concurrencyLimit?: number;
    readonly envelopeLimit?: number;
    readonly countPublished?: (runsRoot: string) => Promise<number>;
  } = {},
): PublicReplayAdmission {
  const concurrencyLimit = options.concurrencyLimit ?? PUBLIC_REPLAY_CONCURRENCY_LIMIT;
  const envelopeLimit = options.envelopeLimit ?? PUBLIC_REPLAY_ENVELOPE_LIMIT;
  const countPublished = options.countPublished ?? countPublishedRunEnvelopes;
  let initializedRoot: string | undefined;
  let initializedIdentity: RunsRootIdentity | undefined;
  let initializationPromise: Promise<void> | undefined;
  let activeWorkflows = 0;
  let publicationReservations = 0;

  const initialize = async (runsRoot: string): Promise<boolean> => {
    if (initializedRoot === undefined) initializedRoot = runsRoot;
    if (initializedRoot !== runsRoot) return false;
    if (initializationPromise === undefined) {
      initializationPromise = Promise.resolve().then(async () => {
        const identity = await readRunsRootIdentity(runsRoot);
        const count = await countPublished(runsRoot);
        if (!Number.isSafeInteger(count) || count < 0) {
          throw new Error("Public replay storage is unavailable.");
        }
        initializedIdentity = identity;
        publicationReservations = count;
      });
    }
    try {
      await initializationPromise;
      if (initializedIdentity === undefined) return false;
      const currentIdentity = await readRunsRootIdentity(runsRoot);
      return isSameRootIdentity(initializedIdentity, currentIdentity);
    } catch {
      return false;
    }
  };

  return {
    async acquire(runsRoot) {
      if (!(await initialize(runsRoot))) {
        return { kind: "rejected", code: "DEMO_CAPACITY_REACHED" };
      }
      if (activeWorkflows >= concurrencyLimit) {
        return { kind: "rejected", code: "DEMO_BUSY" };
      }
      if (publicationReservations >= envelopeLimit) {
        return { kind: "rejected", code: "DEMO_CAPACITY_REACHED" };
      }

      activeWorkflows += 1;
      publicationReservations += 1;
      let released = false;
      return {
        kind: "accepted",
        lease: {
          release() {
            if (released) return;
            released = true;
            activeWorkflows -= 1;
          },
        },
      };
    },
  };
}
