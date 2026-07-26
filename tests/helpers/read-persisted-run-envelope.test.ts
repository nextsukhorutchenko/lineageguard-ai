import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_RUN_ENVELOPE_BYTES } from "../../src/runs/run-envelope.js";
import { readPersistedRunEnvelopeBytes } from "./read-persisted-run-envelope.js";

describe("readPersistedRunEnvelopeBytes", () => {
  let runsRoot: string;

  beforeEach(async () => {
    runsRoot = await mkdtemp(join(tmpdir(), "lineageguard-envelope-proof-"));
  });

  afterEach(async () => {
    await rm(runsRoot, { recursive: true });
  });

  it("reads the complete persisted bytes from the fixed run filename", async () => {
    const runId = "live-openai-smoke";
    const serialized = Buffer.from(
      '{"package":{"files":{"rollout-plan.md":"private-marker"}}}',
      "utf8",
    );
    await writeFile(join(runsRoot, `run-${runId}.json`), serialized);

    const bytes = await readPersistedRunEnvelopeBytes({ runsRoot, runId });

    expect(bytes.equals(serialized)).toBe(true);
  });

  it("rejects unsafe run IDs before resolving a filename", async () => {
    await expect(readPersistedRunEnvelopeBytes({ runsRoot, runId: "../outside" })).rejects.toThrow(
      "Unable to inspect the persisted run envelope.",
    );
  });

  it("rejects persisted envelopes above the repository byte limit", async () => {
    const runId = "oversized";
    await writeFile(
      join(runsRoot, `run-${runId}.json`),
      Buffer.alloc(MAX_RUN_ENVELOPE_BYTES + 1, 0x20),
    );

    await expect(readPersistedRunEnvelopeBytes({ runsRoot, runId })).rejects.toThrow(
      "Unable to inspect the persisted run envelope.",
    );
  });
});
