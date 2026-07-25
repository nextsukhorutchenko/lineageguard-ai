import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { MAX_RUN_ENVELOPE_BYTES, SafeRunIdSchema } from "../../src/runs/run-envelope.js";

const inspectionFailure = (): Error => new Error("Unable to inspect the persisted run envelope.");

export async function readPersistedRunEnvelopeBytes(options: {
  readonly runsRoot: string;
  readonly runId: string;
}): Promise<Buffer> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    const runId = SafeRunIdSchema.parse(options.runId);
    const finalPath = join(options.runsRoot, `run-${runId}.json`);
    const pathStats = await lstat(finalPath);
    if (pathStats.isSymbolicLink() || !pathStats.isFile()) throw inspectionFailure();

    handle = await open(finalPath, "r");
    const openedStats = await handle.stat();
    if (!openedStats.isFile() || openedStats.size > MAX_RUN_ENVELOPE_BYTES) {
      throw inspectionFailure();
    }

    const buffer = Buffer.alloc(MAX_RUN_ENVELOPE_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const result = await handle.read(buffer, total, buffer.length - total, total);
      if (result.bytesRead === 0) break;
      total += result.bytesRead;
    }
    if (total > MAX_RUN_ENVELOPE_BYTES) throw inspectionFailure();
    return Buffer.from(buffer.subarray(0, total));
  } catch {
    throw inspectionFailure();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
