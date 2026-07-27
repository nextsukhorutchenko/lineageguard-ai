import { defineConfig, devices } from "@playwright/test";

const CONFIGURATION_ERROR = "Public deployment acceptance configuration is invalid.";

function loadPublicUrl(environment: Readonly<NodeJS.ProcessEnv>): string {
  try {
    if (environment.RUN_PUBLIC_REPLAY_ACCEPTANCE !== "1") throw new Error("opt-in");
    const configuredUrl = environment.LINEAGEGUARD_PUBLIC_URL;
    if (configuredUrl === undefined) throw new Error("url");
    const url = new URL(configuredUrl);
    const hostnameLabels = url.hostname.split(".");
    const serviceLabel = hostnameLabels[0] ?? "";
    const validServiceLabel =
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(serviceLabel) &&
      !serviceLabel.startsWith("xn--");
    if (
      url.protocol !== "https:" ||
      hostnameLabels.length !== 3 ||
      hostnameLabels[1] !== "onrender" ||
      hostnameLabels[2] !== "com" ||
      !validServiceLabel ||
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
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
