import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config.js";

if (process.env.LINEAGEGUARD_MIDSCENE_EXPLORATORY !== "1") {
  throw new Error("Midscene exploratory mode is disabled.");
}

export default defineConfig({
  ...baseConfig,
  testDir: "./tests/exploratory",
  outputDir: ".tmp/midscene/playwright",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 90_000,
  globalTimeout: 120_000,
  reporter: [
    ["list"],
    [
      "@midscene/web/playwright-reporter",
      { type: "separate", outputFormat: "html-and-external-assets" },
    ],
  ],
});
