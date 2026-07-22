import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "./runtime-config.js";

const minimumEnvironment = {
  DATAHUB_GMS_URL: "http://localhost:8080",
  DATAHUB_GMS_TOKEN: "local-test-token",
};

describe("loadRuntimeConfig", () => {
  it("requires the DataHub GMS URL", () => {
    expect(() => loadRuntimeConfig({ DATAHUB_GMS_TOKEN: "local-test-token" })).toThrow();
  });

  it("requires the DataHub GMS token", () => {
    expect(() => loadRuntimeConfig({ DATAHUB_GMS_URL: "http://localhost:8080" })).toThrow();
  });

  it("applies the pinned runtime defaults", () => {
    expect(loadRuntimeConfig(minimumEnvironment)).toMatchObject({
      uvxPath: "uvx",
      runsRoot: "runs",
      maxHops: 2,
    });
  });

  it("accepts explicit executable and runs-directory settings", () => {
    expect(
      loadRuntimeConfig({
        ...minimumEnvironment,
        DATAHUB_MCP_UVX_PATH: "C:\\tools\\uvx.exe",
        LINEAGEGUARD_RUNS_DIR: "private-runs",
      }),
    ).toMatchObject({ uvxPath: "C:\\tools\\uvx.exe", runsRoot: "private-runs" });
  });

  it("does not print the raw token through standard object serializers", () => {
    const config = loadRuntimeConfig(minimumEnvironment);

    expect(JSON.stringify(config)).not.toContain("local-test-token");
    expect(inspect(config)).not.toContain("local-test-token");
    expect(String(config)).not.toContain("local-test-token");
  });
});
