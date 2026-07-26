import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createPublicReplayAdmission,
  type PublicReplayAdmission,
} from "./public-replay-admission.js";

const temporaryRoots: string[] = [];

async function freshRunsRoot(): Promise<string> {
  const runsRoot = await mkdtemp(join(tmpdir(), "lineageguard-public-admission-"));
  temporaryRoots.push(runsRoot);
  return runsRoot;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((runsRoot) => rm(runsRoot, { recursive: true, force: true })),
  );
});

it("admits two workflows and rejects the third as busy", async () => {
  const runsRoot = await freshRunsRoot();
  const admission = createPublicReplayAdmission({ countPublished: async () => 0 });

  const first = await admission.acquire(runsRoot);
  const second = await admission.acquire(runsRoot);

  expect(await admission.acquire(runsRoot)).toEqual({
    kind: "rejected",
    code: "DEMO_BUSY",
  });
  expect(first.kind).toBe("accepted");
  expect(second.kind).toBe("accepted");
});

it("releases a lease exactly once under reentrancy", async () => {
  const runsRoot = await freshRunsRoot();
  const admission = createPublicReplayAdmission({
    concurrencyLimit: 1,
    countPublished: async () => 0,
  });
  const first = await admission.acquire(runsRoot);
  if (first.kind !== "accepted") throw new Error("Expected admission.");

  first.lease.release();
  first.lease.release();

  const second = await admission.acquire(runsRoot);
  expect(second.kind).toBe("accepted");
  expect(await admission.acquire(runsRoot)).toEqual({
    kind: "rejected",
    code: "DEMO_BUSY",
  });
});

it("rejects the sixty-fifth publication reservation", async () => {
  const runsRoot = await freshRunsRoot();
  const admission = createPublicReplayAdmission({
    envelopeLimit: 64,
    countPublished: async () => 63,
  });

  const last = await admission.acquire(runsRoot);
  expect(last.kind).toBe("accepted");
  if (last.kind === "accepted") last.lease.release();

  expect(await admission.acquire(runsRoot)).toEqual({
    kind: "rejected",
    code: "DEMO_CAPACITY_REACHED",
  });
});

it("shares one cached count promise across concurrent first acquisitions", async () => {
  const runsRoot = await freshRunsRoot();
  let resolveCount!: (count: number) => void;
  const pendingCount = new Promise<number>((resolve) => {
    resolveCount = resolve;
  });
  const countPublished = vi.fn(() => pendingCount);
  const admission = createPublicReplayAdmission({ countPublished });

  const first = admission.acquire(runsRoot);
  const second = admission.acquire(runsRoot);
  await vi.waitFor(() => expect(countPublished).toHaveBeenCalledOnce());
  resolveCount(0);

  await expect(first).resolves.toMatchObject({ kind: "accepted" });
  await expect(second).resolves.toMatchObject({ kind: "accepted" });
  expect(countPublished).toHaveBeenCalledWith(runsRoot);
});

it("caches initialization before invoking a reentrant count boundary", async () => {
  const runsRoot = await freshRunsRoot();
  const holder: { admission?: PublicReplayAdmission } = {};
  let reentrantAcquisition:
    Promise<Awaited<ReturnType<PublicReplayAdmission["acquire"]>>> | undefined;
  const countPublished = vi.fn(async () => {
    if (holder.admission === undefined) throw new Error("Expected admission controller.");
    reentrantAcquisition = holder.admission.acquire(runsRoot);
    return 0;
  });
  const admission = createPublicReplayAdmission({ countPublished });
  holder.admission = admission;

  await expect(admission.acquire(runsRoot)).resolves.toMatchObject({ kind: "accepted" });
  if (reentrantAcquisition === undefined) throw new Error("Expected reentrant acquisition.");
  await expect(reentrantAcquisition).resolves.toMatchObject({ kind: "accepted" });
  expect(countPublished).toHaveBeenCalledOnce();
});

it("fails closed and caches a publication-count failure", async () => {
  const runsRoot = await freshRunsRoot();
  const countPublished = vi.fn(async () => {
    throw new Error("untrusted storage detail");
  });
  const admission = createPublicReplayAdmission({ countPublished });

  await expect(admission.acquire(runsRoot)).resolves.toEqual({
    kind: "rejected",
    code: "DEMO_CAPACITY_REACHED",
  });
  await expect(admission.acquire(runsRoot)).resolves.toEqual({
    kind: "rejected",
    code: "DEMO_CAPACITY_REACHED",
  });
  expect(countPublished).toHaveBeenCalledOnce();
});

it("rejects a different runs root after initialization", async () => {
  const firstRoot = await freshRunsRoot();
  const secondRoot = await freshRunsRoot();
  const admission = createPublicReplayAdmission({ countPublished: async () => 0 });
  const first = await admission.acquire(firstRoot);
  if (first.kind !== "accepted") throw new Error("Expected admission.");
  first.lease.release();

  await expect(admission.acquire(secondRoot)).resolves.toEqual({
    kind: "rejected",
    code: "DEMO_CAPACITY_REACHED",
  });
});

it("never refunds an accepted publication reservation when concurrency is released", async () => {
  const runsRoot = await freshRunsRoot();
  const admission = createPublicReplayAdmission({
    envelopeLimit: 1,
    countPublished: async () => 0,
  });
  const accepted = await admission.acquire(runsRoot);
  if (accepted.kind !== "accepted") throw new Error("Expected admission.");

  accepted.lease.release();

  await expect(admission.acquire(runsRoot)).resolves.toEqual({
    kind: "rejected",
    code: "DEMO_CAPACITY_REACHED",
  });
});

it("accepts an empty runs root with the default publication counter", async () => {
  const runsRoot = await freshRunsRoot();
  await expect(createPublicReplayAdmission().acquire(runsRoot)).resolves.toMatchObject({
    kind: "accepted",
  });
});

it.each([
  ["an unexpected entry", "notes.txt", "not an envelope"],
  ["an invalid final envelope", "run-existing.json", "{}"],
] as const)("fails closed when storage contains %s", async (_name, filename, body) => {
  const runsRoot = await freshRunsRoot();
  await writeFile(join(runsRoot, filename), body, "utf8");

  await expect(createPublicReplayAdmission().acquire(runsRoot)).resolves.toEqual({
    kind: "rejected",
    code: "DEMO_CAPACITY_REACHED",
  });
});
