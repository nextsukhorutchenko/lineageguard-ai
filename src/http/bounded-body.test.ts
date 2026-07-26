import { describe, expect, it, vi } from "vitest";
import {
  MAX_RUN_REQUEST_BYTES,
  assertEmptyRequestBody,
  readBoundedUtf8Body,
} from "./bounded-body.js";

interface StreamOptions {
  readonly cancel?: () => void;
  readonly contentLength?: string;
}

function byteRequest(chunks: readonly Uint8Array[], options: StreamOptions = {}): Request {
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[offset];
      if (chunk === undefined) {
        controller.close();
        return;
      }
      offset += 1;
      controller.enqueue(chunk);
    },
    ...(options.cancel === undefined ? {} : { cancel: options.cancel }),
  });
  const headers = new Headers();
  if (options.contentLength !== undefined) headers.set("Content-Length", options.contentLength);
  return new Request("http://localhost/api/runs", {
    method: "POST",
    body,
    headers,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function streamedRequest(chunks: readonly string[], options: StreamOptions = {}): Request {
  const encoder = new TextEncoder();
  return byteRequest(
    chunks.map((chunk) => encoder.encode(chunk)),
    options,
  );
}

describe("readBoundedUtf8Body", () => {
  it("accepts exactly 8192 streamed bytes and releases the reader", async () => {
    const body = "x".repeat(MAX_RUN_REQUEST_BYTES);
    const request = streamedRequest([body.slice(0, 4_000), body.slice(4_000)]);

    await expect(readBoundedUtf8Body(request, MAX_RUN_REQUEST_BYTES)).resolves.toBe(body);
    expect(request.body?.locked).toBe(false);
  });

  it("rejects byte 8193, cancels the stream, and exposes no body text", async () => {
    const cancelled = vi.fn();
    const sentinel = "ACTIVE_SECRET_SENTINEL";
    const request = streamedRequest(["x".repeat(MAX_RUN_REQUEST_BYTES), sentinel], {
      cancel: cancelled,
    });

    const error = await readBoundedUtf8Body(request, MAX_RUN_REQUEST_BYTES).catch(
      (caught: unknown) => caught,
    );
    expect(error).toEqual(new Error("Request body is invalid."));
    expect(String(error)).not.toContain(sentinel);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(request.body?.locked).toBe(false);
  });

  it("rejects an understated content length from the streamed byte count", async () => {
    const request = streamedRequest(["x".repeat(MAX_RUN_REQUEST_BYTES + 1)], {
      contentLength: "1",
    });
    await expect(readBoundedUtf8Body(request, MAX_RUN_REQUEST_BYTES)).rejects.toThrow(
      "Request body is invalid.",
    );
  });

  it("rejects malformed, negative, and over-limit content lengths before reading", async () => {
    for (const value of ["invalid", "-1", String(MAX_RUN_REQUEST_BYTES + 1)]) {
      const cancelled = vi.fn();
      const request = streamedRequest(["must-not-be-read"], {
        contentLength: value,
        cancel: cancelled,
      });
      await expect(readBoundedUtf8Body(request, MAX_RUN_REQUEST_BYTES)).rejects.toThrow(
        "Request body is invalid.",
      );
      expect(cancelled).toHaveBeenCalledOnce();
      expect(request.body?.locked).toBe(false);
    }
  });

  it("decodes a split multibyte UTF-8 sequence and rejects malformed UTF-8", async () => {
    const encoded = new TextEncoder().encode("rename café");
    await expect(
      readBoundedUtf8Body(byteRequest([encoded.slice(0, 9), encoded.slice(9)]), 8_192),
    ).resolves.toBe("rename café");
    await expect(readBoundedUtf8Body(byteRequest([Uint8Array.of(0xc3)]), 8_192)).rejects.toThrow(
      "Request body is invalid.",
    );
  });

  it("maps pre-locked request streams to the fixed body error", async () => {
    const request = streamedRequest(["{}"]);
    const heldReader = request.body!.getReader();
    try {
      await expect(readBoundedUtf8Body(request, MAX_RUN_REQUEST_BYTES)).rejects.toEqual(
        new Error("Request body is invalid."),
      );
    } finally {
      heldReader.releaseLock();
    }
  });
});

describe("assertEmptyRequestBody", () => {
  it("accepts zero bytes and rejects the first byte without reading the remainder", async () => {
    await expect(assertEmptyRequestBody(streamedRequest([]))).resolves.toBeUndefined();
    await expect(assertEmptyRequestBody(streamedRequest([" "]))).rejects.toThrow(
      "Request body is invalid.",
    );
  });
});
