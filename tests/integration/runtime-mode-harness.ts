import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import {
  completeWithin,
  isTerminal,
  observeChild,
  requestProcessTreeTermination,
  type ObservedChild,
} from "../support/managed-process.js";

interface RuntimeTimeouts {
  readonly overallMs: number;
  readonly readinessMs: number;
  readonly probeMs: number;
  readonly terminationMs: number;
  readonly pollMs: number;
}

interface RuntimeDependencies {
  readonly reservePort: (timeoutMs: number) => Promise<number>;
  readonly spawnChild: (
    nextBin: string,
    port: number,
    environment: Record<string, string>,
  ) => ChildProcess;
  readonly probeStatus: (url: string, timeoutMs: number) => Promise<number | undefined>;
  readonly readPage: (url: string, timeoutMs: number) => Promise<string>;
  readonly requestTermination: (
    observed: ObservedChild,
    options: {
      readonly platform: NodeJS.Platform;
      readonly timeoutMs: number;
    },
  ) => Promise<void>;
  readonly platform: NodeJS.Platform;
  readonly timeouts: RuntimeTimeouts;
}

export interface RootSafety {
  mayBeInUse: boolean;
}

const defaultTimeouts: RuntimeTimeouts = {
  overallMs: 10_000,
  readinessMs: 8_000,
  probeMs: 1_000,
  terminationMs: 5_000,
  pollMs: 50,
};

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function remaining(deadline: number): number {
  return Math.max(1, deadline - Date.now());
}

async function reservePort(timeoutMs: number): Promise<number> {
  const server = createServer();
  const listening = new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const listened = await completeWithin(listening, timeoutMs);
  if (!listened.completed || listened.error !== undefined) {
    server.close();
    throw new Error("The built web server could not reserve a port.");
  }
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("The built web server could not reserve a port.");
  }
  const closed = await completeWithin(
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
    timeoutMs,
  );
  if (!closed.completed || closed.error !== undefined) {
    throw new Error("The built web server could not reserve a port.");
  }
  return address.port;
}

async function probeStatus(url: string, timeoutMs: number): Promise<number | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return (await fetch(url, { signal: controller.signal })).status;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function readPage(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (response.status !== 200) throw new Error("status");
    return await response.text();
  } catch {
    throw new Error("The built web page could not be read.");
  } finally {
    clearTimeout(timer);
  }
}

function spawnBuiltServer(
  nextBin: string,
  port: number,
  environment: Record<string, string>,
): ChildProcess {
  return spawn(
    process.execPath,
    [nextBin, "start", "--hostname", "127.0.0.1", "--port", `${port}`],
    {
      cwd: process.cwd(),
      detached: process.platform !== "win32",
      env: { ...process.env, ...environment },
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    },
  );
}

const defaultDependencies: RuntimeDependencies = {
  reservePort,
  spawnChild: spawnBuiltServer,
  probeStatus,
  readPage,
  requestTermination: async (observed, options) =>
    await requestProcessTreeTermination(observed, options),
  platform: process.platform,
  timeouts: defaultTimeouts,
};

export function createRootSafety(): RootSafety {
  return { mayBeInUse: false };
}

async function waitForReady(
  url: string,
  observed: ObservedChild,
  dependencies: RuntimeDependencies,
  operationDeadline: number,
): Promise<void> {
  const readinessDeadline = Math.min(
    operationDeadline,
    Date.now() + dependencies.timeouts.readinessMs,
  );
  while (Date.now() < readinessDeadline) {
    if (isTerminal(observed.child)) {
      throw new Error("The built web server stopped before becoming ready.");
    }
    const status = await Promise.race([
      dependencies
        .probeStatus(url, Math.min(dependencies.timeouts.probeMs, remaining(readinessDeadline)))
        .then((value) => ({ kind: "probe" as const, value })),
      observed.error.then(() => ({ kind: "error" as const })),
      observed.close.then(() => ({ kind: "close" as const })),
    ]);
    if (status.kind === "probe" && status.value === 200) return;
    if (status.kind !== "probe") {
      throw new Error("The built web server stopped before becoming ready.");
    }
    await sleep(Math.min(dependencies.timeouts.pollMs, remaining(readinessDeadline)));
  }
  throw new Error("The built web server did not become ready.");
}

async function waitForRelease(url: string, dependencies: RuntimeDependencies): Promise<boolean> {
  const deadline = Date.now() + dependencies.timeouts.terminationMs;
  while (Date.now() < deadline) {
    const status = await dependencies.probeStatus(
      url,
      Math.min(dependencies.timeouts.probeMs, remaining(deadline)),
    );
    if (status === undefined) return true;
    await sleep(Math.min(dependencies.timeouts.pollMs, remaining(deadline)));
  }
  return false;
}

async function stopBuiltServer(
  url: string,
  observed: ObservedChild,
  dependencies: RuntimeDependencies,
): Promise<void> {
  try {
    await dependencies.requestTermination(observed, {
      platform: dependencies.platform,
      timeoutMs: dependencies.timeouts.terminationMs,
    });
    const closed = await completeWithin(observed.close, dependencies.timeouts.terminationMs);
    if (!closed.completed || !(await waitForRelease(url, dependencies))) {
      throw new Error("uncertain");
    }
  } catch {
    throw new Error("The built web server could not be stopped.");
  }
}

export async function renderBuiltPage(
  nextBin: string,
  environment: Record<string, string>,
  rootSafety: RootSafety,
  overrides: Partial<Omit<RuntimeDependencies, "timeouts">> & {
    readonly timeouts?: Partial<RuntimeTimeouts>;
  } = {},
): Promise<string> {
  const dependencies: RuntimeDependencies = {
    ...defaultDependencies,
    ...overrides,
    timeouts: { ...defaultDependencies.timeouts, ...overrides.timeouts },
  };
  const operationDeadline = Date.now() + dependencies.timeouts.overallMs;
  const port = await dependencies.reservePort(
    Math.min(dependencies.timeouts.probeMs, remaining(operationDeadline)),
  );
  let observed: ObservedChild;
  try {
    observed = observeChild(dependencies.spawnChild(nextBin, port, environment));
  } catch {
    throw new Error("The built web server could not be started.");
  }
  const url = `http://127.0.0.1:${port}/`;
  rootSafety.mayBeInUse = true;
  let result: string | undefined;
  let operationError: unknown;
  try {
    await waitForReady(url, observed, dependencies, operationDeadline);
    if (Date.now() >= operationDeadline) {
      throw new Error("The built web page could not be read.");
    }
    result = await dependencies.readPage(
      url,
      Math.min(dependencies.timeouts.probeMs, remaining(operationDeadline)),
    );
  } catch (error) {
    operationError = error;
  }

  await stopBuiltServer(url, observed, dependencies);
  rootSafety.mayBeInUse = false;
  if (operationError !== undefined) throw operationError;
  if (result === undefined) throw new Error("The built web page could not be read.");
  return result;
}

export const __testOnly = {
  completeWithin: async (promise: Promise<unknown>, milliseconds: number): Promise<boolean> =>
    (await completeWithin(promise, milliseconds)).completed,
  isTerminal,
  probeStatus,
  waitForClose: (child: ChildProcess): Promise<void> => observeChild(child).close,
};
