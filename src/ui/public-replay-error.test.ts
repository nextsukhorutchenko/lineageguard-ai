import { expect, it, vi } from "vitest";
import { readArtifact, readPublicReplayFailureMessage } from "./demo-client.js";

const FALLBACK = "The workflow stream ended unexpectedly.";

function jsonError(body: unknown, status = 503): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

it.each([
  ["DEMO_BUSY", "Public replay is busy. Try again shortly."],
  [
    "DEMO_CAPACITY_REACHED",
    "Public replay capacity was reached. Try again after the service restarts.",
  ],
] as const)(
  "maps %s to fixed browser copy instead of trusting the response message",
  async (code, expected) => {
    await expect(
      readPublicReplayFailureMessage(
        jsonError({
          error: {
            code,
            message: "UNTRUSTED_RESPONSE_MESSAGE",
          },
        }),
      ),
    ).resolves.toBe(expected);
  },
);

it.each([
  ["malformed JSON", "{not-json", "application/json"],
  [
    "an unknown public error",
    JSON.stringify({ error: { code: "UNKNOWN", message: "untrusted" } }),
    "application/json",
  ],
  [
    "a schema-known but unmapped error",
    JSON.stringify({ error: { code: "RUN_EXPIRED", message: "untrusted" } }),
    "application/json",
  ],
  [
    "an error with extra properties",
    JSON.stringify({
      error: { code: "DEMO_BUSY", message: "untrusted", detail: "must be rejected" },
    }),
    "application/json",
  ],
  [
    "the wrong content type",
    JSON.stringify({ error: { code: "DEMO_BUSY", message: "untrusted" } }),
    "text/plain",
  ],
] as const)("keeps the fixed workflow fallback for %s", async (_name, body, contentType) => {
  const response = new Response(body, {
    status: 503,
    headers: { "content-type": contentType },
  });

  await expect(readPublicReplayFailureMessage(response)).resolves.toBe(FALLBACK);
});

it("rejects a response body above 1,024 bytes without committing its text", async () => {
  const cancelled = vi.fn();
  const untrustedText = "UNTRUSTED_OVERSIZED_RESPONSE";
  let supplied = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (supplied) return;
        supplied = true;
        controller.enqueue(
          new TextEncoder().encode(
            JSON.stringify({
              error: {
                code: "DEMO_BUSY",
                message: `${untrustedText}${"x".repeat(1_024)}`,
              },
            }),
          ),
        );
      },
      cancel: cancelled,
    }),
    {
      status: 503,
      headers: { "content-type": "application/json" },
    },
  );

  const message = await readPublicReplayFailureMessage(response);

  expect(message).toBe(FALLBACK);
  expect(message).not.toContain(untrustedText);
  expect(cancelled).toHaveBeenCalledOnce();
  expect(response.body?.locked).toBe(false);
});

it("maps an expired public artifact to the rerun recovery instruction", async () => {
  const response = new Response("UNTRUSTED_EXPIRED_ARTIFACT", { status: 404 });

  await expect(readArtifact(response, "migration-up.sql", "PUBLIC_REPLAY")).rejects.toThrow(
    "Run expired; analyze again.",
  );
});

it("keeps the local artifact preview failure copy for a missing artifact", async () => {
  const response = new Response("UNTRUSTED_EXPIRED_ARTIFACT", { status: 404 });

  await expect(readArtifact(response, "migration-up.sql", "LOCAL")).rejects.toThrow(
    "Artifact preview is unavailable.",
  );
});
