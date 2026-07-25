import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const runsRoot = mkdtempSync(join(tmpdir(), "lineageguard-playwright-runs-"));
process.env.LINEAGEGUARD_E2E_RUNS_DIR = runsRoot;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: "http://127.0.0.1:3107",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev --hostname 127.0.0.1 --port 3107",
    env: {
      LINEAGEGUARD_DEMO_MODE: "REPLAY",
      LINEAGEGUARD_RUNS_DIR: runsRoot,
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:3107",
  },
});
