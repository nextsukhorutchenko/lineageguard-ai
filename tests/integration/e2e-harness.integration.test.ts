import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, describe, it } from "vitest";
import { removeOwnedRunsRoot } from "../e2e/global-teardown.js";
import { __testOnly } from "../e2e/server-lifecycle.js";
import {
  __testOnly as publicReplayTestOnly,
  type PublicReplayE2eServerHandle,
} from "../e2e/public-replay-server-lifecycle.js";

const REAL_PROCESS_TEST_TIMEOUT_MS = 10_000;
const FOCUSED_TERMINATION_TIMEOUT_MS = 1_000;

async function expectMissing(path: string): Promise<void> {
  await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
}

async function forceClose(child: ChildProcess): Promise<void> {
  if (__testOnly.isTerminal(child)) return;
  child.kill();
  await __testOnly.completeWithin(__testOnly.waitForClose(child), 2_000);
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidFile(path: string): Promise<number> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      const pid = Number.parseInt(await readFile(path, "utf8"), 10);
      if (Number.isSafeInteger(pid) && pid > 0) return pid;
    } catch {
      // The child publishes the PID after spawning its grandchild.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("The grandchild PID fixture was not published.");
}

describe.sequential("Playwright server lifecycle", () => {
  it("removes only its canonical harness-owned runs root", async () => {
    const root = await mkdtemp(join(tmpdir(), "lineageguard-playwright-runs-"));
    await writeFile(join(root, "sentinel.txt"), "owned", "utf8");

    await removeOwnedRunsRoot(root);

    await expectMissing(root);
  });

  it("rejects an unowned temporary root without deleting it", async () => {
    const root = await mkdtemp(join(tmpdir(), "lineageguard-unowned-runs-"));
    try {
      await expect(removeOwnedRunsRoot(root)).rejects.toThrow(
        "The Playwright runs root is outside the owned temporary boundary.",
      );
      await expect(access(root)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses an occupied endpoint before creating a runs root", async () => {
    let created = false;
    await expect(
      __testOnly.startE2eServer({
        probe: async () => 503,
        createRunsRoot: async () => {
          created = true;
          return await mkdtemp(join(tmpdir(), "lineageguard-playwright-runs-"));
        },
      }),
    ).rejects.toThrow("The Playwright test endpoint is already in use.");
    expect(created).toBe(false);
  });

  it("replaces a runs-root creation failure with the fixed startup error", async () => {
    const nativePath = "D:\\private\\lineageguard-playwright-runs-secret";
    let caught: unknown;
    try {
      await __testOnly.startE2eServer({
        probe: async () => undefined,
        createRunsRoot: async () => {
          throw Object.assign(new Error(`EACCES: mkdir '${nativePath}'`), { code: "EACCES" });
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("The Playwright test server failed to start.");
    expect((caught as Error).message).not.toContain(nativePath);
  });

  it("removes the owned root when Next CLI resolution fails", async () => {
    let root = "";
    await expect(
      __testOnly.startE2eServer({
        probe: async () => undefined,
        createRunsRoot: async () => {
          root = await mkdtemp(join(tmpdir(), "lineageguard-playwright-runs-"));
          return root;
        },
        resolveNextCli: () => {
          throw new Error("native resolver detail");
        },
      }),
    ).rejects.toThrow("The Playwright test server failed to start.");
    await expectMissing(root);
  });

  it(
    "observes asynchronous spawn failure and removes the owned root",
    async () => {
      let root = "";
      await expect(
        __testOnly.startE2eServer({
          probe: async () => undefined,
          createRunsRoot: async () => {
            root = await mkdtemp(join(tmpdir(), "lineageguard-playwright-runs-"));
            return root;
          },
          spawnChild: () =>
            spawn("lineageguard-command-that-does-not-exist", [], {
              shell: false,
              stdio: "ignore",
              windowsHide: true,
            }),
          timeouts: {
            startupMs: 500,
            terminationMs: FOCUSED_TERMINATION_TIMEOUT_MS,
            pollMs: 10,
          },
        }),
      ).rejects.toThrow("The Playwright test server failed to start.");
      await expectMissing(root);
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "rejects a nonzero tree-kill result and retains the root",
    async () => {
      let ready = false;
      let root = "";
      let child: ChildProcess | undefined;
      const handle = await __testOnly.startE2eServer({
        probe: async () =>
          ready && child !== undefined && !__testOnly.isTerminal(child) ? 200 : undefined,
        createRunsRoot: async () => {
          root = await mkdtemp(join(tmpdir(), "lineageguard-playwright-runs-"));
          return root;
        },
        resolveNextCli: () => "unused",
        spawnChild: () => {
          child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
            shell: false,
            stdio: "ignore",
            windowsHide: true,
          });
          ready = true;
          return child;
        },
        spawnTreeKiller: () =>
          spawn(process.execPath, ["-e", "process.exit(9)"], {
            shell: false,
            stdio: "ignore",
            windowsHide: true,
          }),
        platform: "win32",
        timeouts: {
          startupMs: 500,
          terminationMs: FOCUSED_TERMINATION_TIMEOUT_MS,
          pollMs: 10,
        },
      });

      try {
        const firstStop = handle.stop();
        expect(handle.stop()).toBe(firstStop);
        await expect(firstStop).rejects.toThrow("The Playwright test server could not be stopped.");
        await expect(access(root)).resolves.toBeUndefined();
        expect(child === undefined ? false : __testOnly.isTerminal(child)).toBe(true);
      } finally {
        if (child !== undefined) await forceClose(child);
        await rm(root, { recursive: true, force: true });
      }
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "reaps a timed-out tree killer, reports a fixed failure, and retains the root",
    async () => {
      let ready = false;
      let root = "";
      let child: ChildProcess | undefined;
      let killer: ChildProcess | undefined;
      const handle = await __testOnly.startE2eServer({
        probe: async () => (ready ? 200 : undefined),
        createRunsRoot: async () => {
          root = await mkdtemp(join(tmpdir(), "lineageguard-playwright-runs-"));
          return root;
        },
        resolveNextCli: () => "unused",
        spawnChild: () => {
          child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
            shell: false,
            stdio: "ignore",
            windowsHide: true,
          });
          ready = true;
          return child;
        },
        spawnTreeKiller: () => {
          killer = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
            shell: false,
            stdio: "ignore",
            windowsHide: true,
          });
          return killer;
        },
        platform: "win32",
        timeouts: {
          startupMs: 500,
          terminationMs: FOCUSED_TERMINATION_TIMEOUT_MS,
          pollMs: 10,
        },
      });

      try {
        await expect(handle.stop()).rejects.toThrow(
          "The Playwright test server could not be stopped.",
        );
        await expect(access(root)).resolves.toBeUndefined();
        expect(killer === undefined ? false : __testOnly.isTerminal(killer)).toBe(true);
      } finally {
        if (child !== undefined) await forceClose(child);
        if (killer !== undefined) await forceClose(killer);
        await rm(root, { recursive: true, force: true });
      }
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "retains the root when endpoint release cannot be confirmed",
    async () => {
      let ready = false;
      let root = "";
      let child: ChildProcess | undefined;
      const handle = await __testOnly.startE2eServer({
        probe: async () => (ready ? 200 : undefined),
        createRunsRoot: async () => {
          root = await mkdtemp(join(tmpdir(), "lineageguard-playwright-runs-"));
          return root;
        },
        resolveNextCli: () => "unused",
        spawnChild: () => {
          child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
            shell: false,
            stdio: "ignore",
            windowsHide: true,
          });
          ready = true;
          return child;
        },
        spawnTreeKiller: () =>
          spawn(process.execPath, ["-e", "process.exit(0)"], {
            shell: false,
            stdio: "ignore",
            windowsHide: true,
          }),
        platform: "win32",
        timeouts: {
          startupMs: 500,
          terminationMs: FOCUSED_TERMINATION_TIMEOUT_MS,
          pollMs: 10,
        },
      });

      try {
        await expect(handle.stop()).rejects.toThrow(
          "The Playwright test server could not be stopped.",
        );
        await expect(access(root)).resolves.toBeUndefined();
      } finally {
        if (child !== undefined) await forceClose(child);
        await rm(root, { recursive: true, force: true });
      }
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it("recognizes a signalled child and keeps the exact raw-byte diagnostic tail", () => {
    expect(__testOnly.isTerminal({ exitCode: null, signalCode: "SIGTERM" })).toBe(true);
    expect(
      __testOnly.appendTail(
        Buffer.from([0xff, ...Buffer.alloc(16_383, 0x61)]),
        Buffer.from([0xe2, 0x82, 0xac]),
      ),
    ).toEqual(Buffer.from([...Buffer.alloc(16_381, 0x61), 0xe2, 0x82, 0xac]));
  });

  it(
    "starts replay with an explicit non-secret environment allowlist",
    async () => {
      const fixtureRoot = await mkdtemp(join(tmpdir(), "lineageguard-e2e-env-"));
      const fakeNextCli = join(fixtureRoot, "fake-next.mjs");
      const capturePath = join(fixtureRoot, "captured-environment.json");
      const secretKeys = [
        "OPENAI_API_KEY",
        "DATAHUB_GMS_TOKEN",
        "GH_TOKEN",
        "GITHUB_TOKEN",
      ] as const;
      const sentinel = ["ACTIVE", "SECRET", "SENTINEL"].join("_");
      const previousValues = Object.fromEntries(
        secretKeys.map((key) => [key, process.env[key]]),
      ) as Record<(typeof secretKeys)[number], string | undefined>;
      for (const key of secretKeys) process.env[key] = sentinel;
      await writeFile(
        fakeNextCli,
        [
          'import { writeFileSync } from "node:fs";',
          'import { createServer } from "node:http";',
          `const keys = ${JSON.stringify(secretKeys)};`,
          `writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({`,
          "  secrets: Object.fromEntries(keys.map((key) => [key, process.env[key]])),",
          "  mode: process.env.LINEAGEGUARD_DEMO_MODE,",
          "  runsRoot: process.env.LINEAGEGUARD_RUNS_DIR,",
          '}), "utf8");',
          'createServer((_request, response) => response.end("ok")).listen(3107, "127.0.0.1");',
        ].join("\n"),
        "utf8",
      );

      let handle: Awaited<ReturnType<typeof __testOnly.startE2eServer>> | undefined;
      try {
        handle = await __testOnly.startE2eServer({
          resolveNextCli: () => fakeNextCli,
          spawnTreeKiller: (pid) =>
            spawn(
              process.execPath,
              [
                "-e",
                `try { process.kill(${pid}); } catch (error) { if (error?.code !== "ESRCH") process.exit(1); }`,
              ],
              {
                shell: false,
                stdio: "ignore",
                windowsHide: true,
              },
            ),
          platform: "win32",
          timeouts: {
            startupMs: 5_000,
            terminationMs: FOCUSED_TERMINATION_TIMEOUT_MS,
            pollMs: 10,
          },
        });
        const captured = JSON.parse(await readFile(capturePath, "utf8")) as {
          readonly secrets: Readonly<Record<string, string | undefined>>;
          readonly mode?: string;
          readonly runsRoot?: string;
        };

        expect(captured.secrets).toEqual({});
        expect(captured.mode).toBe("REPLAY");
        expect(captured.runsRoot).toBe(handle.runsRoot);
      } finally {
        if (handle !== undefined) await handle.stop();
        for (const key of secretKeys) {
          const previous = previousValues[key];
          if (previous === undefined) delete process.env[key];
          else process.env[key] = previous;
        }
        await rm(fixtureRoot, { recursive: true, force: true });
      }
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );
});

describe.sequential("public replay production lifecycle", () => {
  it(
    "passes a missing child root to the compiled bootstrap and waits for exact health",
    async () => {
      let parent = "";
      let child: ChildProcess | undefined;
      let capturedRoot = "";
      let capturedBootstrap = "";
      let capturedPort = "";
      let healthChecks = 0;
      let handle: PublicReplayE2eServerHandle | undefined;

      try {
        handle = await publicReplayTestOnly.startPublicReplayServer({
          isEndpointOccupied: async () => false,
          createTemporaryParent: async () => {
            parent = await mkdtemp(join(tmpdir(), "lineageguard-public-replay-e2e-"));
            return parent;
          },
          resolveBootstrap: () => join(process.cwd(), "dist", "hosting", "start-public-replay.js"),
          spawnChild: (bootstrap, runsRoot, options) => {
            capturedBootstrap = bootstrap;
            capturedRoot = runsRoot;
            capturedPort = options.env.PORT ?? "";
            expect(existsSync(runsRoot)).toBe(false);
            child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
              detached: false,
              shell: false,
              stdio: "ignore",
              windowsHide: true,
            });
            return child;
          },
          probeHealth: async () => {
            healthChecks += 1;
            return healthChecks === 1
              ? { status: 200, body: { status: "ok", mode: "REPLAY" } }
              : { status: 200, body: { status: "ok", mode: "PUBLIC_REPLAY" } };
          },
          proveOwnership: async () => true,
          spawnTreeKiller: () => {
            child?.kill();
            return spawn(process.execPath, ["-e", "process.exit(0)"], {
              shell: false,
              stdio: "ignore",
              windowsHide: true,
            });
          },
          platform: "win32",
          timeouts: {
            startupMs: 500,
            terminationMs: FOCUSED_TERMINATION_TIMEOUT_MS,
            pollMs: 10,
          },
        });

        expect(capturedBootstrap).toBe(
          join(process.cwd(), "dist", "hosting", "start-public-replay.js"),
        );
        expect(capturedRoot).toBe(join(parent, "runs"));
        expect(capturedPort).toBe("3110");
        expect(healthChecks).toBeGreaterThan(1);
        await expect(access(capturedRoot)).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        if (handle !== undefined) await handle.stop();
        if (child !== undefined) await forceClose(child);
        if (parent !== "") await rm(parent, { recursive: true, force: true });
      }
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "rejects foreign exact health when the owned replay proof is absent",
    async () => {
      let parent = "";
      let child: ChildProcess | undefined;
      let unexpectedHandle: PublicReplayE2eServerHandle | undefined;
      const overrides = {
        isEndpointOccupied: async () => false,
        createTemporaryParent: async () => {
          parent = await mkdtemp(join(tmpdir(), "lineageguard-public-replay-e2e-"));
          return parent;
        },
        resolveBootstrap: () => "unused",
        spawnChild: () => {
          child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
            shell: false,
            stdio: "ignore" as const,
            windowsHide: true,
          });
          return child;
        },
        probeHealth: async () => ({
          status: 200,
          body: { status: "ok", mode: "PUBLIC_REPLAY" },
        }),
        proveOwnership: async () => false,
        spawnTreeKiller: () => {
          child?.kill();
          return spawn(process.execPath, ["-e", "process.exit(0)"], {
            shell: false,
            stdio: "ignore" as const,
            windowsHide: true,
          });
        },
        platform: "win32" as const,
        timeouts: {
          startupMs: 500,
          terminationMs: FOCUSED_TERMINATION_TIMEOUT_MS,
          pollMs: 10,
        },
      };

      try {
        const startup = publicReplayTestOnly.startPublicReplayServer(overrides).then((handle) => {
          unexpectedHandle = handle;
          return handle;
        });
        await expect(startup).rejects.toThrow("The public replay test server failed to start.");
        await expectMissing(parent);
      } finally {
        if (unexpectedHandle !== undefined) await unexpectedHandle.stop();
        if (child !== undefined) await forceClose(child);
        if (parent !== "") await rm(parent, { recursive: true, force: true });
      }
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "does not accept a health probe that resolves after the absolute startup deadline",
    async () => {
      let parent = "";
      let child: ChildProcess | undefined;
      let unexpectedHandle: PublicReplayE2eServerHandle | undefined;

      try {
        const startup = publicReplayTestOnly
          .startPublicReplayServer({
            isEndpointOccupied: async () => false,
            createTemporaryParent: async () => {
              parent = await mkdtemp(join(tmpdir(), "lineageguard-public-replay-e2e-"));
              return parent;
            },
            resolveBootstrap: () => "unused",
            spawnChild: () => {
              child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
                shell: false,
                stdio: "ignore",
                windowsHide: true,
              });
              return child;
            },
            probeHealth: async () => {
              await new Promise<void>((resolve) => setTimeout(resolve, 60));
              return {
                status: 200,
                body: { status: "ok", mode: "PUBLIC_REPLAY" },
              };
            },
            proveOwnership: async () => true,
            spawnTreeKiller: () => {
              child?.kill();
              return spawn(process.execPath, ["-e", "process.exit(0)"], {
                shell: false,
                stdio: "ignore",
                windowsHide: true,
              });
            },
            platform: "win32",
            timeouts: {
              startupMs: 20,
              terminationMs: FOCUSED_TERMINATION_TIMEOUT_MS,
              pollMs: 10,
            },
          })
          .then((handle) => {
            unexpectedHandle = handle;
            return handle;
          });

        await expect(startup).rejects.toThrow("The public replay test server failed to start.");
        await expectMissing(parent);
      } finally {
        if (unexpectedHandle !== undefined) await unexpectedHandle.stop();
        if (child !== undefined) await forceClose(child);
        if (parent !== "") await rm(parent, { recursive: true, force: true });
      }
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "cancels an ownership proof at the absolute startup deadline",
    async () => {
      let parent = "";
      let child: ChildProcess | undefined;
      let ownershipAborted = false;

      try {
        await expect(
          publicReplayTestOnly.startPublicReplayServer({
            isEndpointOccupied: async () => false,
            createTemporaryParent: async () => {
              parent = await mkdtemp(join(tmpdir(), "lineageguard-public-replay-e2e-"));
              return parent;
            },
            resolveBootstrap: () => "unused",
            spawnChild: () => {
              child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
                shell: false,
                stdio: "ignore",
                windowsHide: true,
              });
              return child;
            },
            probeHealth: async () => ({
              status: 200,
              body: { status: "ok", mode: "PUBLIC_REPLAY" },
            }),
            proveOwnership: async (_runsRoot, signal) =>
              await new Promise<boolean>((resolveProof) => {
                signal.addEventListener(
                  "abort",
                  () => {
                    ownershipAborted = true;
                    resolveProof(false);
                  },
                  { once: true },
                );
                setTimeout(() => resolveProof(true), 150);
              }),
            spawnTreeKiller: () => {
              child?.kill();
              return spawn(process.execPath, ["-e", "process.exit(0)"], {
                shell: false,
                stdio: "ignore",
                windowsHide: true,
              });
            },
            platform: "win32",
            timeouts: {
              startupMs: 80,
              terminationMs: FOCUSED_TERMINATION_TIMEOUT_MS,
              pollMs: 10,
            },
          }),
        ).rejects.toThrow("The public replay test server failed to start.");
        expect(ownershipAborted).toBe(true);
        await expectMissing(parent);
      } finally {
        if (child !== undefined) await forceClose(child);
        if (parent !== "") await rm(parent, { recursive: true, force: true });
      }
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it("rejects an occupied port before creating an owned parent", async () => {
    let created = false;

    await expect(
      publicReplayTestOnly.startPublicReplayServer({
        isEndpointOccupied: async () => true,
        createTemporaryParent: async () => {
          created = true;
          return await mkdtemp(join(tmpdir(), "lineageguard-public-replay-e2e-"));
        },
      }),
    ).rejects.toThrow("The public replay test endpoint is already in use.");
    expect(created).toBe(false);
  });

  it(
    "reports one fixed startup error without child output or native paths",
    async () => {
      const privatePath = "D:\\private\\public-replay-secret";
      let parent = "";
      let caught: unknown;
      try {
        await publicReplayTestOnly.startPublicReplayServer({
          isEndpointOccupied: async () => false,
          createTemporaryParent: async () => {
            parent = await mkdtemp(join(tmpdir(), "lineageguard-public-replay-e2e-"));
            return parent;
          },
          resolveBootstrap: () => privatePath,
          spawnChild: () =>
            spawn(
              process.execPath,
              [
                "-e",
                `process.stdout.write(${JSON.stringify(privatePath)}); process.stderr.write("private stderr"); process.exit(9);`,
              ],
              {
                shell: false,
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true,
              },
            ),
          probeHealth: async () => undefined,
          timeouts: {
            startupMs: 500,
            terminationMs: FOCUSED_TERMINATION_TIMEOUT_MS,
            pollMs: 10,
          },
        });
      } catch (error) {
        caught = error;
      } finally {
        if (parent !== "") await rm(parent, { recursive: true, force: true });
      }

      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe("The public replay test server failed to start.");
      expect((caught as Error).message).not.toContain(privatePath);
      expect((caught as Error).message).not.toContain("private stderr");
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "terminates the full child tree, confirms endpoint release, and removes its parent",
    async () => {
      let parent = "";
      let child: ChildProcess | undefined;
      let killedPid: number | undefined;
      let endpointOccupied = false;
      const handle = await publicReplayTestOnly.startPublicReplayServer({
        isEndpointOccupied: async () => endpointOccupied,
        createTemporaryParent: async () => {
          parent = await mkdtemp(join(tmpdir(), "lineageguard-public-replay-e2e-"));
          return parent;
        },
        resolveBootstrap: () => "unused",
        spawnChild: () => {
          child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
            shell: false,
            stdio: "ignore",
            windowsHide: true,
          });
          endpointOccupied = true;
          child.once("close", () => {
            endpointOccupied = false;
          });
          return child;
        },
        probeHealth: async () => ({
          status: 200,
          body: { status: "ok", mode: "PUBLIC_REPLAY" },
        }),
        proveOwnership: async () => true,
        spawnTreeKiller: (pid) => {
          killedPid = pid;
          child?.kill();
          return spawn(process.execPath, ["-e", "process.exit(0)"], {
            shell: false,
            stdio: "ignore",
            windowsHide: true,
          });
        },
        platform: "win32",
        timeouts: {
          startupMs: 500,
          terminationMs: FOCUSED_TERMINATION_TIMEOUT_MS,
          pollMs: 10,
        },
      });

      try {
        await handle.stop();
        expect(killedPid).toBe(child?.pid);
        expect(endpointOccupied).toBe(false);
        await expectMissing(parent);
      } finally {
        if (child !== undefined) await forceClose(child);
        if (parent !== "") await rm(parent, { recursive: true, force: true });
      }
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "proves a real parent and grandchild are gone before removing the owned parent",
    async () => {
      let parent = "";
      let child: ChildProcess | undefined;
      let grandchildPid: number | undefined;
      let cleanupObserved = false;
      let parentAliveAtCleanup: boolean | undefined;
      let grandchildAliveAtCleanup: boolean | undefined;
      let killer: ChildProcess | undefined;
      let endpointOccupied = false;
      const pidFile = join(
        tmpdir(),
        `lineageguard-public-replay-grandchild-${process.pid}-${Date.now()}.txt`,
      );

      try {
        const handle = await publicReplayTestOnly.startPublicReplayServer({
          isEndpointOccupied: async () => endpointOccupied,
          createTemporaryParent: async () => {
            parent = await mkdtemp(join(tmpdir(), "lineageguard-public-replay-e2e-"));
            return parent;
          },
          resolveBootstrap: () => "unused",
          spawnChild: (_bootstrap, _runsRoot, options) => {
            child = spawn(
              process.execPath,
              [
                "-e",
                [
                  'const { spawn } = require("node:child_process");',
                  'const { writeFileSync } = require("node:fs");',
                  "const grandchild = spawn(process.execPath,",
                  '  ["-e", "setInterval(() => {}, 1000)"],',
                  '  { shell: false, stdio: "ignore", windowsHide: true });',
                  `writeFileSync(${JSON.stringify(pidFile)}, String(grandchild.pid), "utf8");`,
                  "setInterval(() => {}, 1000);",
                ].join("\n"),
              ],
              {
                detached: options.detached,
                shell: false,
                stdio: "ignore",
                windowsHide: true,
              },
            );
            endpointOccupied = true;
            child.once("close", () => {
              endpointOccupied = false;
            });
            return child;
          },
          probeHealth: async () => ({
            status: 200,
            body: { status: "ok", mode: "PUBLIC_REPLAY" },
          }),
          proveOwnership: async () => true,
          spawnTreeKiller: (pid) => {
            killer = spawn(
              process.execPath,
              [
                "-e",
                [
                  `const pids = ${JSON.stringify([grandchildPid, pid])};`,
                  "for (const target of pids) {",
                  "  try { process.kill(target); }",
                  '  catch (error) { if (error?.code !== "ESRCH") process.exit(1); }',
                  "}",
                  "setTimeout(() => process.exit(0), 50);",
                ].join("\n"),
              ],
              {
                shell: false,
                stdio: "ignore",
                windowsHide: true,
              },
            );
            return killer;
          },
          removeOwnedParent: async (runsParent, runsRoot, expectedIdentity) => {
            parentAliveAtCleanup = child?.pid === undefined ? false : processExists(child.pid);
            grandchildAliveAtCleanup =
              grandchildPid === undefined ? true : processExists(grandchildPid);
            cleanupObserved = true;
            await publicReplayTestOnly.removeOwnedParent(runsParent, runsRoot, {
              expectedIdentity,
            });
          },
          timeouts: {
            startupMs: 500,
            terminationMs: 4_000,
            pollMs: 10,
          },
        });

        grandchildPid = await waitForPidFile(pidFile);
        expect(processExists(child?.pid ?? -1)).toBe(true);
        expect(processExists(grandchildPid)).toBe(true);

        let stopError: unknown;
        try {
          await handle.stop();
        } catch (error) {
          stopError = error;
        }

        expect(killer?.exitCode).toBe(0);
        expect(stopError).toBeUndefined();
        expect(cleanupObserved).toBe(true);
        expect(parentAliveAtCleanup).toBe(false);
        expect(grandchildAliveAtCleanup).toBe(false);
        await expectMissing(parent);
      } finally {
        if (child !== undefined) await forceClose(child);
        if (grandchildPid !== undefined && processExists(grandchildPid)) {
          try {
            process.kill(grandchildPid);
          } catch {
            // Best-effort fixture cleanup only.
          }
        }
        await rm(pidFile, { force: true });
        if (parent !== "") await rm(parent, { recursive: true, force: true });
      }
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it("refuses cleanup when the owned child is a reparse point", async () => {
    const parent = await mkdtemp(join(tmpdir(), "lineageguard-public-replay-e2e-"));
    const runsRoot = join(parent, "runs");
    await writeFile(runsRoot, "not a directory", "utf8");

    try {
      await expect(
        publicReplayTestOnly.removeOwnedParent(parent, runsRoot, {
          lstat: async (path) => {
            const stats = await lstat(path);
            return path === runsRoot
              ? {
                  dev: stats.dev,
                  ino: stats.ino,
                  isDirectory: () => true,
                  isSymbolicLink: () => true,
                }
              : stats;
          },
        }),
      ).rejects.toThrow("The public replay test root could not be removed.");
      await expect(access(parent)).resolves.toBeUndefined();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it(
    "retains a replacement swapped into the owned parent path after startup",
    async () => {
      let parent = "";
      let displacedParent = "";
      let child: ChildProcess | undefined;
      let endpointOccupied = false;
      const handle = await publicReplayTestOnly.startPublicReplayServer({
        isEndpointOccupied: async () => endpointOccupied,
        createTemporaryParent: async () => {
          parent = await mkdtemp(join(tmpdir(), "lineageguard-public-replay-e2e-"));
          return parent;
        },
        resolveBootstrap: () => "unused",
        spawnChild: () => {
          child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
            shell: false,
            stdio: "ignore",
            windowsHide: true,
          });
          endpointOccupied = true;
          child.once("close", () => {
            endpointOccupied = false;
          });
          return child;
        },
        probeHealth: async () => ({
          status: 200,
          body: { status: "ok", mode: "PUBLIC_REPLAY" },
        }),
        proveOwnership: async () => true,
        spawnTreeKiller: () => {
          child?.kill();
          return spawn(process.execPath, ["-e", "process.exit(0)"], {
            shell: false,
            stdio: "ignore",
            windowsHide: true,
          });
        },
        platform: "win32",
        timeouts: {
          startupMs: 500,
          terminationMs: FOCUSED_TERMINATION_TIMEOUT_MS,
          pollMs: 10,
        },
      });

      try {
        displacedParent = `${parent}-displaced`;
        await rename(parent, displacedParent);
        await mkdir(parent);
        await writeFile(join(parent, "unrelated-sentinel.txt"), "retain", "utf8");

        await expect(handle.stop()).rejects.toThrow(
          "The public replay test server could not be stopped.",
        );
        await expect(readFile(join(parent, "unrelated-sentinel.txt"), "utf8")).resolves.toBe(
          "retain",
        );
        await expect(access(displacedParent)).resolves.toBeUndefined();
      } finally {
        if (child !== undefined) await forceClose(child);
        if (parent !== "") await rm(parent, { recursive: true, force: true });
        if (displacedParent !== "") {
          await rm(displacedParent, { recursive: true, force: true });
        }
      }
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it("retains an unrelated directory swapped into the quarantine entry", async () => {
    const parent = await mkdtemp(join(tmpdir(), "lineageguard-public-replay-e2e-"));
    const runsRoot = join(parent, "runs");
    await mkdir(runsRoot);
    const unrelated = await mkdtemp(join(tmpdir(), "lineageguard-unrelated-"));
    await writeFile(join(unrelated, "unrelated-sentinel.txt"), "retain", "utf8");
    const displacedParent = `${parent}-displaced`;
    const quarantine = join(tmpdir(), `lineageguard-public-replay-e2e-quarantine-${process.pid}`);
    const overrides = {
      createQuarantinePath: () => quarantine,
      rename: async (source: string, destination: string) => {
        await rename(source, destination);
        await rename(destination, displacedParent);
        await rename(unrelated, destination);
      },
    };

    try {
      await expect(
        publicReplayTestOnly.removeOwnedParent(parent, runsRoot, overrides),
      ).rejects.toThrow("The public replay test root could not be removed.");
      await expect(readFile(join(quarantine, "unrelated-sentinel.txt"), "utf8")).resolves.toBe(
        "retain",
      );
      await expect(access(displacedParent)).resolves.toBeUndefined();
    } finally {
      await rm(parent, { recursive: true, force: true });
      await rm(unrelated, { recursive: true, force: true });
      await rm(displacedParent, { recursive: true, force: true });
      await rm(quarantine, { recursive: true, force: true });
    }
  });

  it("refuses an actual runs-root symlink or junction without deleting its target", async () => {
    const parent = await mkdtemp(join(tmpdir(), "lineageguard-public-replay-e2e-"));
    const runsRoot = join(parent, "runs");
    const target = await mkdtemp(join(tmpdir(), "lineageguard-public-replay-target-"));
    await writeFile(join(target, "target-sentinel.txt"), "retain", "utf8");

    try {
      await symlink(target, runsRoot, process.platform === "win32" ? "junction" : "dir");
      await expect(publicReplayTestOnly.removeOwnedParent(parent, runsRoot)).rejects.toThrow(
        "The public replay test root could not be removed.",
      );
      await expect(readFile(join(target, "target-sentinel.txt"), "utf8")).resolves.toBe("retain");
      await expect(access(parent)).resolves.toBeUndefined();
    } finally {
      await rm(parent, { recursive: true, force: true });
      await rm(target, { recursive: true, force: true });
    }
  });

  it(
    "retains the owned parent when shutdown certainty is lost",
    async () => {
      let parent = "";
      let child: ChildProcess | undefined;
      let endpointOccupied = false;
      const handle = await publicReplayTestOnly.startPublicReplayServer({
        isEndpointOccupied: async () => endpointOccupied,
        createTemporaryParent: async () => {
          parent = await mkdtemp(join(tmpdir(), "lineageguard-public-replay-e2e-"));
          return parent;
        },
        resolveBootstrap: () => "unused",
        spawnChild: () => {
          child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
            shell: false,
            stdio: "ignore",
            windowsHide: true,
          });
          endpointOccupied = true;
          return child;
        },
        probeHealth: async () => ({
          status: 200,
          body: { status: "ok", mode: "PUBLIC_REPLAY" },
        }),
        proveOwnership: async () => true,
        spawnTreeKiller: () =>
          spawn(process.execPath, ["-e", "process.exit(0)"], {
            shell: false,
            stdio: "ignore",
            windowsHide: true,
          }),
        platform: "win32",
        timeouts: {
          startupMs: 500,
          terminationMs: 100,
          pollMs: 10,
        },
      });

      try {
        await expect(handle.stop()).rejects.toThrow(
          "The public replay test server could not be stopped.",
        );
        await expect(access(parent)).resolves.toBeUndefined();
      } finally {
        if (child !== undefined) await forceClose(child);
        if (parent !== "") await rm(parent, { recursive: true, force: true });
      }
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );
});
