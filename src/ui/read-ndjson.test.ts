import { expect, it } from "vitest";
import type { WorkflowEvent } from "../workflow/contracts.js";
import { readNdjson } from "./read-ndjson.js";

const events = [
  {
    type: "activity",
    entry: {
      at: "2026-07-22T12:00:00.000Z",
      status: "DRAFT",
      label: "Request accepted.",
      outcome: "started",
    },
  },
  {
    type: "activity",
    entry: {
      at: "2026-07-22T12:00:01.000Z",
      status: "RESOLVING_CONTEXT",
      label: "Resolving context.",
      outcome: "succeeded",
      durationMs: 1,
    },
  },
] satisfies readonly WorkflowEvent[];

const responseFromChunks = (chunks: readonly string[]): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
  );

it("decodes validated workflow events when a JSON line spans chunks", async () => {
  const ndjson = `${JSON.stringify(events[0])}\n${JSON.stringify(events[1])}\n`;
  const split = ndjson.indexOf("Request") + 3;
  const received: WorkflowEvent[] = [];

  await readNdjson(responseFromChunks([ndjson.slice(0, split), ndjson.slice(split)]), (event) =>
    received.push(event),
  );

  expect(received).toEqual(events);
});

it("rejects malformed JSON", async () => {
  await expect(readNdjson(responseFromChunks(["{not-json}\n"]), () => {})).rejects.toThrow();
});

it("rejects unknown workflow event shapes", async () => {
  await expect(
    readNdjson(responseFromChunks([`${JSON.stringify({ type: "trace", secret: "no" })}\n`]), () => {
      throw new Error("The callback must not run.");
    }),
  ).rejects.toThrow();
});
