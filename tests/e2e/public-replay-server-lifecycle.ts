import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, lstat, mkdtemp, realpath, rename, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { readRunEnvelope } from "../../src/artifacts/run-envelope-files.js";
import { PUBLIC_REPLAY_REQUEST } from "../../src/hosting/public-replay-contracts.js";
import { SafeRunIdSchema } from "../../src/runs/run-envelope.js";
import { readNdjson } from "../../src/ui/read-ndjson.js";
import {
  completeWithin,
  isTerminal,
  observeChild,
  requestProcessTreeTermination,
  type ObservedChild,
} from "../support/managed-process.js";

const HOST = "127.0.0.1";
const PORT = 3110;
const HEALTH_URL = `http://${HOST}:${PORT}/api/health`;
const RUNS_URL = `http://${HOST}:${PORT}/api/runs`;
const OWNED_PARENT_PREFIX = "lineageguard-public-replay-e2e-";
const RUNS_CHILD_NAME = "runs";
const STARTUP_TIMEOUT_MS = 120_000;
const PROBE_TIMEOUT_MS = 1_000;
const POLL_INTERVAL_MS = 100;
const TERMINATION_TIMEOUT_MS = 10_000;
const MAX_HEALTH_BYTES = 128;
const CHILD_ENVIRONMENT_ALLOWLIST = [
  "APPDATA",
  "CI",
  "COMSPEC",
  "FORCE_COLOR",
  "HOME",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "NO_COLOR",
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "TZ",
  "USERPROFILE",
  "WINDIR",
] as const;

interface OwnedPathStats {
  readonly dev: number;
  readonly ino: number;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

interface OwnedParentIdentity {
  readonly dev: number;
  readonly ino: number;
}

interface HealthProbe {
  readonly status: number;
  readonly body: unknown;
}

export interface PublicReplayChildOptions {
  readonly cwd: string;
  readonly detached: boolean;
  readonly env: NodeJS.ProcessEnv;
}

export interface PublicReplayE2eServerHandle {
  readonly runsParent: string;
  readonly runsRoot: string;
  stop(): Promise<void>;
}

interface LifecycleTimeouts {
  readonly startupMs: number;
  readonly terminationMs: number;
  readonly pollMs: number;
}

interface CleanupDependencies {
  readonly lstat: (path: string) => Promise<OwnedPathStats>;
  readonly realpath: (path: string) => Promise<string>;
  readonly rename: (source: string, destination: string) => Promise<void>;
  readonly remove: (path: string) => Promise<void>;
  readonly createQuarantinePath: (canonicalTemp: string) => string;
}

interface LifecycleDependencies {
  readonly isEndpointOccupied: (signal: AbortSignal) => Promise<boolean>;
  readonly probeHealth: (signal: AbortSignal) => Promise<HealthProbe | undefined>;
  readonly proveOwnership: (runsRoot: string, signal: AbortSignal) => Promise<boolean>;
  readonly createTemporaryParent: () => Promise<string>;
  readonly captureParentIdentity: (runsParent: string) => Promise<OwnedParentIdentity>;
  readonly resolveBootstrap: () => string;
  readonly spawnChild: (
    bootstrap: string,
    runsRoot: string,
    options: PublicReplayChildOptions,
  ) => ChildProcess;
  readonly spawnTreeKiller?: (pid: number) => ChildProcess;
  readonly removeOwnedParent: (
    runsParent: string,
    runsRoot: string,
    expectedIdentity: OwnedParentIdentity,
  ) => Promise<void>;
  readonly platform: NodeJS.Platform;
  readonly timeouts: LifecycleTimeouts;
  readonly now: () => number;
  readonly sleep: (milliseconds: number) => Promise<void>;
}

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === code
  );
}

async function endpointIsOccupied(signal: AbortSignal): Promise<boolean> {
  return await new Promise<boolean>((resolveResult) => {
    const socket = createConnection({ host: HOST, port: PORT });
    let settled = false;
    const finish = (occupied: boolean): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      socket.destroy();
      resolveResult(occupied);
    };
    const abort = (): void => finish(false);
    signal.addEventListener("abort", abort, { once: true });
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(PROBE_TIMEOUT_MS, () => finish(false));
    if (signal.aborted) abort();
  });
}

async function probeHealth(signal: AbortSignal): Promise<HealthProbe | undefined> {
  try {
    const response = await fetch(HEALTH_URL, {
      cache: "no-store",
      redirect: "error",
      signal,
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_HEALTH_BYTES) return { status: response.status, body: undefined };
    const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    return { status: response.status, body };
  } catch {
    return undefined;
  }
}

async function proveOwnership(runsRoot: string, signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(RUNS_URL, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "REPLAY",
        request: PUBLIC_REPLAY_REQUEST,
      }),
      signal,
    });
    let terminalRunId: string | undefined;
    await readNdjson(response, (event) => {
      if (event.type === "snapshot" && event.snapshot.status === "COMPLETED") {
        terminalRunId = SafeRunIdSchema.parse(event.snapshot.runId);
      }
    });
    if (terminalRunId === undefined || signal.aborted) return false;
    const envelope = await readRunEnvelope({ runsRoot, runId: terminalRunId });
    return (
      envelope.kind === "completed" &&
      envelope.runId === terminalRunId &&
      envelope.snapshot.runId === terminalRunId &&
      envelope.snapshot.status === "COMPLETED"
    );
  } catch {
    return false;
  }
}

function isExactHealthyProbe(probe: HealthProbe | undefined): boolean {
  if (
    probe?.status !== 200 ||
    typeof probe.body !== "object" ||
    probe.body === null ||
    Array.isArray(probe.body)
  ) {
    return false;
  }
  const body = probe.body as Readonly<Record<string, unknown>>;
  return Object.keys(body).length === 2 && body.status === "ok" && body.mode === "PUBLIC_REPLAY";
}

function identityFromStats(stats: OwnedPathStats): OwnedParentIdentity {
  if (!Number.isFinite(stats.dev) || !Number.isFinite(stats.ino)) {
    throw new Error("identity");
  }
  return { dev: stats.dev, ino: stats.ino };
}

function sameIdentity(expected: OwnedParentIdentity, actual: OwnedPathStats): boolean {
  return expected.dev === actual.dev && expected.ino === actual.ino;
}

function assertOwnedDirectory(stats: OwnedPathStats, expectedIdentity: OwnedParentIdentity): void {
  if (stats.isSymbolicLink() || !stats.isDirectory() || !sameIdentity(expectedIdentity, stats)) {
    throw new Error("boundary");
  }
}

async function removeOwnedParentWithDependencies(
  runsParent: string,
  runsRoot: string,
  expectedIdentity: OwnedParentIdentity,
  dependencies: CleanupDependencies,
): Promise<void> {
  try {
    if (!isAbsolute(runsParent) || !isAbsolute(runsRoot)) throw new Error("boundary");
    const expectedParent = resolve(runsParent);
    const expectedRoot = resolve(runsRoot);
    if (relative(expectedParent, expectedRoot) !== RUNS_CHILD_NAME) throw new Error("boundary");

    const parentStats = await dependencies.lstat(expectedParent);
    assertOwnedDirectory(parentStats, expectedIdentity);
    const [canonicalParent, canonicalTemp] = await Promise.all([
      dependencies.realpath(expectedParent),
      dependencies.realpath(tmpdir()),
    ]);
    if (
      relative(expectedParent, canonicalParent) !== "" ||
      dirname(canonicalParent) !== canonicalTemp ||
      !basename(canonicalParent).startsWith(OWNED_PARENT_PREFIX)
    ) {
      throw new Error("boundary");
    }

    try {
      const rootStats = await dependencies.lstat(expectedRoot);
      if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) throw new Error("boundary");
      const canonicalRoot = await dependencies.realpath(expectedRoot);
      if (
        dirname(canonicalRoot) !== canonicalParent ||
        basename(canonicalRoot) !== RUNS_CHILD_NAME
      ) {
        throw new Error("boundary");
      }
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }

    assertOwnedDirectory(await dependencies.lstat(expectedParent), expectedIdentity);
    const quarantine = resolve(dependencies.createQuarantinePath(canonicalTemp));
    if (
      dirname(quarantine) !== canonicalTemp ||
      !basename(quarantine).startsWith(`${OWNED_PARENT_PREFIX}quarantine-`)
    ) {
      throw new Error("boundary");
    }
    await expectMissing(quarantine);
    await dependencies.rename(canonicalParent, quarantine);

    const quarantinedStats = await dependencies.lstat(quarantine);
    assertOwnedDirectory(quarantinedStats, expectedIdentity);
    const canonicalQuarantine = await dependencies.realpath(quarantine);
    if (relative(quarantine, canonicalQuarantine) !== "") throw new Error("boundary");
    const quarantinedRoot = join(canonicalQuarantine, RUNS_CHILD_NAME);
    try {
      const rootStats = await dependencies.lstat(quarantinedRoot);
      if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
        throw new Error("boundary");
      }
      const canonicalRoot = await dependencies.realpath(quarantinedRoot);
      if (
        dirname(canonicalRoot) !== canonicalQuarantine ||
        basename(canonicalRoot) !== RUNS_CHILD_NAME
      ) {
        throw new Error("boundary");
      }
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
    assertOwnedDirectory(await dependencies.lstat(quarantine), expectedIdentity);
    await dependencies.remove(canonicalQuarantine);
    await expectMissing(canonicalQuarantine);
  } catch {
    throw new Error("The public replay test root could not be removed.");
  }
}

async function expectMissing(path: string): Promise<void> {
  try {
    await access(path);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return;
    throw error;
  }
  throw new Error("present");
}

export async function removeOwnedPublicReplayParent(
  runsParent: string,
  runsRoot: string,
  overrides: Partial<CleanupDependencies> & {
    readonly expectedIdentity?: OwnedParentIdentity;
  } = {},
): Promise<void> {
  const { expectedIdentity: configuredIdentity, ...dependencyOverrides } = overrides;
  const dependencies = {
    lstat,
    realpath,
    rename,
    remove: async (path: string) => await rm(path, { recursive: true, force: true }),
    createQuarantinePath: (canonicalTemp: string) =>
      join(canonicalTemp, `${OWNED_PARENT_PREFIX}quarantine-${randomUUID()}`),
    ...dependencyOverrides,
  };
  const expectedIdentity =
    configuredIdentity ?? identityFromStats(await dependencies.lstat(resolve(runsParent)));
  await removeOwnedParentWithDependencies(runsParent, runsRoot, expectedIdentity, dependencies);
}

function buildChildEnvironment(runsRoot: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    LINEAGEGUARD_DEMO_MODE: "REPLAY",
    LINEAGEGUARD_DEPLOYMENT_PROFILE: "PUBLIC_REPLAY",
    LINEAGEGUARD_RUNS_DIR: runsRoot,
    NEXT_TELEMETRY_DISABLED: "1",
    PORT: String(PORT),
  };
  for (const key of CHILD_ENVIRONMENT_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

function defaultSpawnChild(
  bootstrap: string,
  runsRoot: string,
  options: PublicReplayChildOptions,
): ChildProcess {
  void runsRoot;
  return spawn(process.execPath, [bootstrap], {
    cwd: options.cwd,
    detached: options.detached,
    env: options.env,
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
}

const defaultDependencies: LifecycleDependencies = {
  isEndpointOccupied: endpointIsOccupied,
  probeHealth,
  proveOwnership,
  createTemporaryParent: async () => await mkdtemp(join(tmpdir(), OWNED_PARENT_PREFIX)),
  captureParentIdentity: async (runsParent) => identityFromStats(await lstat(runsParent)),
  resolveBootstrap: () => resolve(process.cwd(), "dist", "hosting", "start-public-replay.js"),
  spawnChild: defaultSpawnChild,
  removeOwnedParent: async (runsParent, runsRoot, expectedIdentity) =>
    await removeOwnedPublicReplayParent(runsParent, runsRoot, {
      expectedIdentity,
    }),
  platform: process.platform,
  timeouts: {
    startupMs: STARTUP_TIMEOUT_MS,
    terminationMs: TERMINATION_TIMEOUT_MS,
    pollMs: POLL_INTERVAL_MS,
  },
  now: Date.now,
  sleep: defaultSleep,
};

interface DeadlineOutcome<T> {
  readonly completed: boolean;
  readonly value?: T;
}

async function completeBeforeDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  deadline: number,
  dependencies: Pick<LifecycleDependencies, "now">,
  maximumDurationMs?: number,
): Promise<DeadlineOutcome<T>> {
  const startedAt = dependencies.now();
  const operationDeadline =
    maximumDurationMs === undefined ? deadline : Math.min(deadline, startedAt + maximumDurationMs);
  const remainingMs = operationDeadline - startedAt;
  if (remainingMs <= 0) return { completed: false };

  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<DeadlineOutcome<T>>((resolveTimeout) => {
    timer = setTimeout(() => {
      controller.abort();
      resolveTimeout({ completed: false });
    }, remainingMs);
  });
  const attempted = operation(controller.signal).then(
    (value): DeadlineOutcome<T> => ({ completed: true, value }),
    (): DeadlineOutcome<T> => ({ completed: true }),
  );
  try {
    const outcome = await Promise.race([attempted, timeout]);
    if (!outcome.completed || dependencies.now() >= operationDeadline) {
      controller.abort();
      return { completed: false };
    }
    return outcome;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function waitForEndpointRelease(dependencies: LifecycleDependencies): Promise<boolean> {
  const deadline = dependencies.now() + dependencies.timeouts.terminationMs;
  while (dependencies.now() < deadline) {
    const occupancy = await completeBeforeDeadline(
      dependencies.isEndpointOccupied,
      deadline,
      dependencies,
      PROBE_TIMEOUT_MS,
    );
    if (occupancy.completed && occupancy.value === false) return true;
    const remainingMs = deadline - dependencies.now();
    if (remainingMs <= 0) break;
    await dependencies.sleep(Math.min(dependencies.timeouts.pollMs, remainingMs));
  }
  return false;
}

function createStop(
  runsParent: string,
  runsRoot: string,
  expectedIdentity: OwnedParentIdentity,
  observed: ObservedChild,
  dependencies: LifecycleDependencies,
): () => Promise<void> {
  let shutdown: Promise<void> | undefined;
  return (): Promise<void> => {
    shutdown ??= (async () => {
      try {
        await requestProcessTreeTermination(observed, {
          platform: dependencies.platform,
          timeoutMs: dependencies.timeouts.terminationMs,
          ...(dependencies.spawnTreeKiller === undefined
            ? {}
            : { spawnTreeKiller: dependencies.spawnTreeKiller }),
        });
        const childClosed = await completeWithin(
          observed.close,
          dependencies.timeouts.terminationMs,
        );
        if (!childClosed.completed || childClosed.error !== undefined) throw new Error("close");
        if (!(await waitForEndpointRelease(dependencies))) {
          throw new Error("endpoint");
        }
        await dependencies.removeOwnedParent(runsParent, runsRoot, expectedIdentity);
      } catch {
        throw new Error("The public replay test server could not be stopped.");
      }
    })();
    return shutdown;
  };
}

async function startWithDependencies(
  dependencies: LifecycleDependencies,
): Promise<PublicReplayE2eServerHandle> {
  const deadline = dependencies.now() + dependencies.timeouts.startupMs;
  const occupancy = await completeBeforeDeadline(
    dependencies.isEndpointOccupied,
    deadline,
    dependencies,
    PROBE_TIMEOUT_MS,
  );
  if (occupancy.completed && occupancy.value === true) {
    throw new Error("The public replay test endpoint is already in use.");
  }
  if (!occupancy.completed) {
    throw new Error("The public replay test server failed to start.");
  }

  let runsParent: string;
  try {
    runsParent = await dependencies.createTemporaryParent();
  } catch {
    throw new Error("The public replay test server failed to start.");
  }
  const runsRoot = join(runsParent, RUNS_CHILD_NAME);
  let expectedIdentity: OwnedParentIdentity;
  try {
    expectedIdentity = await dependencies.captureParentIdentity(runsParent);
  } catch {
    throw new Error("The public replay test server failed to start.");
  }
  let stop: (() => Promise<void>) | undefined;
  try {
    if (dependencies.now() >= deadline) throw new Error("startup");
    await expectMissing(runsRoot);
    const bootstrap = dependencies.resolveBootstrap();
    if (dependencies.now() >= deadline) throw new Error("startup");
    const child = dependencies.spawnChild(bootstrap, runsRoot, {
      cwd: process.cwd(),
      detached: dependencies.platform !== "win32",
      env: buildChildEnvironment(runsRoot),
    });
    const observed = observeChild(child);
    stop = createStop(runsParent, runsRoot, expectedIdentity, observed, dependencies);

    while (dependencies.now() < deadline) {
      if (isTerminal(child)) break;
      const readiness = await completeBeforeDeadline(
        async (signal) =>
          await Promise.race([
            dependencies.probeHealth(signal).then((probe) => ({ kind: "probe" as const, probe })),
            observed.error.then(() => ({ kind: "error" as const })),
            observed.close.then(() => ({ kind: "close" as const })),
          ]),
        deadline,
        dependencies,
        PROBE_TIMEOUT_MS,
      );
      if (!readiness.completed) {
        if (dependencies.now() >= deadline) break;
      } else if (readiness.value?.kind !== "probe") {
        break;
      } else if (isExactHealthyProbe(readiness.value.probe)) {
        const ownership = await completeBeforeDeadline(
          async (signal) =>
            await Promise.race([
              dependencies
                .proveOwnership(runsRoot, signal)
                .then((owned) => ({ kind: "proof" as const, owned })),
              observed.error.then(() => ({ kind: "error" as const, owned: false })),
              observed.close.then(() => ({ kind: "close" as const, owned: false })),
            ]),
          deadline,
          dependencies,
        );
        if (
          ownership.completed &&
          ownership.value?.kind === "proof" &&
          ownership.value.owned &&
          dependencies.now() < deadline
        ) {
          return { runsParent, runsRoot, stop };
        }
        break;
      }
      const remainingMs = deadline - dependencies.now();
      if (remainingMs <= 0) break;
      await dependencies.sleep(Math.min(dependencies.timeouts.pollMs, remainingMs));
    }
    throw new Error("startup");
  } catch {
    try {
      if (stop === undefined) {
        await dependencies.removeOwnedParent(runsParent, runsRoot, expectedIdentity);
      } else {
        await stop();
      }
    } catch {
      // Startup always returns one fixed error; uncertain shutdown retains the owned parent.
    }
    throw new Error("The public replay test server failed to start.");
  }
}

export async function startPublicReplayE2eServer(): Promise<PublicReplayE2eServerHandle> {
  return await startWithDependencies(defaultDependencies);
}

export const __testOnly = {
  removeOwnedParent: removeOwnedPublicReplayParent,
  startPublicReplayServer: async (
    overrides: Partial<Omit<LifecycleDependencies, "timeouts">> & {
      readonly timeouts?: Partial<LifecycleTimeouts>;
    },
  ): Promise<PublicReplayE2eServerHandle> =>
    await startWithDependencies({
      ...defaultDependencies,
      ...overrides,
      timeouts: { ...defaultDependencies.timeouts, ...overrides.timeouts },
    }),
};
