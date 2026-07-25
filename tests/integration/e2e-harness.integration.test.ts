import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, describe, it } from "vitest";
import { removeOwnedRunsRoot } from "../e2e/global-teardown.js";
import { __testOnly } from "../e2e/server-lifecycle.js";

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
    "accepts a nonzero tree-kill result only after child close and endpoint release",
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
        await firstStop;
        await expectMissing(root);
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
});
