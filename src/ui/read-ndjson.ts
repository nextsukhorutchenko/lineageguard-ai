import { WorkflowEventSchema, type WorkflowEvent } from "../workflow/contracts.js";

export const encodeWorkflowEvent = (event: WorkflowEvent): Uint8Array =>
  new TextEncoder().encode(`${JSON.stringify(WorkflowEventSchema.parse(event))}\n`);

export async function readNdjson(
  response: Response,
  onEvent: (event: WorkflowEvent) => void,
): Promise<void> {
  if (!response.ok || response.body === null) throw new Error("Workflow stream is unavailable.");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += value ?? "";
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim().length > 0) onEvent(WorkflowEventSchema.parse(JSON.parse(line)));
    }
    if (done) break;
  }
  if (buffer.trim().length > 0) onEvent(WorkflowEventSchema.parse(JSON.parse(buffer)));
}
