import { createRequire } from "node:module";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
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

function appendTail(current: string, value: Buffer): string {
  return `${current}${value.toString("utf8")}`.slice(-DIAGNOSTIC_TAIL_BYTES);
}

function waitForClose(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("close", () => resolve()));
}

async function completesWithin(promise: Promise<unknown>, milliseconds: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", `${child.pid}`, "/T", "/F"], {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    await completesWithin(
      new Promise<void>((resolve) => killer.once("close", () => resolve())),
      TERMINATION_TIMEOUT_MS,
    );
    if (child.exitCode === null) child.kill();
  } else {
    process.kill(-(child.pid ?? 0), "SIGTERM");
    if (!(await completesWithin(waitForClose(child), TERMINATION_TIMEOUT_MS))) {
      process.kill(-(child.pid ?? 0), "SIGKILL");
    }
  }
}

export async function startE2eServer(): Promise<E2eServerHandle> {
  if ((await probe()) !== undefined)
    throw new Error("The Playwright test endpoint is already in use.");
  const runsRoot = await mkdtemp(join(tmpdir(), RUNS_PREFIX));
  const require = createRequire(import.meta.url);
  const nextCli = require.resolve("next/dist/bin/next");
  let stdout = "";
  let stderr = "";
  const child = spawn(
    process.execPath,
    [nextCli, "dev", "--webpack", "--hostname", HOST, "--port", `${PORT}`],
    {
      cwd: process.cwd(),
      detached: process.platform !== "win32",
      env: { ...process.env, LINEAGEGUARD_DEMO_MODE: "REPLAY", LINEAGEGUARD_RUNS_DIR: runsRoot },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  child.stdout?.on("data", (value: Buffer) => {
    stdout = appendTail(stdout, value);
  });
  child.stderr?.on("data", (value: Buffer) => {
    stderr = appendTail(stderr, value);
  });
  const close = waitForClose(child);
  let shutdown: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    shutdown ??= (async () => {
      try {
        await terminate(child);
        child.stdout?.destroy();
        child.stderr?.destroy();
        if (!(await completesWithin(close, TERMINATION_TIMEOUT_MS))) throw new Error("close");
        const deadline = Date.now() + TERMINATION_TIMEOUT_MS;
        while (Date.now() < deadline) {
          if ((await probe()) === undefined) {
            await removeOwnedRunsRoot(runsRoot);
            return;
          }
          await sleep(POLL_INTERVAL_MS);
        }
        throw new Error("endpoint");
      } catch {
        throw new Error("The Playwright test server could not be stopped.");
      }
    })();
    return shutdown;
  };
  try {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) break;
      if ((await probe()) === 200) return { runsRoot, stop };
      await sleep(POLL_INTERVAL_MS);
    }
  } catch {
    // The fixed startup error remains authoritative.
  }
  void stdout;
  void stderr;
  try {
    await stop();
  } catch {
    // The fixed startup error remains authoritative.
  }
  throw new Error("The Playwright test server failed to start.");
}
