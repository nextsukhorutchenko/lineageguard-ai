import { spawn, type ChildProcess } from "node:child_process";
import { access, lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
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
  readonly dev?: number;
  readonly ino?: number;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
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
  readonly remove: (path: string) => Promise<void>;
}

interface LifecycleDependencies {
  readonly isEndpointOccupied: () => Promise<boolean>;
  readonly probeHealth: () => Promise<HealthProbe | undefined>;
  readonly createTemporaryParent: () => Promise<string>;
  readonly resolveBootstrap: () => string;
  readonly spawnChild: (
    bootstrap: string,
    runsRoot: string,
    options: PublicReplayChildOptions,
  ) => ChildProcess;
  readonly spawnTreeKiller?: (pid: number) => ChildProcess;
  readonly removeOwnedParent: (runsParent: string, runsRoot: string) => Promise<void>;
  readonly platform: NodeJS.Platform;
  readonly timeouts: LifecycleTimeouts;
}

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === code
  );
}

async function endpointIsOccupied(): Promise<boolean> {
  return await new Promise<boolean>((resolveResult) => {
    const socket = createConnection({ host: HOST, port: PORT });
    let settled = false;
    const finish = (occupied: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveResult(occupied);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(PROBE_TIMEOUT_MS, () => finish(false));
  });
}

async function probeHealth(): Promise<HealthProbe | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(HEALTH_URL, {
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_HEALTH_BYTES) return { status: response.status, body: undefined };
    const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    return { status: response.status, body };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
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

function sameIdentity(first: OwnedPathStats, second: OwnedPathStats): boolean {
  return (
    first.dev === undefined ||
    first.ino === undefined ||
    second.dev === undefined ||
    second.ino === undefined ||
    (first.dev === second.dev && first.ino === second.ino)
  );
}

async function removeOwnedParentWithDependencies(
  runsParent: string,
  runsRoot: string,
  dependencies: CleanupDependencies,
): Promise<void> {
  try {
    if (!isAbsolute(runsParent) || !isAbsolute(runsRoot)) throw new Error("boundary");
    const expectedParent = resolve(runsParent);
    const expectedRoot = resolve(runsRoot);
    if (relative(expectedParent, expectedRoot) !== RUNS_CHILD_NAME) throw new Error("boundary");

    const parentStats = await dependencies.lstat(expectedParent);
    if (parentStats.isSymbolicLink() || !parentStats.isDirectory()) throw new Error("boundary");
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

    const finalParentStats = await dependencies.lstat(expectedParent);
    if (
      finalParentStats.isSymbolicLink() ||
      !finalParentStats.isDirectory() ||
      !sameIdentity(parentStats, finalParentStats)
    ) {
      throw new Error("boundary");
    }
    await dependencies.remove(canonicalParent);
    await expectMissing(canonicalParent);
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
  overrides: Partial<CleanupDependencies> = {},
): Promise<void> {
  await removeOwnedParentWithDependencies(runsParent, runsRoot, {
    lstat,
    realpath,
    remove: async (path) => await rm(path, { recursive: true, force: true }),
    ...overrides,
  });
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
  createTemporaryParent: async () => await mkdtemp(join(tmpdir(), OWNED_PARENT_PREFIX)),
  resolveBootstrap: () => resolve(process.cwd(), "dist", "hosting", "start-public-replay.js"),
  spawnChild: defaultSpawnChild,
  removeOwnedParent: removeOwnedPublicReplayParent,
  platform: process.platform,
  timeouts: {
    startupMs: STARTUP_TIMEOUT_MS,
    terminationMs: TERMINATION_TIMEOUT_MS,
    pollMs: POLL_INTERVAL_MS,
  },
};

async function waitForEndpointRelease(
  isEndpointOccupied: () => Promise<boolean>,
  timeoutMs: number,
  pollMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isEndpointOccupied())) return true;
    await sleep(pollMs);
  }
  return false;
}

function createStop(
  runsParent: string,
  runsRoot: string,
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
        if (
          !(await waitForEndpointRelease(
            dependencies.isEndpointOccupied,
            dependencies.timeouts.terminationMs,
            dependencies.timeouts.pollMs,
          ))
        ) {
          throw new Error("endpoint");
        }
        await dependencies.removeOwnedParent(runsParent, runsRoot);
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
  if (await dependencies.isEndpointOccupied()) {
    throw new Error("The public replay test endpoint is already in use.");
  }

  let runsParent: string;
  try {
    runsParent = await dependencies.createTemporaryParent();
  } catch {
    throw new Error("The public replay test server failed to start.");
  }
  const runsRoot = join(runsParent, RUNS_CHILD_NAME);
  let stop: (() => Promise<void>) | undefined;
  try {
    await expectMissing(runsRoot);
    const bootstrap = dependencies.resolveBootstrap();
    const child = dependencies.spawnChild(bootstrap, runsRoot, {
      cwd: process.cwd(),
      detached: dependencies.platform !== "win32",
      env: buildChildEnvironment(runsRoot),
    });
    const observed = observeChild(child);
    stop = createStop(runsParent, runsRoot, observed, dependencies);

    const deadline = Date.now() + dependencies.timeouts.startupMs;
    while (Date.now() < deadline) {
      if (isTerminal(child)) break;
      const readiness = await Promise.race([
        dependencies.probeHealth().then((probe) => ({ kind: "probe" as const, probe })),
        observed.error.then(() => ({ kind: "error" as const })),
        observed.close.then(() => ({ kind: "close" as const })),
      ]);
      if (readiness.kind === "probe" && isExactHealthyProbe(readiness.probe)) {
        return { runsParent, runsRoot, stop };
      }
      if (readiness.kind !== "probe") break;
      await sleep(dependencies.timeouts.pollMs);
    }
    throw new Error("startup");
  } catch {
    try {
      if (stop === undefined) {
        await dependencies.removeOwnedParent(runsParent, runsRoot);
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
