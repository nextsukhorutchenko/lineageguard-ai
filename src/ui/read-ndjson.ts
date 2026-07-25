import { WorkflowEventSchema, type WorkflowEvent } from "../workflow/contracts.js";

export const MAX_NDJSON_EVENT_BYTES = 4_194_304;
export const MAX_NDJSON_RESPONSE_BYTES = 16_777_216;
export const MAX_NDJSON_EVENTS = 128;

export const encodeWorkflowEvent = (event: WorkflowEvent): Uint8Array =>
  new TextEncoder().encode(`${JSON.stringify(WorkflowEventSchema.parse(event))}\n`);

function joinSegments(segments: readonly Uint8Array[], totalBytes: number): Uint8Array {
  const joined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const segment of segments) {
    joined.set(segment, offset);
    offset += segment.byteLength;
  }
  return joined;
}

export async function readNdjson(
  response: Response,
  onEvent: (event: WorkflowEvent) => void,
): Promise<void> {
  if (!response.ok || response.body === null) throw new Error("Workflow stream is unavailable.");
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let responseBytes = 0;
  let lineBytes = 0;
  let eventCount = 0;
  let segments: Uint8Array[] = [];

  const consumeLine = (): void => {
    const line = new TextDecoder("utf-8", { fatal: true }).decode(
      joinSegments(segments, lineBytes),
    );
    segments = [];
    lineBytes = 0;
    if (line.trim().length === 0) return;
    eventCount += 1;
    if (eventCount > MAX_NDJSON_EVENTS) throw new Error("Too many workflow events.");
    const event = WorkflowEventSchema.parse(JSON.parse(line));
    onEvent(event);
  };

  try {
    reader = response.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (
        !(value instanceof Uint8Array) ||
        value.byteLength > MAX_NDJSON_RESPONSE_BYTES - responseBytes
      ) {
        throw new Error("Workflow response is too large.");
      }
      responseBytes += value.byteLength;

      let segmentStart = 0;
      for (let index = 0; index < value.byteLength; index += 1) {
        if (value[index] !== 0x0a) continue;
        const segment = value.subarray(segmentStart, index);
        if (segment.byteLength > MAX_NDJSON_EVENT_BYTES - lineBytes) {
          throw new Error("Workflow event is too large.");
        }
        if (segment.byteLength > 0) segments.push(segment);
        lineBytes += segment.byteLength;
        consumeLine();
        segmentStart = index + 1;
      }

      const trailing = value.subarray(segmentStart);
      if (trailing.byteLength > MAX_NDJSON_EVENT_BYTES - lineBytes) {
        throw new Error("Workflow event is too large.");
      }
      if (trailing.byteLength > 0) segments.push(trailing);
      lineBytes += trailing.byteLength;
    }
    if (lineBytes > 0) consumeLine();
  } catch {
    if (reader !== undefined) {
      try {
        await reader.cancel();
      } catch {
        // The fixed primary stream error remains authoritative.
      }
    }
    throw new Error("Workflow stream is invalid.");
  } finally {
    reader?.releaseLock();
  }
}
