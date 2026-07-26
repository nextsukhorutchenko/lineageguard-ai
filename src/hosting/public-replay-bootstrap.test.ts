import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { constants } from "node:fs";
import { access, chmod, lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  preparePublicReplayEnvironment,
  runPublicReplayServer,
  type PublicReplayBootstrapDependencies,
  type PublicReplayProcessBoundary,
  type PublicReplaySpawnOptions,
} from "./public-replay-bootstrap.js";

const ownedSandboxes: string[] = [];

async function freshSandbox(): Promise<string> {
  const sandbox = await mkdtemp(join(tmpdir(), "lineageguard-public-bootstrap-"));
  ownedSandboxes.push(sandbox);
  return sandbox;
}

function publicEnvironment(
  runsRoot: string,
  overrides: Readonly<Record<string, string | undefined>> = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    LINEAGEGUARD_DEMO_MODE: "REPLAY",
    LINEAGEGUARD_DEPLOYMENT_PROFILE: "PUBLIC_REPLAY",
    LINEAGEGUARD_RUNS_DIR: runsRoot,
    PORT: "3000",
    ...overrides,
  };
}

function directoryStats(
  dev: number,
  ino: number,
  options: { readonly directory?: boolean; readonly symbolicLink?: boolean } = {},
) {
  return {
    dev,
    ino,
    isDirectory: () => options.directory ?? true,
    isSymbolicLink: () => options.symbolicLink ?? false,
  };
}

afterEach(async () => {
  await Promise.all(
    ownedSandboxes.splice(0).map(async (sandbox) => {
      await rm(sandbox, { recursive: true, force: true });
    }),
  );
});

describe("preparePublicReplayEnvironment", () => {
  it("creates only the configured missing root with private permissions", async () => {
    const sandbox = await freshSandbox();
    const runsRoot = join(sandbox, "runs");
    const mkdirCalls: Array<{ readonly path: string; readonly mode: number }> = [];
    let pathnameChmodCalled = false;
    const dependencies = {
      chmod: async (path: string, mode: number) => {
        pathnameChmodCalled = true;
        await chmod(path, mode);
      },
      mkdir: async (path: string, options: { readonly mode: number }) => {
        mkdirCalls.push({ path, mode: options.mode });
        await mkdir(path, options);
      },
    };

    const prepared = await preparePublicReplayEnvironment(
      publicEnvironment(runsRoot),
      dependencies,
    );

    expect(prepared.runsRoot).toBe(await realpath(runsRoot));
    expect((await lstat(runsRoot)).isDirectory()).toBe(true);
    expect(mkdirCalls).toEqual([{ path: runsRoot, mode: 0o700 }]);
    expect(pathnameChmodCalled).toBe(false);
  });

  it("does not recursively create a missing parent", async () => {
    const sandbox = await freshSandbox();
    const missingParent = join(sandbox, "missing-parent");
    const runsRoot = join(missingParent, "runs");

    await expect(preparePublicReplayEnvironment(publicEnvironment(runsRoot))).rejects.toThrow(
      "Public replay environment is invalid.",
    );
    await expect(access(missingParent)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("accepts and normalizes an existing real writable root", async () => {
    const sandbox = await freshSandbox();
    const runsRoot = join(sandbox, "runs");
    await mkdir(runsRoot);
    let checkedAccess: { readonly path: string; readonly mode?: number } | undefined;

    const prepared = await preparePublicReplayEnvironment(publicEnvironment(runsRoot), {
      access: async (path, mode) => {
        checkedAccess = mode === undefined ? { path } : { path, mode };
        await access(path, mode);
      },
    });

    const canonicalRoot = await realpath(runsRoot);
    expect(prepared.runsRoot).toBe(canonicalRoot);
    expect(checkedAccess).toEqual({ path: canonicalRoot, mode: constants.W_OK });
  });

  it("rejects a relative root before touching the filesystem", async () => {
    let mkdirCalled = false;

    await expect(
      preparePublicReplayEnvironment(publicEnvironment("relative-runs"), {
        mkdir: async () => {
          mkdirCalled = true;
        },
      }),
    ).rejects.toThrow("Public replay environment is invalid.");
    expect(mkdirCalled).toBe(false);
  });

  it("rejects an existing regular file", async () => {
    const sandbox = await freshSandbox();
    const runsRoot = join(sandbox, "runs");
    await writeFile(runsRoot, "not a directory", "utf8");

    await expect(preparePublicReplayEnvironment(publicEnvironment(runsRoot))).rejects.toThrow(
      "Public replay environment is invalid.",
    );
  });

  it("rejects a symbolic-link root before changing permissions", async () => {
    const sandbox = await freshSandbox();
    const runsRoot = join(sandbox, "runs");
    let openDirectoryCalled = false;

    await expect(
      preparePublicReplayEnvironment(publicEnvironment(runsRoot), {
        mkdir: async () => {
          throw Object.assign(new Error("exists"), { code: "EEXIST" });
        },
        lstat: async () => directoryStats(1, 1, { symbolicLink: true }),
        openDirectory: async () => {
          openDirectoryCalled = true;
          throw new Error("must not open");
        },
      }),
    ).rejects.toThrow("Public replay environment is invalid.");
    expect(openDirectoryCalled).toBe(false);
  });

  it("rejects a root whose canonical path differs", async () => {
    const sandbox = await freshSandbox();
    const runsRoot = join(sandbox, "runs");

    await expect(
      preparePublicReplayEnvironment(publicEnvironment(runsRoot), {
        realpath: async () => join(sandbox, "different-root"),
      }),
    ).rejects.toThrow("Public replay environment is invalid.");
  });

  it("rejects a root that is not writable", async () => {
    const sandbox = await freshSandbox();
    const runsRoot = join(sandbox, "runs");

    await expect(
      preparePublicReplayEnvironment(publicEnvironment(runsRoot), {
        access: async () => {
          throw Object.assign(new Error("private operating-system detail"), { code: "EACCES" });
        },
      }),
    ).rejects.toThrow("Public replay environment is invalid.");
  });

  it.each(["", "0", "-1", "1.5", "3000suffix", "65536", "9007199254740991"])(
    "rejects invalid port %j before touching the filesystem",
    async (port) => {
      const sandbox = await freshSandbox();
      let mkdirCalled = false;

      await expect(
        preparePublicReplayEnvironment(publicEnvironment(join(sandbox, "runs"), { PORT: port }), {
          mkdir: async () => {
            mkdirCalled = true;
          },
        }),
      ).rejects.toThrow("Public replay environment is invalid.");
      expect(mkdirCalled).toBe(false);
    },
  );

  it.each(["1", "65535"])("accepts boundary port %s", async (port) => {
    const sandbox = await freshSandbox();

    const prepared = await preparePublicReplayEnvironment(
      publicEnvironment(join(sandbox, "runs"), { PORT: port }),
    );

    expect(prepared.port).toBe(Number(port));
  });

  it.each([{ LINEAGEGUARD_DEPLOYMENT_PROFILE: "LOCAL" }, { LINEAGEGUARD_DEMO_MODE: "LIVE" }])(
    "requires PUBLIC_REPLAY with REPLAY %#",
    async (overrides) => {
      const sandbox = await freshSandbox();

      await expect(
        preparePublicReplayEnvironment(publicEnvironment(join(sandbox, "runs"), overrides)),
      ).rejects.toThrow("Public replay environment is invalid.");
    },
  );

  it.each(["OPENAI_API_KEY", "DATAHUB_GMS_TOKEN"] as const)(
    "rejects a non-empty %s without exposing its value",
    async (credential) => {
      const sandbox = await freshSandbox();
      const secret = "active-private-sentinel";
      let caught: unknown;
      try {
        await preparePublicReplayEnvironment(
          publicEnvironment(join(sandbox, "runs"), { [credential]: secret }),
        );
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe("Public replay environment is invalid.");
      expect((caught as Error).message).not.toContain(secret);
    },
  );

  it("passes only allowlisted operating-system and Node values plus exact application keys", async () => {
    const sandbox = await freshSandbox();
    const runsRoot = join(sandbox, "runs");
    const prepared = await preparePublicReplayEnvironment(
      publicEnvironment(runsRoot, {
        PATH: "approved-path",
        NODE_OPTIONS: "--max-old-space-size=256",
        OPENAI_API_KEY: "",
        DATAHUB_GMS_TOKEN: "",
        GITHUB_TOKEN: "unrelated-secret",
        UNRELATED_SENTINEL: "must-not-reach-child",
      }),
    );

    expect(prepared.childEnvironment).toEqual({
      PATH: "approved-path",
      NODE_OPTIONS: "--max-old-space-size=256",
      NODE_ENV: "production",
      PORT: "3000",
      LINEAGEGUARD_DEMO_MODE: "REPLAY",
      LINEAGEGUARD_DEPLOYMENT_PROFILE: "PUBLIC_REPLAY",
      LINEAGEGUARD_RUNS_DIR: await realpath(runsRoot),
      NEXT_TELEMETRY_DISABLED: "1",
    });
    expect(prepared.childEnvironment).not.toHaveProperty("GITHUB_TOKEN");
    expect(prepared.childEnvironment).not.toHaveProperty("UNRELATED_SENTINEL");
  });

  it("accepts only EEXIST from root creation", async () => {
    const sandbox = await freshSandbox();
    const runsRoot = resolve(sandbox, "runs");
    const dependencies: Partial<PublicReplayBootstrapDependencies> = {
      mkdir: async () => {
        throw Object.assign(new Error("native failure"), { code: "EACCES" });
      },
    };

    await expect(
      preparePublicReplayEnvironment(publicEnvironment(runsRoot), dependencies),
    ).rejects.toThrow("Public replay environment is invalid.");
  });

  it("fails closed when a symlink replaces the root before no-follow open", async () => {
    const sandbox = await freshSandbox();
    const runsRoot = join(sandbox, "runs");
    let unrelatedTargetMode = 0o755;
    let openedFlags: number | undefined;
    const dependencies = {
      platform: "linux" as const,
      directoryOpenFlags: 0x3_0000,
      mkdir: async () => {
        throw Object.assign(new Error("exists"), { code: "EEXIST" });
      },
      lstat: async () => directoryStats(11, 12),
      openDirectory: async (_path: string, flags: number) => {
        openedFlags = flags;
        throw Object.assign(new Error("replacement symlink"), { code: "ELOOP" });
      },
      chmod: async () => {
        unrelatedTargetMode = 0o700;
      },
      realpath: async () => runsRoot,
      access: async () => undefined,
      assertRunsRoot: async () => runsRoot,
    };

    await expect(
      preparePublicReplayEnvironment(publicEnvironment(runsRoot), dependencies),
    ).rejects.toThrow("Public replay environment is invalid.");
    expect(openedFlags).toBe(0x3_0000);
    expect(unrelatedTargetMode).toBe(0o755);
  });

  it("fails closed when the same path becomes a symlink after handle open", async () => {
    const sandbox = await freshSandbox();
    const runsRoot = join(sandbox, "runs");
    let pathnameChecks = 0;
    let originalMode = 0o755;
    let unrelatedTargetMode = 0o755;
    let handleClosed = false;
    const dependencies = {
      platform: "linux" as const,
      directoryOpenFlags: 0x3_0000,
      mkdir: async () => {
        throw Object.assign(new Error("exists"), { code: "EEXIST" });
      },
      lstat: async () => {
        pathnameChecks += 1;
        return pathnameChecks === 1
          ? directoryStats(21, 22)
          : directoryStats(31, 32, { symbolicLink: true });
      },
      openDirectory: async () => ({
        stat: async () => directoryStats(21, 22),
        chmod: async (mode: number) => {
          originalMode = mode;
        },
        close: async () => {
          handleClosed = true;
        },
      }),
      chmod: async () => {
        unrelatedTargetMode = 0o700;
      },
      realpath: async () => runsRoot,
      access: async () => undefined,
      assertRunsRoot: async () => runsRoot,
    };

    await expect(
      preparePublicReplayEnvironment(publicEnvironment(runsRoot), dependencies),
    ).rejects.toThrow("Public replay environment is invalid.");
    expect(originalMode).toBe(0o700);
    expect(unrelatedTargetMode).toBe(0o755);
    expect(handleClosed).toBe(true);
  });

  it("rejects a directory-handle identity mismatch before permission mutation", async () => {
    const sandbox = await freshSandbox();
    const runsRoot = join(sandbox, "runs");
    let handleChmodCalled = false;
    let handleClosed = false;
    const dependencies = {
      platform: "linux" as const,
      directoryOpenFlags: 0x3_0000,
      mkdir: async () => {
        throw Object.assign(new Error("exists"), { code: "EEXIST" });
      },
      lstat: async () => directoryStats(41, 42),
      openDirectory: async () => ({
        stat: async () => directoryStats(51, 52),
        chmod: async () => {
          handleChmodCalled = true;
        },
        close: async () => {
          handleClosed = true;
        },
      }),
      chmod: async () => undefined,
      realpath: async () => runsRoot,
      access: async () => undefined,
      assertRunsRoot: async () => runsRoot,
    };

    await expect(
      preparePublicReplayEnvironment(publicEnvironment(runsRoot), dependencies),
    ).rejects.toThrow("Public replay environment is invalid.");
    expect(handleChmodCalled).toBe(false);
    expect(handleClosed).toBe(true);
  });

  it("rejects a canonical mismatch before opening or changing the directory", async () => {
    const sandbox = await freshSandbox();
    const runsRoot = join(sandbox, "runs");
    let handleOpened = false;
    let handleChmodCalled = false;
    const dependencies = {
      platform: "linux" as const,
      directoryOpenFlags: 0x3_0000,
      mkdir: async () => {
        throw Object.assign(new Error("exists"), { code: "EEXIST" });
      },
      lstat: async () => directoryStats(56, 57),
      openDirectory: async () => {
        handleOpened = true;
        return {
          stat: async () => directoryStats(56, 57),
          chmod: async () => {
            handleChmodCalled = true;
          },
          close: async () => undefined,
        };
      },
      chmod: async () => undefined,
      realpath: async () => join(sandbox, "different-root"),
      access: async () => undefined,
      assertRunsRoot: async () => runsRoot,
    };

    await expect(
      preparePublicReplayEnvironment(publicEnvironment(runsRoot), dependencies),
    ).rejects.toThrow("Public replay environment is invalid.");
    expect(handleOpened).toBe(false);
    expect(handleChmodCalled).toBe(false);
  });

  it("fails closed when directory-handle stat is uncertain", async () => {
    const sandbox = await freshSandbox();
    const runsRoot = join(sandbox, "runs");
    let handleClosed = false;
    const dependencies = {
      platform: "linux" as const,
      directoryOpenFlags: 0x3_0000,
      mkdir: async () => {
        throw Object.assign(new Error("exists"), { code: "EEXIST" });
      },
      lstat: async () => directoryStats(61, 62),
      openDirectory: async () => ({
        stat: async () => {
          throw new Error("private fstat detail");
        },
        chmod: async () => undefined,
        close: async () => {
          handleClosed = true;
        },
      }),
      chmod: async () => undefined,
      realpath: async () => runsRoot,
      access: async () => undefined,
      assertRunsRoot: async () => runsRoot,
    };

    await expect(
      preparePublicReplayEnvironment(publicEnvironment(runsRoot), dependencies),
    ).rejects.toThrow("Public replay environment is invalid.");
    expect(handleClosed).toBe(true);
  });

  it("fails closed when the directory handle cannot be closed", async () => {
    const sandbox = await freshSandbox();
    const runsRoot = join(sandbox, "runs");
    const dependencies = {
      platform: "linux" as const,
      directoryOpenFlags: 0x3_0000,
      mkdir: async () => {
        throw Object.assign(new Error("exists"), { code: "EEXIST" });
      },
      lstat: async () => directoryStats(71, 72),
      openDirectory: async () => ({
        stat: async () => directoryStats(71, 72),
        chmod: async () => undefined,
        close: async () => {
          throw new Error("private close detail");
        },
      }),
      chmod: async () => undefined,
      realpath: async () => runsRoot,
      access: async () => undefined,
      assertRunsRoot: async () => runsRoot,
    };

    await expect(
      preparePublicReplayEnvironment(publicEnvironment(runsRoot), dependencies),
    ).rejects.toThrow("Public replay environment is invalid.");
  });

  it("validates Windows root identity before and after trusted-root checks without chmod", async () => {
    const sandbox = await freshSandbox();
    const runsRoot = join(sandbox, "runs");
    let pathnameChecks = 0;
    let realpathChecks = 0;
    let trustedRootChecks = 0;
    let openDirectoryCalled = false;
    let pathnameChmodCalled = false;
    const dependencies = {
      platform: "win32" as const,
      directoryOpenFlags: 0x3_0000,
      mkdir: async () => {
        throw Object.assign(new Error("exists"), { code: "EEXIST" });
      },
      lstat: async () => {
        pathnameChecks += 1;
        return directoryStats(81, 82);
      },
      openDirectory: async () => {
        openDirectoryCalled = true;
        throw new Error("Windows directory handles are unavailable");
      },
      chmod: async () => {
        pathnameChmodCalled = true;
      },
      realpath: async () => {
        realpathChecks += 1;
        return runsRoot;
      },
      access: async () => undefined,
      assertRunsRoot: async () => {
        trustedRootChecks += 1;
        return runsRoot;
      },
    };

    await expect(
      preparePublicReplayEnvironment(publicEnvironment(runsRoot), dependencies),
    ).resolves.toMatchObject({ runsRoot });
    expect(pathnameChecks).toBe(3);
    expect(realpathChecks).toBe(2);
    expect(trustedRootChecks).toBe(1);
    expect(openDirectoryCalled).toBe(false);
    expect(pathnameChmodCalled).toBe(false);
  });
});

class FakeChildProcess extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  readonly killSignals: Array<NodeJS.Signals | number | undefined> = [];

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    this.killSignals.push(signal);
    return true;
  }

  fail(error: Error): void {
    this.emit("error", error);
  }

  confirmSpawn(): void {
    this.emit("spawn");
  }

  close(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("close", code, signal);
  }

  asChildProcess(): ChildProcess {
    return this as unknown as ChildProcess;
  }
}

interface FakeProcessBoundary extends PublicReplayProcessBoundary {
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  once(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  emitSignal(signal: "SIGINT" | "SIGTERM"): void;
  listenerCount(signal: "SIGINT" | "SIGTERM"): number;
}

function createFakeProcessBoundary(): FakeProcessBoundary {
  const signals = new EventEmitter();
  return {
    execPath: resolve("test-node"),
    cwd: () => resolve("test-working-directory"),
    on: (signal, listener) => signals.on(signal, listener),
    once: (signal, listener) => signals.once(signal, listener),
    off: (signal, listener) => signals.off(signal, listener),
    emitSignal: (signal) => {
      signals.emit(signal);
    },
    listenerCount: (signal) => signals.listenerCount(signal),
  };
}

interface LaunchedFakeServer {
  readonly child: FakeChildProcess;
  readonly processBoundary: FakeProcessBoundary;
  readonly result: Promise<number>;
  readonly spawnCall: {
    readonly command: string;
    readonly args: readonly string[];
    readonly options: PublicReplaySpawnOptions;
  };
  readonly resolvedSpecifiers: readonly string[];
}

async function launchFakeServer(): Promise<LaunchedFakeServer> {
  const sandbox = await freshSandbox();
  const child = new FakeChildProcess();
  const processBoundary = createFakeProcessBoundary();
  const resolvedSpecifiers: string[] = [];
  let spawnCall:
    | {
        readonly command: string;
        readonly args: readonly string[];
        readonly options: PublicReplaySpawnOptions;
      }
    | undefined;
  let markSpawned: (() => void) | undefined;
  const spawned = new Promise<void>((resolveSpawned) => {
    markSpawned = resolveSpawned;
  });

  const result = runPublicReplayServer(publicEnvironment(join(sandbox, "runs")), {
    processBoundary,
    resolveModule: (specifier) => {
      resolvedSpecifiers.push(specifier);
      return resolve("installed-next", "dist", "bin", "next");
    },
    spawnChild: (command, args, options) => {
      spawnCall = { command, args, options };
      markSpawned?.();
      return child.asChildProcess();
    },
  });
  await spawned;
  if (spawnCall === undefined) throw new Error("The fake child was not spawned.");

  return {
    child,
    processBoundary,
    result,
    spawnCall,
    resolvedSpecifiers,
  };
}

describe("runPublicReplayServer", () => {
  it("resolves the Next CLI and starts it through the current Node executable", async () => {
    const launched = await launchFakeServer();

    expect(launched.resolvedSpecifiers).toEqual(["next/dist/bin/next"]);
    expect(launched.spawnCall).toMatchObject({
      command: launched.processBoundary.execPath,
      args: [
        resolve("installed-next", "dist", "bin", "next"),
        "start",
        "-H",
        "0.0.0.0",
        "-p",
        "3000",
      ],
      options: {
        cwd: launched.processBoundary.cwd(),
        detached: false,
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      },
    });

    launched.child.close(0);
    await expect(launched.result).resolves.toBe(0);
  });

  it("replaces an asynchronous spawn error and requests child shutdown", async () => {
    const launched = await launchFakeServer();
    const privateDetail = resolve("private", "next-startup-error");
    let caught: unknown;
    let outcome: "pending" | "rejected" | "resolved" = "pending";
    const observed = launched.result.then(
      () => {
        outcome = "resolved";
      },
      (error: unknown) => {
        caught = error;
        outcome = "rejected";
      },
    );

    launched.child.fail(new Error(privateDetail));
    await new Promise<void>((resolveTick) => {
      setImmediate(resolveTick);
    });

    expect(outcome).toBe("pending");
    expect(launched.spawnCall.options.detached).toBe(false);
    expect(launched.child.killSignals).toEqual(["SIGTERM"]);
    launched.child.close(null, "SIGTERM");
    await observed;
    expect(caught).toBeInstanceOf(Error);
    expect(outcome).toBe("rejected");
    expect((caught as Error).message).toBe("Public replay server failed to start.");
    expect((caught as Error).message).not.toContain(privateDetail);
    expect(launched.processBoundary.listenerCount("SIGINT")).toBe(0);
    expect(launched.processBoundary.listenerCount("SIGTERM")).toBe(0);
  });

  it("replaces a synchronous spawn failure without exposing its detail", async () => {
    const sandbox = await freshSandbox();
    const privateDetail = resolve("private", "synchronous-spawn-error");

    await expect(
      runPublicReplayServer(publicEnvironment(join(sandbox, "runs")), {
        resolveModule: () => resolve("installed-next", "dist", "bin", "next"),
        spawnChild: () => {
          throw new Error(privateDetail);
        },
      }),
    ).rejects.toThrow("Public replay server failed to start.");
  });

  it("keeps numeric close authoritative after an error from a spawned child", async () => {
    const launched = await launchFakeServer();

    launched.child.confirmSpawn();
    launched.child.fail(new Error("late child-process detail"));
    launched.child.close(9);

    await expect(launched.result).resolves.toBe(9);
    expect(launched.child.killSignals).toEqual([]);
    expect(launched.child.listenerCount("spawn")).toBe(0);
    expect(launched.child.listenerCount("error")).toBe(0);
    expect(launched.child.listenerCount("close")).toBe(0);
    expect(launched.processBoundary.listenerCount("SIGINT")).toBe(0);
    expect(launched.processBoundary.listenerCount("SIGTERM")).toBe(0);
  });

  it.each(["SIGINT", "SIGTERM"] as const)("forwards %s only once", async (signal) => {
    const launched = await launchFakeServer();

    launched.processBoundary.emitSignal(signal);
    launched.processBoundary.emitSignal(signal);

    expect(launched.child.killSignals).toEqual([signal]);
    launched.child.close(0);
    await expect(launched.result).resolves.toBe(0);
  });

  it("lets the first shutdown signal win across reentrant signals", async () => {
    const launched = await launchFakeServer();

    launched.processBoundary.emitSignal("SIGTERM");
    launched.processBoundary.emitSignal("SIGINT");
    launched.processBoundary.emitSignal("SIGTERM");

    expect(launched.child.killSignals).toEqual(["SIGTERM"]);
    launched.child.close(null, "SIGTERM");
    await expect(launched.result).resolves.toBe(143);
  });

  it("keeps both shutdown handlers active while absorbing repeated signals", async () => {
    const launched = await launchFakeServer();

    launched.processBoundary.emitSignal("SIGTERM");
    launched.processBoundary.emitSignal("SIGTERM");
    launched.processBoundary.emitSignal("SIGINT");

    expect(launched.child.killSignals).toEqual(["SIGTERM"]);
    expect(launched.processBoundary.listenerCount("SIGINT")).toBe(1);
    expect(launched.processBoundary.listenerCount("SIGTERM")).toBe(1);
    launched.child.close(null, "SIGTERM");
    await expect(launched.result).resolves.toBe(143);
    expect(launched.processBoundary.listenerCount("SIGINT")).toBe(0);
    expect(launched.processBoundary.listenerCount("SIGTERM")).toBe(0);
  });

  it.each([
    [7, null, 7],
    [null, "SIGINT", 130],
    [null, "SIGTERM", 143],
    [null, "SIGHUP", 1],
    [null, null, 1],
  ] as const)(
    "maps child close code %j and signal %j to exit code %i",
    async (code, signal, expected) => {
      const launched = await launchFakeServer();

      launched.child.close(code, signal);

      await expect(launched.result).resolves.toBe(expected);
      expect(launched.processBoundary.listenerCount("SIGINT")).toBe(0);
      expect(launched.processBoundary.listenerCount("SIGTERM")).toBe(0);
    },
  );
});

describe("start-public-replay entrypoint", () => {
  it("prints only the fixed failure when configuration is invalid", async () => {
    const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
    const child = spawn(
      process.execPath,
      [tsxCli, resolve("src", "hosting", "start-public-replay.ts")],
      {
        cwd: process.cwd(),
        env: { NODE_ENV: "test" },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
      child.once("error", rejectExit);
      child.once("close", resolveExit);
    });

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toBe("Public replay failed to start.\n");
  });
});
