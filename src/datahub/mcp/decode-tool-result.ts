import type { CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";

export function decodeJsonToolResult(result: CallToolResult): unknown {
  if (result.isError) {
    throw new Error("DataHub MCP tool returned an error result.");
  }
  if (result.structuredContent) return result.structuredContent;

  const text = result.content
    .filter((item): item is TextContent => item.type === "text")
    .map((item) => item.text)
    .join("\n");

  if (!text) {
    throw new Error("DataHub MCP tool returned no JSON content.");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("DataHub MCP tool returned invalid JSON content.");
  }
}
