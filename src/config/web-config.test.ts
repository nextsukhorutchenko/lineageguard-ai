import { resolve } from "node:path";
import { expect, it } from "vitest";
import { loadWebConfig } from "./web-config.js";

it("loads replay without DataHub or OpenAI secrets", () => {
  const runsRoot = resolve("test-runs");
  expect(
    loadWebConfig({ LINEAGEGUARD_DEMO_MODE: "REPLAY", LINEAGEGUARD_RUNS_DIR: runsRoot }),
  ).toMatchObject({
    mode: "REPLAY",
    runsRoot,
  });
});

it.each([
  ["missing", { LINEAGEGUARD_DEMO_MODE: "REPLAY" }],
  ["relative", { LINEAGEGUARD_DEMO_MODE: "REPLAY", LINEAGEGUARD_RUNS_DIR: "relative-runs" }],
])("rejects a %s runs root", (_name, environment) => {
  expect(() => loadWebConfig(environment)).toThrow("Demo service configuration is invalid.");
});

it("requires OpenAI and DataHub configuration for live mode without echoing values", () => {
  expect(() =>
    loadWebConfig({
      LINEAGEGUARD_DEMO_MODE: "LIVE",
      LINEAGEGUARD_RUNS_DIR: resolve("test-runs"),
      OPENAI_API_KEY: "sk-secret",
    }),
  ).toThrow("Live demo configuration is incomplete.");
});
