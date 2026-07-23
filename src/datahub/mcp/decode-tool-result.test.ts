import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import { decodeJsonToolResult } from "./decode-tool-result.js";
import { DATAHUB_MCP_BOUNDARY_POLICY } from "./mcp-boundary-policy.js";

const accountedFixtureBytes = (result: CallToolResult): number => {
  const textBlocks = result.content.filter(({ type }) => type === "text").length;
  return Buffer.byteLength(JSON.stringify(result), "utf8") + Math.max(0, textBlocks - 1);
};

function oneTextResultAtBytes(bytes: number): CallToolResult {
  const empty: CallToolResult = {
    content: [{ type: "text", text: '""' }],
  };
  const fillerLength = bytes - accountedFixtureBytes(empty);
  if (fillerLength < 0) throw new Error("Requested fixture size is too small.");
  return {
    content: [{ type: "text", text: `"${"x".repeat(fillerLength)}"` }],
  };
}

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

  it("rejects oversized text before application JSON parsing", () => {
    const parse = vi.spyOn(JSON, "parse");
    const result = oneTextResultAtBytes(DATAHUB_MCP_BOUNDARY_POLICY.maxToolResultBytes + 1);

    expect(() => decodeJsonToolResult(result)).toThrow(
      "DataHub MCP tool result exceeded the application boundary.",
    );
    expect(parse).not.toHaveBeenCalled();
  });

  it("rejects oversized ignored text before preferring structured content", () => {
    const result = {
      ...oneTextResultAtBytes(DATAHUB_MCP_BOUNDARY_POLICY.maxToolResultBytes),
      structuredContent: { searchResults: [] },
    } satisfies CallToolResult;

    expect(() => decodeJsonToolResult(result)).toThrow(
      "DataHub MCP tool result exceeded the application boundary.",
    );
  });
});
