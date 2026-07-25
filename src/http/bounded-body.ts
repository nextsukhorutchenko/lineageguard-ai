export const MAX_RUN_REQUEST_BYTES = 8_192;

const invalidBody = (): Error => new Error("Request body is invalid.");

function validateContentLength(request: Request, maximumBytes: number): void {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) throw invalidBody();
  const contentLength = request.headers.get("Content-Length");
  if (contentLength === null) return;
  if (!/^(0|[1-9]\d*)$/u.test(contentLength)) throw invalidBody();
  const parsed = Number(contentLength);
  if (!Number.isSafeInteger(parsed) || parsed > maximumBytes) throw invalidBody();
}

export async function readBoundedUtf8Body(request: Request, maximumBytes: number): Promise<string> {
  if (request.body === null) {
    validateContentLength(request, maximumBytes);
    return "";
  }

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    reader = request.body.getReader();
    validateContentLength(request, maximumBytes);
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength > maximumBytes - totalBytes) {
        throw invalidBody();
      }
      totalBytes += value.byteLength;
      chunks.push(value);
    }

    const joined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(joined);
  } catch {
    if (reader !== undefined) {
      try {
        await reader.cancel();
      } catch {
        // The fixed primary boundary error remains authoritative.
      }
    }
    throw invalidBody();
  } finally {
    reader?.releaseLock();
  }
}

export async function assertEmptyRequestBody(request: Request): Promise<void> {
  await readBoundedUtf8Body(request, 0);
}
