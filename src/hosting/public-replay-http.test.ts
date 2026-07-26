import { expect, it } from "vitest";
import {
  publicReplayErrorResponse,
  publicReplayInvalidRequestResponse,
} from "./public-replay-http.js";

it("returns the fixed busy response", async () => {
  const response = publicReplayErrorResponse("DEMO_BUSY");

  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({
    error: {
      code: "DEMO_BUSY",
      message: "Public replay is busy. Try again shortly.",
    },
  });
});

it("returns the fixed capacity response", async () => {
  const response = publicReplayErrorResponse("DEMO_CAPACITY_REACHED");

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: {
      code: "DEMO_CAPACITY_REACHED",
      message: "Public replay capacity was reached. Try again after the service restarts.",
    },
  });
});

it("returns the fixed unsupported-request response", async () => {
  const response = publicReplayInvalidRequestResponse();

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: {
      code: "INVALID_REQUEST",
      message: "Only the certified public replay request is supported.",
    },
  });
});
