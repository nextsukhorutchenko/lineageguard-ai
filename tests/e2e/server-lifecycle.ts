import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  completeWithin,
  isTerminal,
  observeChild,
  requestProcessTreeTermination,
  type ObservedChild,
} from "../support/managed-process.js";
import { removeOwnedRunsRoot } from "./global-teardown.js";

const HOST = "127.0.0.1";
const PORT = 3107;
const BASE_URL = `http://${HOST}:${PORT}`;
const RUNS_PREFIX = "lineageguard-playwright-runs-";
const STARTUP_TIMEOUT_MS = 120_000;
const PROBE_TIMEOUT_MS = 1_000;
const POLL_INTERVAL_MS = 100;
const TERMINATION_TIMEOUT_MS = 10_000;
const DIAGNOSTIC_TAIL_BYTES = 16_384;

export interface E2eServerHandle {
  readonly runsRoot: string;
  stop(): Promise<void>;
}

interface LifecycleTimeouts {
  readonly startupMs: number;
  readonly terminationMs: number;
  readonly pollMs: number;
}

interface LifecycleDependencies {
  readonly probe: () => Promise<number | undefined>;
  readonly createRunsRoot: () => Promise<string>;
  readonly resolveNextCli: () => string;
  readonly spawnChild: (nextCli: string, runsRoot: string) => ChildProcess;
  readonly spawnTreeKiller?: (pid: number) => ChildProcess;
  readonly removeRunsRoot: (runsRoot: string) => Promise<void>;
  readonly platform: NodeJS.Platform;
  readonly timeouts: LifecycleTimeouts;
}

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function probe(): Promise<number | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    return (await fetch(`${BASE_URL}/`, { signal: controller.signal })).status;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function appendTail(
  current: Buffer<ArrayBufferLike>,
  value: Buffer<ArrayBufferLike>,
): Buffer<ArrayBufferLike> {
  const joined = Buffer.concat([current, value]);
  return joined.subarray(Math.max(0, joined.byteLength - DIAGNOSTIC_TAIL_BYTES));
}

function spawnNext(nextCli: string, runsRoot: string): ChildProcess {
  return spawn(
    process.execPath,
    [nextCli, "dev", "--webpack", "--hostname", HOST, "--port", `${PORT}`],
    {
      cwd: process.cwd(),
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        LINEAGEGUARD_DEMO_MODE: "REPLAY",
        LINEAGEGUARD_RUNS_DIR: runsRoot,
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
}

const defaultDependencies: LifecycleDependencies = {
  probe,
  createRunsRoot: async () => await mkdtemp(join(tmpdir(), RUNS_PREFIX)),
  resolveNextCli: () => createRequire(import.meta.url).resolve("next/dist/bin/next"),
  spawnChild: spawnNext,
  removeRunsRoot: removeOwnedRunsRoot,
  platform: process.platform,
  timeouts: {
    startupMs: STARTUP_TIMEOUT_MS,
    terminationMs: TERMINATION_TIMEOUT_MS,
    pollMs: POLL_INTERVAL_MS,
  },
};

async function waitForEndpointRelease(
  probeEndpoint: () => Promise<number | undefined>,
  timeoutMs: number,
  pollMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await probeEndpoint()) === undefined) return true;
    await sleep(pollMs);
  }
  return false;
}

function createStop(
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
        observed.child.stdout?.destroy();
        observed.child.stderr?.destroy();
        const childClosed = await completeWithin(
          observed.close,
          dependencies.timeouts.terminationMs,
        );
        if (!childClosed.completed) throw new Error("close");
        if (
          !(await waitForEndpointRelease(
            dependencies.probe,
            dependencies.timeouts.terminationMs,
            dependencies.timeouts.pollMs,
          ))
        ) {
          throw new Error("endpoint");
        }
        await dependencies.removeRunsRoot(runsRoot);
      } catch {
        throw new Error("The Playwright test server could not be stopped.");
      }
    })();
    return shutdown;
  };
}

async function startWithDependencies(
  dependencies: LifecycleDependencies,
): Promise<E2eServerHandle> {
  if ((await dependencies.probe()) !== undefined) {
    throw new Error("The Playwright test endpoint is already in use.");
  }

  const runsRoot = await dependencies.createRunsRoot();
  let observed: ObservedChild | undefined;
  let stop: (() => Promise<void>) | undefined;
  try {
    const nextCli = dependencies.resolveNextCli();
    const child = dependencies.spawnChild(nextCli, runsRoot);
    observed = observeChild(child);
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    child.stdout?.on("data", (value: Buffer) => {
      stdout = appendTail(stdout, value);
    });
    child.stderr?.on("data", (value: Buffer) => {
      stderr = appendTail(stderr, value);
    });
    stop = createStop(runsRoot, observed, dependencies);

    const deadline = Date.now() + dependencies.timeouts.startupMs;
    while (Date.now() < deadline) {
      if (isTerminal(child)) break;
      const readiness = await Promise.race([
        dependencies.probe().then((status) => ({ kind: "probe" as const, status })),
        observed.error.then(() => ({ kind: "error" as const })),
        observed.close.then(() => ({ kind: "close" as const })),
      ]);
      if (readiness.kind === "probe" && readiness.status === 200) {
        return { runsRoot, stop };
      }
      if (readiness.kind !== "probe") break;
      await sleep(dependencies.timeouts.pollMs);
    }
    void stdout;
    void stderr;
    throw new Error("startup");
  } catch {
    try {
      if (stop !== undefined) {
        await stop();
      } else {
        await dependencies.removeRunsRoot(runsRoot);
      }
    } catch {
      // Startup always exposes one fixed error; uncertain shutdown retains the root.
    }
    throw new Error("The Playwright test server failed to start.");
  }
}

export async function startE2eServer(): Promise<E2eServerHandle> {
  return await startWithDependencies(defaultDependencies);
}

export const __testOnly = {
  appendTail,
  completeWithin: async (promise: Promise<unknown>, milliseconds: number): Promise<boolean> =>
    (await completeWithin(promise, milliseconds)).completed,
  isTerminal,
  startE2eServer: async (
    overrides: Partial<Omit<LifecycleDependencies, "timeouts">> & {
      readonly timeouts?: Partial<LifecycleTimeouts>;
    },
  ): Promise<E2eServerHandle> =>
    await startWithDependencies({
      ...defaultDependencies,
      ...overrides,
      timeouts: { ...defaultDependencies.timeouts, ...overrides.timeouts },
    }),
  waitForClose: (child: ChildProcess): Promise<void> => observeChild(child).close,
};
