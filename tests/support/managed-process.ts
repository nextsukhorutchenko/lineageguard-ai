import { spawn, type ChildProcess } from "node:child_process";

export interface ObservedChild {
  readonly child: ChildProcess;
  readonly close: Promise<void>;
  readonly error: Promise<Error>;
}

export interface Completion<T> {
  readonly completed: boolean;
  readonly value?: T;
  readonly error?: unknown;
}

export function isTerminal(child: Pick<ChildProcess, "exitCode" | "signalCode">): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

export function observeChild(child: ChildProcess): ObservedChild {
  const close = isTerminal(child)
    ? Promise.resolve()
    : new Promise<void>((resolve) => child.once("close", () => resolve()));
  const error = new Promise<Error>((resolve) =>
    child.once("error", (childError) => resolve(childError)),
  );
  return { child, close, error };
}

export async function completeWithin<T>(
  promise: Promise<T>,
  milliseconds: number,
): Promise<Completion<T>> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then(
        (value): Completion<T> => ({ completed: true, value }),
        (error: unknown): Completion<T> => ({ completed: true, error }),
      ),
      new Promise<Completion<T>>((resolve) => {
        timer = setTimeout(() => resolve({ completed: false }), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function bestEffortDirectKill(observed: ObservedChild, timeoutMs: number): Promise<void> {
  if (!isTerminal(observed.child)) observed.child.kill();
  await completeWithin(observed.close, timeoutMs);
}

function processGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { readonly code?: unknown }).code === "ESRCH"
    ) {
      return false;
    }
    throw error;
  }
}

async function waitForProcessGroupExit(pid: number, deadline: number): Promise<boolean> {
  while (Date.now() < deadline) {
    if (!processGroupExists(pid)) return true;
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.min(25, Math.max(1, deadline - Date.now()))),
    );
  }
  return !processGroupExists(pid);
}

export async function requestProcessTreeTermination(
  observed: ObservedChild,
  options: {
    readonly platform: NodeJS.Platform;
    readonly timeoutMs: number;
    readonly spawnTreeKiller?: (pid: number) => ChildProcess;
  },
): Promise<void> {
  if (isTerminal(observed.child)) return;
  const pid = observed.child.pid;
  if (pid === undefined) {
    const spawnOutcome = await completeWithin(
      Promise.race([observed.error.then(() => undefined), observed.close.then(() => undefined)]),
      options.timeoutMs,
    );
    if (!spawnOutcome.completed) throw new Error("process");
    return;
  }

  if (options.platform === "win32") {
    const killer =
      options.spawnTreeKiller?.(pid) ??
      spawn("taskkill", ["/PID", `${pid}`, "/T", "/F"], {
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      });
    const observedKiller = observeChild(killer);
    const killerOutcome = await completeWithin(
      Promise.race([
        observedKiller.close.then(() => ({ kind: "close" as const })),
        observedKiller.error.then(() => ({ kind: "error" as const })),
      ]),
      options.timeoutMs,
    );
    if (!killerOutcome.completed || killerOutcome.value?.kind === "error") {
      if (!isTerminal(killer)) killer.kill();
      const reaped = await completeWithin(observedKiller.close, options.timeoutMs);
      await bestEffortDirectKill(observed, options.timeoutMs);
      if (!reaped.completed) throw new Error("killer");
      throw new Error("tree");
    }

    if (killer.exitCode !== 0) {
      await bestEffortDirectKill(observed, options.timeoutMs);
      throw new Error("tree");
    }
    return;
  }

  const deadline = Date.now() + options.timeoutMs;
  try {
    process.kill(-pid, "SIGTERM");
  } catch (error) {
    if (!processGroupExists(pid)) return;
    throw error;
  }
  const termDeadline = Math.min(
    deadline,
    Date.now() + Math.max(1, Math.floor(options.timeoutMs / 2)),
  );
  if (await waitForProcessGroupExit(pid, termDeadline)) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (!processGroupExists(pid)) return;
    throw error;
  }
  if (!(await waitForProcessGroupExit(pid, deadline))) throw new Error("tree");
}
