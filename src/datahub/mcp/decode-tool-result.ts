import type { CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";
import { assertMcpToolResultWithinBudget } from "./mcp-tool-result-budget.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function decodeJsonToolResult(result: CallToolResult): unknown {
  assertMcpToolResultWithinBudget(result);

  if (result.isError) {
    throw new Error("DataHub MCP tool returned an error result.");
  }
  if (result.structuredContent) {
    const fastMcp = isRecord(result._meta) ? result._meta.fastmcp : undefined;
    if (
      isRecord(fastMcp) &&
      fastMcp.wrap_result === true &&
      isRecord(result.structuredContent) &&
      Object.keys(result.structuredContent).length === 1 &&
      Object.hasOwn(result.structuredContent, "result")
    ) {
      return result.structuredContent.result;
    }
    return result.structuredContent;
  }

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
