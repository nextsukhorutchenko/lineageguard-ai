import { expect, it } from "vitest";
import { CLIENT_MAX_VIRTUAL_ARTIFACT_BYTES } from "../../src/ui/artifact-limits.js";
import { MAX_VIRTUAL_ARTIFACT_BYTES } from "../../src/runs/run-envelope.js";

it("uses the same artifact byte ceiling in the browser and server contracts", () => {
  expect(CLIENT_MAX_VIRTUAL_ARTIFACT_BYTES).toBe(MAX_VIRTUAL_ARTIFACT_BYTES);
});
