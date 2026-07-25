import { expect, it } from "vitest";
import { createRunId } from "./create-run-id.js";

it("uses compact UTC time and exactly four cryptographic random bytes", () => {
  expect(createRunId(new Date("2026-07-22T12:34:56.789Z"))).toMatch(
    /^20260722T123456Z-[0-9a-f]{8}$/,
  );
});

it("generates distinct IDs for the same timestamp", () => {
  const now = new Date("2026-07-22T12:34:56.789Z");
  expect(createRunId(now)).not.toBe(createRunId(now));
});
