import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { decodeJsonToolResult } from "./decode-tool-result.js";

describe("decodeJsonToolResult", () => {
  it("prefers structured content", () => {
    const result: CallToolResult = {
      content: [{ type: "text", text: '{"source":"text"}' }],
      structuredContent: { source: "structured" },
    };

    expect(decodeJsonToolResult(result)).toEqual({ source: "structured" });
  });

  it("decodes a single JSON text block", () => {
    const result: CallToolResult = {
      content: [{ type: "text", text: '{"searchResults":[]}' }],
    };

    expect(decodeJsonToolResult(result)).toEqual({ searchResults: [] });
  });

  it("rejects an MCP error result without exposing its payload", () => {
    const result: CallToolResult = {
      content: [{ type: "text", text: "secret raw dependency failure" }],
      isError: true,
    };

    expect(() => decodeJsonToolResult(result)).toThrow(
      "DataHub MCP tool returned an error result.",
    );
    expect(() => decodeJsonToolResult(result)).not.toThrow("secret raw dependency failure");
  });

  it("rejects invalid non-JSON content without exposing it", () => {
    const result: CallToolResult = {
      content: [{ type: "text", text: "secret-not-json" }],
    };

    expect(() => decodeJsonToolResult(result)).toThrow(
      "DataHub MCP tool returned invalid JSON content.",
    );
    expect(() => decodeJsonToolResult(result)).not.toThrow("secret-not-json");
  });

  it("rejects a response without JSON content", () => {
    const result: CallToolResult = { content: [] };

    expect(() => decodeJsonToolResult(result)).toThrow(
      "DataHub MCP tool returned no JSON content.",
    );
  });
});
