import { resolve } from "node:path";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "./runtime-config.js";

const minimumEnvironment = {
  DATAHUB_GMS_URL: "http://localhost:8080",
  DATAHUB_GMS_TOKEN: "local-test-token",
};
const absoluteEnvironment = {
  ...minimumEnvironment,
  DATAHUB_MCP_UVX_PATH: resolve("test-uvx"),
  LINEAGEGUARD_RUNS_DIR: resolve("test-runs"),
};

describe("loadRuntimeConfig", () => {
  it("requires the DataHub GMS URL", () => {
    expect(() =>
      loadRuntimeConfig({
        DATAHUB_GMS_TOKEN: "local-test-token",
        LINEAGEGUARD_RUNS_DIR: absoluteEnvironment.LINEAGEGUARD_RUNS_DIR,
      }),
    ).toThrow();
  });

  it("requires the DataHub GMS token", () => {
    expect(() =>
      loadRuntimeConfig({
        DATAHUB_GMS_URL: "http://localhost:8080",
        LINEAGEGUARD_RUNS_DIR: absoluteEnvironment.LINEAGEGUARD_RUNS_DIR,
      }),
    ).toThrow();
  });

  it("requires an explicit runs root", () => {
    expect(() => loadRuntimeConfig(minimumEnvironment)).toThrowError(
      expect.objectContaining({ code: "ARTIFACT_WRITE_FAILED" }),
    );
  });

  it("rejects a relative runs root", () => {
    expect(() =>
      loadRuntimeConfig({ ...minimumEnvironment, LINEAGEGUARD_RUNS_DIR: "relative-runs" }),
    ).toThrowError(expect.objectContaining({ code: "ARTIFACT_WRITE_FAILED" }));
  });

  it("requires an explicit absolute uvx executable path", () => {
    expect(() =>
      loadRuntimeConfig({
        ...minimumEnvironment,
        LINEAGEGUARD_RUNS_DIR: absoluteEnvironment.LINEAGEGUARD_RUNS_DIR,
      }),
    ).toThrow();
    expect(() =>
      loadRuntimeConfig({
        ...minimumEnvironment,
        DATAHUB_MCP_UVX_PATH: "uvx",
        LINEAGEGUARD_RUNS_DIR: absoluteEnvironment.LINEAGEGUARD_RUNS_DIR,
      }),
    ).toThrow();
  });

  it("loads the explicit pinned runtime settings", () => {
    expect(loadRuntimeConfig(absoluteEnvironment)).toMatchObject({
      uvxPath: absoluteEnvironment.DATAHUB_MCP_UVX_PATH,
      runsRoot: absoluteEnvironment.LINEAGEGUARD_RUNS_DIR,
      maxHops: 2,
    });
  });

  it("accepts explicit executable and runs-directory settings", () => {
    expect(
      loadRuntimeConfig({
        ...minimumEnvironment,
        DATAHUB_MCP_UVX_PATH: "C:\\tools\\uvx.exe",
        LINEAGEGUARD_RUNS_DIR: resolve("private-runs"),
      }),
    ).toMatchObject({ uvxPath: "C:\\tools\\uvx.exe", runsRoot: resolve("private-runs") });
  });

  it("lets an absolute CLI override win over the environment", () => {
    const override = resolve("override-runs");
    expect(
      loadRuntimeConfig(
        {
          ...minimumEnvironment,
          DATAHUB_MCP_UVX_PATH: resolve("test-uvx"),
          LINEAGEGUARD_RUNS_DIR: resolve("environment-runs"),
        },
        override,
      ).runsRoot,
    ).toBe(override);
  });

  it("does not print the raw token through standard object serializers", () => {
    const config = loadRuntimeConfig(absoluteEnvironment);

    expect(JSON.stringify(config)).not.toContain("local-test-token");
    expect(inspect(config)).not.toContain("local-test-token");
    expect(String(config)).not.toContain("local-test-token");
  });
});
