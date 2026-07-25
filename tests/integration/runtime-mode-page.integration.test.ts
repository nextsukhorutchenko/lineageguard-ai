import { createServer } from "node:net";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { once } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { expect, it } from "vitest";

const nextBin = join(process.cwd(), "node_modules", "next", "dist", "bin", "next");

async function reservePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Port reservation failed.");
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

async function waitForServer(url: string, process: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (process.exitCode !== null) throw new Error("The built web server stopped before becoming ready.");
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("The built web server did not become ready.");
}

async function stopServer(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) return;
  process.kill();
  await once(process, "exit");
}

async function renderMode(environment: Record<string, string>): Promise<string> {
  const port = await reservePort();
  const child = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", `${port}`], {
    cwd: process.cwd(),
    env: { ...process.env, ...environment },
    stdio: "ignore",
  });
  const url = `http://127.0.0.1:${port}/`;
  try {
    await waitForServer(url, child);
    const response = await fetch(url);
    expect(response.status).toBe(200);
    return await response.text();
  } finally {
    await stopServer(child);
  }
}

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

it("renders the built page with the mode from each running server environment", async () => {
  const runsRoot = await mkdtemp(join(tmpdir(), "lineageguard-runtime-mode-"));
  try {
    const replay = await renderMode({
      LINEAGEGUARD_DEMO_MODE: "REPLAY",
      LINEAGEGUARD_RUNS_DIR: runsRoot,
    });
    expect(replay).toContain("Fixture replay");

    const live = await renderMode({
      LINEAGEGUARD_DEMO_MODE: "LIVE",
      LINEAGEGUARD_RUNS_DIR: runsRoot,
      OPENAI_API_KEY: "test-placeholder-openai-key",
      DATAHUB_GMS_URL: "http://127.0.0.1:65535",
      DATAHUB_GMS_TOKEN: "test-placeholder-datahub-token",
      DATAHUB_MCP_UVX_PATH: "uvx",
    });
    expect(live).toContain("Live DataHub + OpenAI");
  } finally {
    await removeOwnedRoot(runsRoot);
  }
});
