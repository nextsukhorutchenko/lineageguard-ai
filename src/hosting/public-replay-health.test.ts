import { expect, it, vi } from "vitest";
import type { WebConfig } from "../config/web-config.js";
import { createPublicReplayHealthHandler } from "./public-replay-health.js";

const trustedRoot = "D:/lineageguard/runs";

const publicReplayConfig: WebConfig = {
  mode: "REPLAY",
  runsRoot: trustedRoot,
  deploymentProfile: "PUBLIC_REPLAY",
};

const localReplayConfig: WebConfig = {
  mode: "REPLAY",
  runsRoot: trustedRoot,
  deploymentProfile: "LOCAL",
};

it("reports only the fixed healthy public replay payload after the trusted-root check", async () => {
  const assertRunsRoot = vi.fn(async (root: string) => root);
  const response = await createPublicReplayHealthHandler({
    loadConfig: () => publicReplayConfig,
    assertRunsRoot,
  })();

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok", mode: "PUBLIC_REPLAY" });
  expect(assertRunsRoot).toHaveBeenCalledWith(trustedRoot);
});

it("returns the fixed unavailable payload without inspecting a local profile root", async () => {
  const assertRunsRoot = vi.fn();
  const response = await createPublicReplayHealthHandler({
    loadConfig: () => localReplayConfig,
    assertRunsRoot,
  })();

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: "unavailable" });
  expect(assertRunsRoot).not.toHaveBeenCalled();
});

it("redacts an invalid configuration failure from the unavailable health response", async () => {
  const response = await createPublicReplayHealthHandler({
    loadConfig: () => {
      throw new Error("INJECTED_ENVIRONMENT_KEY");
    },
  })();
  const body = await response.text();

  expect(response.status).toBe(503);
  expect(body).toBe('{"status":"unavailable"}');
  expect(body).not.toContain("INJECTED_");
  expect(body).not.toContain("private");
});

it("redacts an unsafe root failure from the unavailable health response", async () => {
  const response = await createPublicReplayHealthHandler({
    loadConfig: () => publicReplayConfig,
    assertRunsRoot: async () => {
      throw new Error("D:/private/INJECTED_ROOT");
    },
  })();
  const body = await response.text();

  expect(response.status).toBe(503);
  expect(body).toBe('{"status":"unavailable"}');
  expect(body).not.toContain("INJECTED_");
  expect(body).not.toContain("private");
});
