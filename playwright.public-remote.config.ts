import { defineConfig, devices } from "@playwright/test";

const CONFIGURATION_ERROR = "Public deployment acceptance configuration is invalid.";

function loadPublicUrl(environment: Readonly<NodeJS.ProcessEnv>): string {
  try {
    if (environment.RUN_PUBLIC_REPLAY_ACCEPTANCE !== "1") throw new Error("opt-in");
    const configuredUrl = environment.LINEAGEGUARD_PUBLIC_URL;
    if (configuredUrl === undefined) throw new Error("url");
    const url = new URL(configuredUrl);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".onrender.com") ||
      url.hostname.length <= ".onrender.com".length ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== "" ||
      (configuredUrl !== url.origin && configuredUrl !== `${url.origin}/`)
    ) {
      throw new Error("url");
    }
    return url.origin;
  } catch {
    throw new Error(CONFIGURATION_ERROR);
  }
}

const baseURL = loadPublicUrl(process.env);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "public-replay-remote.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  globalTimeout: 150_000,
  reporter: [["list"]],
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
