import { expect, it } from "vitest";
import { createRequestOwner } from "./request-owner.js";

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

it("lets only the current delayed request commit events and final busy state", async () => {
  const owner = createRequestOwner();
  const first = owner.begin();
  const commits: string[] = [];

  const staleStream = (async () => {
    await delay(20);
    if (owner.isCurrent(first)) commits.push("stale-event");
    await delay(20);
    if (owner.finish(first)) commits.push("stale-finalizer");
  })();

  const second = owner.begin();
  expect(first.controller.signal.aborted).toBe(true);
  expect(owner.isInFlight()).toBe(true);
  const currentStream = (async () => {
    await delay(60);
    if (owner.isCurrent(second)) commits.push("current-event");
    if (owner.finish(second)) commits.push("current-finalizer");
  })();

  await Promise.all([staleStream, currentStream]);

  expect(commits).toEqual(["current-event", "current-finalizer"]);
  expect(owner.isInFlight()).toBe(false);
});

it("provides a synchronous guard before a same-render second activation", () => {
  const owner = createRequestOwner();
  owner.begin();

  expect(owner.isInFlight()).toBe(true);
});
