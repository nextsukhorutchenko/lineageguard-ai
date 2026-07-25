import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as downloadArtifact } from "../../app/api/runs/[runId]/artifacts/[filename]/route.js";
import { POST as regenerateRun } from "../../app/api/runs/[runId]/regenerate/route.js";
import { GET as reloadRun } from "../../app/api/runs/[runId]/route.js";
import { POST as startRun } from "../../app/api/runs/route.js";
import { createPostRunsHandler } from "../../src/app/web-dependencies.js";
import { readNdjson } from "../../src/ui/read-ndjson.js";
import {
  WorkflowEventSchema,
  WorkflowSnapshotSchema,
  type WorkflowEvent,
} from "../../src/workflow/contracts.js";

const REQUEST =
  "Rename column customer_id to customer_key in dataset snowflake:b2fd91.order_entry_db.analytics.order_details";

let runsRoot = "";
let originalEnvironment: NodeJS.ProcessEnv;

beforeEach(async () => {
  originalEnvironment = { ...process.env };
  runsRoot = await mkdtemp(join(tmpdir(), "lineageguard-api-"));
  process.env = {
    ...originalEnvironment,
    LINEAGEGUARD_DEMO_MODE: "REPLAY",
    LINEAGEGUARD_RUNS_DIR: runsRoot,
  };
});

afterEach(async () => {
  process.env = originalEnvironment;
  await rm(runsRoot, { recursive: true, force: true });
});

const runRequest = (body: unknown, signal?: AbortSignal): Request =>
  new Request("http://localhost/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });

async function collectEvents(response: Response): Promise<WorkflowEvent[]> {
  const received: WorkflowEvent[] = [];
  await readNdjson(response, (event) => received.push(WorkflowEventSchema.parse(event)));
  return received;
}

async function createCompletedRun(): Promise<{
  readonly runId: string;
  readonly events: readonly WorkflowEvent[];
}> {
  const response = await startRun(runRequest({ mode: "REPLAY", request: REQUEST }));
  const events = await collectEvents(response);
  const terminal = events.at(-1);
  if (terminal?.type !== "snapshot") throw new Error("Expected a terminal snapshot.");
  expect(terminal.snapshot.status).toBe("COMPLETED");
  return { runId: terminal.snapshot.runId, events };
}

it("rejects unknown request fields with HTTP 400", async () => {
  const response = await startRun(
    runRequest({ mode: "REPLAY", request: REQUEST, apiKey: "must-not-be-accepted" }),
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid rename request." });
});

it("streams NDJSON and ends with one validated terminal snapshot", async () => {
  const response = await startRun(runRequest({ mode: "REPLAY", request: REQUEST }));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");

  const events = await collectEvents(response);
  const terminal = events.filter(
    (event) => event.type === "snapshot" && event.snapshot.status === "COMPLETED",
  );
  expect(terminal).toHaveLength(1);
  const completed = terminal[0];
  if (completed?.type !== "snapshot") throw new Error("Expected a completed snapshot.");
  expect(() => WorkflowSnapshotSchema.parse(completed.snapshot)).not.toThrow();
});

it("preflights storage before constructing workflow dependencies", async () => {
  const createDependencies = vi.fn(() => {
    throw new Error("must not be reached");
  });
  const handler = createPostRunsHandler({ createDependencies });
  process.env.LINEAGEGUARD_RUNS_DIR = resolve(runsRoot, "missing");

  const response = await handler(runRequest({ mode: "REPLAY", request: REQUEST }));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Demo service storage is unavailable." });
  expect(createDependencies).not.toHaveBeenCalled();
});

it("reloads sanitized snapshots, regenerates without DataHub, and downloads only public artifacts", async () => {
  const { runId } = await createCompletedRun();
  const reload = await reloadRun(new Request(`http://localhost/api/runs/${runId}`), {
    params: Promise.resolve({ runId }),
  });
  const parent = WorkflowSnapshotSchema.parse(await reload.json());
  expect(JSON.stringify(parent)).not.toContain(runsRoot);

  const regenerationRequest = new Request(`http://localhost/api/runs/${runId}/regenerate`, {
    method: "POST",
  });
  expect(await regenerationRequest.clone().text()).toBe("");
  const regenerated = await regenerateRun(regenerationRequest, {
    params: Promise.resolve({ runId }),
  });
  const regenerationEvents = await collectEvents(regenerated);
  const child = regenerationEvents.at(-1);
  if (child?.type !== "snapshot") throw new Error("Expected a terminal child snapshot.");
  expect(child.snapshot).toMatchObject({
    status: "COMPLETED",
    parentRunId: runId,
    contextHash: parent.contextHash,
  });

  for (const filename of [
    "migration-up.sql",
    "migration-down.sql",
    "validation.sql",
    "rollout-plan.md",
  ] as const) {
    const download = await downloadArtifact(
      new Request(`http://localhost/api/runs/${runId}/artifacts/${filename}`),
      { params: Promise.resolve({ runId, filename }) },
    );
    expect(download.status).toBe(200);
    expect(await download.text()).not.toContain(runsRoot);
    expect(download.headers.get("content-disposition")).toBe(`attachment; filename="${filename}"`);
  }

  for (const filename of ["secret.txt", "../migration-up.sql", "%2e%2e"] as const) {
    const download = await downloadArtifact(
      new Request(`http://localhost/api/runs/${runId}/artifacts/${filename}`),
      { params: Promise.resolve({ runId, filename }) },
    );
    expect(download.status).toBe(404);
    expect(await download.text()).not.toContain(runsRoot);
  }
});

it("does not fall back when a final envelope is missing or tampered", async () => {
  const missing = await reloadRun(new Request("http://localhost/api/runs/missing"), {
    params: Promise.resolve({ runId: "missing" }),
  });
  expect(missing.status).toBe(404);

  const { runId } = await createCompletedRun();
  const envelopePath = join(runsRoot, `run-${runId}.json`);
  const envelope = JSON.parse(await readFile(envelopePath, "utf8")) as {
    hashes: { snapshot: string };
  };
  envelope.hashes.snapshot = "0".repeat(64);
  await writeFile(envelopePath, JSON.stringify(envelope));

  const reload = await reloadRun(new Request(`http://localhost/api/runs/${runId}`), {
    params: Promise.resolve({ runId }),
  });
  const download = await downloadArtifact(
    new Request(`http://localhost/api/runs/${runId}/artifacts/migration-up.sql`),
    { params: Promise.resolve({ runId, filename: "migration-up.sql" }) },
  );
  expect(reload.status).toBe(404);
  expect(download.status).toBe(404);
  expect(`${await reload.text()}${await download.text()}`).not.toContain(runsRoot);
});

it("rejects malformed, linked, and traversal final entries without exposing native paths", async () => {
  const outside = await mkdtemp(join(tmpdir(), "lineageguard-outside-"));
  try {
    await symlink(outside, join(runsRoot, "run-linked.json"), "junction");
    expect((await lstat(join(runsRoot, "run-linked.json"))).isSymbolicLink()).toBe(true);
    for (const runId of ["linked", "../outside"]) {
      const response = await reloadRun(new Request("http://localhost/api/runs"), {
        params: Promise.resolve({ runId }),
      });
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain(runsRoot);
    }
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

describe("trusted-root preflight", () => {
  it.each(["missing", "relative", "nonexistent", "file", "junction"])(
    "fails closed for a %s runs root before workflow construction",
    async (kind) => {
      const target = await mkdtemp(join(tmpdir(), "lineageguard-root-target-"));
      const candidate = join(tmpdir(), `lineageguard-root-${kind}-${process.pid}`);
      try {
        if (kind === "missing") delete process.env.LINEAGEGUARD_RUNS_DIR;
        if (kind === "relative") process.env.LINEAGEGUARD_RUNS_DIR = "relative-runs";
        if (kind === "nonexistent") process.env.LINEAGEGUARD_RUNS_DIR = candidate;
        if (kind === "file") {
          await writeFile(candidate, "not a directory");
          process.env.LINEAGEGUARD_RUNS_DIR = candidate;
        }
        if (kind === "junction") {
          await symlink(target, candidate, "junction");
          process.env.LINEAGEGUARD_RUNS_DIR = candidate;
        }
        const createDependencies = vi.fn(() => {
          throw new Error("must not be reached");
        });
        const response = await createPostRunsHandler({ createDependencies })(
          runRequest({ mode: "REPLAY", request: REQUEST }),
        );
        expect(response.status).toBe(503);
        expect(await response.text()).not.toContain(candidate);
        expect(createDependencies).not.toHaveBeenCalled();
      } finally {
        await rm(candidate, { recursive: true, force: true });
        await rm(target, { recursive: true, force: true });
      }
    },
  );
});

it("rejects a regeneration request body", async () => {
  const { runId } = await createCompletedRun();
  const response = await regenerateRun(
    new Request(`http://localhost/api/runs/${runId}/regenerate`, {
      method: "POST",
      body: "{}",
    }),
    { params: Promise.resolve({ runId }) },
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid regeneration request." });
});
