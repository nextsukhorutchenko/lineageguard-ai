import { resolve } from "node:path";
import { expect, it } from "vitest";
import { loadWebConfig } from "./web-config.js";

const runsRoot = resolve("test-runs");

it("loads replay without DataHub or OpenAI secrets", () => {
  expect(
    loadWebConfig({ LINEAGEGUARD_DEMO_MODE: "REPLAY", LINEAGEGUARD_RUNS_DIR: runsRoot }),
  ).toMatchObject({
    mode: "REPLAY",
    runsRoot,
  });
});

it("defaults the deployment profile to LOCAL", () => {
  expect(
    loadWebConfig({
      LINEAGEGUARD_DEMO_MODE: "REPLAY",
      LINEAGEGUARD_RUNS_DIR: runsRoot,
    }),
  ).toEqual({
    mode: "REPLAY",
    runsRoot,
    deploymentProfile: "LOCAL",
  });
});

it("accepts a credential-free PUBLIC_REPLAY profile", () => {
  expect(
    loadWebConfig({
      LINEAGEGUARD_DEMO_MODE: "REPLAY",
      LINEAGEGUARD_DEPLOYMENT_PROFILE: "PUBLIC_REPLAY",
      LINEAGEGUARD_RUNS_DIR: runsRoot,
    }),
  ).toEqual({
    mode: "REPLAY",
    runsRoot,
    deploymentProfile: "PUBLIC_REPLAY",
  });
});

it.each([
  { LINEAGEGUARD_DEMO_MODE: "LIVE" },
  { LINEAGEGUARD_DEMO_MODE: "REPLAY", OPENAI_API_KEY: "forbidden" },
  { LINEAGEGUARD_DEMO_MODE: "REPLAY", DATAHUB_GMS_TOKEN: "forbidden" },
])("rejects unsafe PUBLIC_REPLAY configuration %#", (unsafe) => {
  expect(() =>
    loadWebConfig({
      LINEAGEGUARD_DEPLOYMENT_PROFILE: "PUBLIC_REPLAY",
      LINEAGEGUARD_RUNS_DIR: runsRoot,
      ...unsafe,
    }),
  ).toThrow("Demo service configuration is invalid.");
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

const completeLiveEnvironment = {
  LINEAGEGUARD_DEMO_MODE: "LIVE",
  LINEAGEGUARD_RUNS_DIR: resolve("test-runs"),
  OPENAI_API_KEY: "test-openai-key",
  OPENAI_MODEL: "gpt-5.6-terra",
  DATAHUB_GMS_URL: "http://localhost:8080",
  DATAHUB_GMS_TOKEN: "test-datahub-token",
};

it("requires an explicit absolute uvx executable path in live mode", () => {
  expect(() => loadWebConfig(completeLiveEnvironment)).toThrow(
    "Live demo configuration is incomplete.",
  );
  expect(() => loadWebConfig({ ...completeLiveEnvironment, DATAHUB_MCP_UVX_PATH: "uvx" })).toThrow(
    "Live demo configuration is incomplete.",
  );
});

it("loads live mode with an absolute uvx executable path", () => {
  const uvxPath = resolve("test-uvx");
  expect(
    loadWebConfig({ ...completeLiveEnvironment, DATAHUB_MCP_UVX_PATH: uvxPath }),
  ).toMatchObject({
    mode: "LIVE",
    openaiModel: "gpt-5.6-terra",
    uvxPath,
  });
});
