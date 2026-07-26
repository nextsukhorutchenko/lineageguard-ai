import { expect, it, vi } from "vitest";
import type { WorkflowEvent } from "../workflow/contracts.js";
import {
  MAX_NDJSON_EVENT_BYTES,
  MAX_NDJSON_EVENTS,
  MAX_NDJSON_RESPONSE_BYTES,
  readNdjson,
} from "./read-ndjson.js";

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
    { headers: { "content-type": "application/x-ndjson; charset=utf-8" } },
  );

const byteResponseFromChunks = (chunks: readonly Uint8Array[], cancel?: () => void): Response => {
  let offset = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[offset];
        if (chunk === undefined) {
          controller.close();
          return;
        }
        offset += 1;
        controller.enqueue(chunk);
      },
      ...(cancel === undefined ? {} : { cancel }),
    }),
    { headers: { "content-type": "application/x-ndjson; charset=utf-8" } },
  );
};

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
  await expect(readNdjson(responseFromChunks(["{not-json}\n"]), () => {})).rejects.toThrow(
    "Workflow stream is invalid.",
  );
});

it("rejects unknown workflow event shapes", async () => {
  await expect(
    readNdjson(responseFromChunks([`${JSON.stringify({ type: "trace", secret: "no" })}\n`]), () => {
      throw new Error("The callback must not run.");
    }),
  ).rejects.toThrow("Workflow stream is invalid.");
});

it("accepts a workflow event line at 4 MiB and rejects one byte more", async () => {
  const json = JSON.stringify(events[0]);
  const exact = `${json}${" ".repeat(MAX_NDJSON_EVENT_BYTES - Buffer.byteLength(json, "utf8"))}\n`;
  await expect(readNdjson(responseFromChunks([exact]), () => {})).resolves.toBeUndefined();
  await expect(readNdjson(responseFromChunks([` ${exact}`]), () => {})).rejects.toThrow(
    "Workflow stream is invalid.",
  );
});

it("accepts exactly 16 MiB total and rejects the next byte", async () => {
  const block = `${" ".repeat(MAX_NDJSON_EVENT_BYTES - 1)}\n`;
  const exact = [block, block, block, block];
  expect(exact.reduce((total, value) => total + Buffer.byteLength(value), 0)).toBe(
    MAX_NDJSON_RESPONSE_BYTES,
  );
  await expect(readNdjson(responseFromChunks(exact), () => {})).resolves.toBeUndefined();
  await expect(readNdjson(responseFromChunks(exact.concat(" ")), () => {})).rejects.toThrow(
    "Workflow stream is invalid.",
  );
});

it("accepts 128 events and rejects event 129", async () => {
  const line = `${JSON.stringify(events[0])}\n`;
  const received: WorkflowEvent[] = [];
  await readNdjson(
    responseFromChunks(Array.from({ length: MAX_NDJSON_EVENTS }, () => line)),
    (event) => received.push(event),
  );
  expect(received).toHaveLength(MAX_NDJSON_EVENTS);
  await expect(
    readNdjson(
      responseFromChunks(Array.from({ length: MAX_NDJSON_EVENTS + 1 }, () => line)),
      () => {},
    ),
  ).rejects.toThrow("Workflow stream is invalid.");
});

it("rejects an oversized unterminated line", async () => {
  await expect(
    readNdjson(responseFromChunks([" ".repeat(MAX_NDJSON_EVENT_BYTES + 1)]), () => {}),
  ).rejects.toThrow("Workflow stream is invalid.");
});

it("decodes a multibyte character split across raw chunks", async () => {
  const firstEvent = events[0];
  if (firstEvent === undefined || firstEvent.type !== "activity") {
    throw new Error("Expected an activity fixture.");
  }
  const event: WorkflowEvent = {
    ...firstEvent,
    entry: { ...firstEvent.entry, label: "Request café accepted." },
  };
  const encoded = new TextEncoder().encode(`${JSON.stringify(event)}\n`);
  const character = new TextEncoder().encode("é");
  const characterOffset = encoded.findIndex(
    (value, index) => value === character[0] && encoded[index + 1] === character[1],
  );
  const received: WorkflowEvent[] = [];

  await readNdjson(
    byteResponseFromChunks([
      encoded.slice(0, characterOffset + 1),
      encoded.slice(characterOffset + 1),
    ]),
    (value) => received.push(value),
  );

  expect(received).toEqual([event]);
});

it("rejects malformed UTF-8 with the fixed stream error", async () => {
  await expect(
    readNdjson(byteResponseFromChunks([Uint8Array.of(0xc3, 0x0a)]), () => {}),
  ).rejects.toEqual(new Error("Workflow stream is invalid."));
});

it("maps callback failures to the fixed stream error and cancels and unlocks the reader", async () => {
  const cancelled = vi.fn();
  const response = byteResponseFromChunks(
    [
      new TextEncoder().encode(`${JSON.stringify(events[0])}\n`),
      new TextEncoder().encode(`${JSON.stringify(events[1])}\n`),
    ],
    cancelled,
  );

  await expect(
    readNdjson(response, () => {
      throw new Error("ACTIVE_SECRET_SENTINEL");
    }),
  ).rejects.toEqual(new Error("Workflow stream is invalid."));
  expect(cancelled).toHaveBeenCalledOnce();
  expect(response.body?.locked).toBe(false);
});

it("maps pre-locked response streams to the fixed stream error", async () => {
  const response = responseFromChunks([`${JSON.stringify(events[0])}\n`]);
  const heldReader = response.body!.getReader();
  try {
    await expect(readNdjson(response, () => {})).rejects.toEqual(
      new Error("Workflow stream is invalid."),
    );
  } finally {
    heldReader.releaseLock();
  }
});

it.each([
  ["non-success status", 503, "application/x-ndjson; charset=utf-8"],
  ["wrong content type", 200, "application/json"],
] as const)(
  "cancels the response body after early rejection for %s",
  async (_name, status, contentType) => {
    const cancelled = vi.fn();
    let supplied = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (supplied) return;
          supplied = true;
          controller.enqueue(new TextEncoder().encode("{bad-json}\n"));
        },
        cancel: cancelled,
      }),
      { status, headers: { "content-type": contentType } },
    );

    await expect(readNdjson(response, () => {})).rejects.toEqual(
      new Error("Workflow stream is unavailable."),
    );
    expect(cancelled).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  },
);

it("releases the reader lock after clean completion", async () => {
  const response = responseFromChunks([`${JSON.stringify(events[0])}\n`]);
  await readNdjson(response, () => {});
  expect(response.body?.locked).toBe(false);
});
