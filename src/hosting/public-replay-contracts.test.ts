import { expect, it } from "vitest";
import {
  PUBLIC_REPLAY_REQUEST,
  PublicReplayErrorCodeSchema,
  PublicReplayErrorSchema,
} from "./public-replay-contracts.js";

it("defines the exact certified public replay request", () => {
  expect(PUBLIC_REPLAY_REQUEST).toBe(
    "Rename column customer_id to customer_key in dataset snowflake:b2fd91.order_entry_db.analytics.order_details",
  );
});

it("allowlists only the public replay error codes", () => {
  expect(PublicReplayErrorCodeSchema.options).toEqual([
    "DEMO_BUSY",
    "DEMO_CAPACITY_REACHED",
    "RUN_EXPIRED",
  ]);
  expect(PublicReplayErrorCodeSchema.safeParse("INVALID_REQUEST").success).toBe(false);
});

it("strictly parses public replay error envelopes", () => {
  expect(
    PublicReplayErrorSchema.safeParse({
      error: { code: "DEMO_BUSY", message: "The public replay is busy." },
    }).success,
  ).toBe(true);
  expect(
    PublicReplayErrorSchema.safeParse({
      error: { code: "DEMO_BUSY", message: "The public replay is busy.", detail: "unsafe" },
    }).success,
  ).toBe(false);
  expect(
    PublicReplayErrorSchema.safeParse({
      error: { code: "DEMO_BUSY", message: "The public replay is busy." },
      detail: "unsafe",
    }).success,
  ).toBe(false);
});

it("bounds public replay error messages to 160 characters", () => {
  expect(
    PublicReplayErrorSchema.safeParse({
      error: { code: "RUN_EXPIRED", message: "x".repeat(160) },
    }).success,
  ).toBe(true);
  expect(
    PublicReplayErrorSchema.safeParse({
      error: { code: "RUN_EXPIRED", message: "x".repeat(161) },
    }).success,
  ).toBe(false);
  expect(
    PublicReplayErrorSchema.safeParse({
      error: { code: "RUN_EXPIRED", message: "" },
    }).success,
  ).toBe(false);
});
