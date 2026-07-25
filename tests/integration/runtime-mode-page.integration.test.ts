import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { expect, it } from "vitest";
import { __testOnly, createRootSafety, renderBuiltPage } from "./runtime-mode-harness.js";

const nextBin = join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const REAL_SERVER_TEST_TIMEOUT_MS = 35_000;
const FOCUSED_PROCESS_TEST_TIMEOUT_MS = 10_000;

async function removeOwnedRoot(root: string): Promise<void> {
  const [canonicalRoot, canonicalTemp] = await Promise.all([realpath(root), realpath(tmpdir())]);
  if (
    dirname(canonicalRoot) !== canonicalTemp ||
    !basename(canonicalRoot).startsWith("lineageguard-runtime-mode-")
  ) {
    throw new Error("The runtime-mode test root is outside the owned temporary boundary.");
  }
  await rm(canonicalRoot, { recursive: true, force: true });
}

async function forceClose(child: ChildProcess): Promise<void> {
  if (__testOnly.isTerminal(child)) return;
  child.kill();
  await __testOnly.completeWithin(__testOnly.waitForClose(child), 2_000);
}

it(
  "renders the built page with the mode from each running server environment",
  async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "lineageguard-runtime-mode-"));
    const rootSafety = createRootSafety();
    try {
      const replay = await renderBuiltPage(
        nextBin,
        {
          LINEAGEGUARD_DEMO_MODE: "REPLAY",
          LINEAGEGUARD_RUNS_DIR: runsRoot,
        },
        rootSafety,
      );
      expect(replay).toContain("Fixture replay");

      const live = await renderBuiltPage(
        nextBin,
        {
          LINEAGEGUARD_DEMO_MODE: "LIVE",
          LINEAGEGUARD_RUNS_DIR: runsRoot,
          OPENAI_API_KEY: "test-placeholder-openai-key",
          DATAHUB_GMS_URL: "http://127.0.0.1:65535",
          DATAHUB_GMS_TOKEN: "test-placeholder-datahub-token",
          DATAHUB_MCP_UVX_PATH: "uvx",
        },
        rootSafety,
      );
      expect(live).toContain("Live DataHub + OpenAI");
    } finally {
      if (!rootSafety.mayBeInUse) await removeOwnedRoot(runsRoot);
    }
  },
  REAL_SERVER_TEST_TIMEOUT_MS,
);

it(
  "bounds a probe even when a peer accepts the connection without responding",
  async () => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("Port reservation failed.");
    const startedAt = Date.now();
    try {
      await expect(
        __testOnly.probeStatus(`http://127.0.0.1:${address.port}/`, 100),
      ).resolves.toBeUndefined();
      expect(Date.now() - startedAt).toBeLessThan(1_000);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
  FOCUSED_PROCESS_TEST_TIMEOUT_MS,
);

it(
  "enforces the readiness deadline and confirms cleanup of the real child",
  async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "lineageguard-runtime-mode-"));
    const rootSafety = createRootSafety();
    let child: ChildProcess | undefined;
    try {
      await expect(
        renderBuiltPage("unused", { LINEAGEGUARD_RUNS_DIR: runsRoot }, rootSafety, {
          spawnChild: () => {
            child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
              shell: false,
              stdio: "ignore",
              windowsHide: true,
            });
            return child;
          },
          probeStatus: async () => undefined,
          timeouts: {
            overallMs: 300,
            readinessMs: 150,
            terminationMs: 500,
            probeMs: 50,
            pollMs: 10,
          },
        }),
      ).rejects.toThrow("The built web server did not become ready.");
      expect(rootSafety.mayBeInUse).toBe(false);
      expect(child === undefined ? false : __testOnly.isTerminal(child)).toBe(true);
      await expect(access(runsRoot)).resolves.toBeUndefined();
    } finally {
      if (child !== undefined) await forceClose(child);
      await rm(runsRoot, { recursive: true, force: true });
    }
  },
  FOCUSED_PROCESS_TEST_TIMEOUT_MS,
);

it(
  "retains the root while termination of a real live child is uncertain",
  async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "lineageguard-runtime-mode-"));
    const rootSafety = createRootSafety();
    let child: ChildProcess | undefined;
    try {
      await expect(
        renderBuiltPage("unused", { LINEAGEGUARD_RUNS_DIR: runsRoot }, rootSafety, {
          spawnChild: () => {
            child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
              shell: false,
              stdio: "ignore",
              windowsHide: true,
            });
            return child;
          },
          probeStatus: async () => 200,
          readPage: async () => "<html>Fixture replay</html>",
          requestTermination: async () => {
            throw new Error("injected uncertain process-tree result");
          },
          timeouts: {
            overallMs: 300,
            readinessMs: 150,
            terminationMs: 150,
            probeMs: 50,
            pollMs: 10,
          },
        }),
      ).rejects.toThrow("The built web server could not be stopped.");
      expect(rootSafety.mayBeInUse).toBe(true);
      await expect(access(runsRoot)).resolves.toBeUndefined();
      expect(child === undefined ? true : __testOnly.isTerminal(child)).toBe(false);
    } finally {
      if (child !== undefined) await forceClose(child);
      await rm(runsRoot, { recursive: true, force: true });
    }
  },
  FOCUSED_PROCESS_TEST_TIMEOUT_MS,
);
