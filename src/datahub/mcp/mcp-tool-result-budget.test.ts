import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import { DATAHUB_MCP_BOUNDARY_POLICY } from "./mcp-boundary-policy.js";
import { assertMcpToolResultWithinBudget } from "./mcp-tool-result-budget.js";

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

function oneTextResultWithPrefixAtBytes(prefix: string, bytes: number): CallToolResult {
  const empty: CallToolResult = {
    content: [{ type: "text", text: prefix }],
  };
  const fillerLength = bytes - accountedFixtureBytes(empty);
  if (fillerLength < 0) throw new Error("Requested fixture size is too small.");
  return {
    content: [{ type: "text", text: `${prefix}${"x".repeat(fillerLength)}` }],
  };
}

function nestedArrays(count: number): unknown {
  let value: unknown = null;
  for (let index = 0; index < count; index += 1) value = [value];
  return value;
}

describe("assertMcpToolResultWithinBudget", () => {
  it("accepts exactly 1,048,576 accounted bytes and rejects one more", () => {
    const exact = oneTextResultAtBytes(DATAHUB_MCP_BOUNDARY_POLICY.maxToolResultBytes);
    const oversized = oneTextResultAtBytes(DATAHUB_MCP_BOUNDARY_POLICY.maxToolResultBytes + 1);

    expect(accountedFixtureBytes(exact)).toBe(1_048_576);
    expect(() => assertMcpToolResultWithinBudget(exact)).not.toThrow();
    expect(() => assertMcpToolResultWithinBudget(oversized)).toThrow(
      "DataHub MCP tool result exceeded the application boundary.",
    );
  });

  it("accounts for inserted newlines between joined text blocks", () => {
    const empty: CallToolResult = {
      content: [
        { type: "text", text: '{"value":' },
        { type: "text", text: '""}' },
      ],
    };
    const filler = DATAHUB_MCP_BOUNDARY_POLICY.maxToolResultBytes - accountedFixtureBytes(empty);
    const exact: CallToolResult = {
      content: [
        { type: "text", text: '{"value":' },
        { type: "text", text: `"${"x".repeat(filler)}"}` },
      ],
    };
    const oversized: CallToolResult = {
      content: [
        { type: "text", text: '{"value":' },
        { type: "text", text: `"${"x".repeat(filler + 1)}"}` },
      ],
    };

    expect(accountedFixtureBytes(exact)).toBe(1_048_576);
    expect(() => assertMcpToolResultWithinBudget(exact)).not.toThrow();
    expect(() => assertMcpToolResultWithinBudget(oversized)).toThrow(
      "DataHub MCP tool result exceeded the application boundary.",
    );
  });

  it("counts JSON escaping and multibyte Unicode in UTF-8 bytes", () => {
    const prefix = '🙂"\n\\';
    const exact = oneTextResultWithPrefixAtBytes(
      prefix,
      DATAHUB_MCP_BOUNDARY_POLICY.maxToolResultBytes,
    );
    const oversized = oneTextResultWithPrefixAtBytes(
      prefix,
      DATAHUB_MCP_BOUNDARY_POLICY.maxToolResultBytes + 1,
    );

    expect(accountedFixtureBytes(exact)).toBe(1_048_576);
    expect(() => assertMcpToolResultWithinBudget(exact)).not.toThrow();
    expect(() => assertMcpToolResultWithinBudget(oversized)).toThrow(
      "DataHub MCP tool result exceeded the application boundary.",
    );
  });

  it("counts content and structured content even when structured content wins", () => {
    const result = oneTextResultAtBytes(DATAHUB_MCP_BOUNDARY_POLICY.maxToolResultBytes);
    const withStructured = {
      ...result,
      structuredContent: { safe: true },
    } satisfies CallToolResult;

    expect(() => assertMcpToolResultWithinBudget(withStructured)).toThrow(
      "DataHub MCP tool result exceeded the application boundary.",
    );
  });

  it("rejects hostile content descriptors without invoking getters or an own iterator", () => {
    const contentGetter = vi.fn(() => {
      throw new Error("content getter executed");
    });
    const contentGetterResult = Object.defineProperty({}, "content", {
      enumerable: true,
      get: contentGetter,
    }) as CallToolResult;

    expect(() => assertMcpToolResultWithinBudget(contentGetterResult)).toThrow(
      "DataHub MCP tool result exceeded the application boundary.",
    );
    expect(contentGetter).not.toHaveBeenCalled();

    const indexGetter = vi.fn(() => {
      throw new Error("content index getter executed");
    });
    const indexedContent: unknown[] = [];
    Object.defineProperty(indexedContent, "0", { enumerable: true, get: indexGetter });

    expect(() =>
      assertMcpToolResultWithinBudget({ content: indexedContent } as CallToolResult),
    ).toThrow("DataHub MCP tool result exceeded the application boundary.");
    expect(indexGetter).not.toHaveBeenCalled();

    const typeGetter = vi.fn(() => {
      throw new Error("content type getter executed");
    });
    const typedContent = [
      Object.defineProperty({ text: '"safe"' }, "type", { enumerable: true, get: typeGetter }),
    ];

    expect(() =>
      assertMcpToolResultWithinBudget({ content: typedContent } as CallToolResult),
    ).toThrow("DataHub MCP tool result exceeded the application boundary.");
    expect(typeGetter).not.toHaveBeenCalled();

    const iteratorGetter = vi.fn(() => {
      throw new Error("content iterator getter executed");
    });
    const iterableContent = [{ type: "text", text: '"safe"' }];
    Object.defineProperty(iterableContent, Symbol.iterator, { get: iteratorGetter });

    expect(() =>
      assertMcpToolResultWithinBudget({ content: iterableContent } as CallToolResult),
    ).toThrow("DataHub MCP tool result exceeded the application boundary.");
    expect(iteratorGetter).not.toHaveBeenCalled();

    expect(() => assertMcpToolResultWithinBudget({ content: Array(1) } as CallToolResult)).toThrow(
      "DataHub MCP tool result exceeded the application boundary.",
    );
  });

  it("exits on an oversized first key before snapshotting all object keys", () => {
    const structuredContent = {
      ["x".repeat(DATAHUB_MCP_BOUNDARY_POLICY.maxToolResultBytes)]: null,
      later: null,
    };
    const getOwnPropertyNames = vi
      .spyOn(Object, "getOwnPropertyNames")
      .mockImplementation((value) => {
        if (value === structuredContent) throw new Error("eager key snapshot");
        return Reflect.ownKeys(value).filter((key): key is string => typeof key === "string");
      });

    try {
      expect(() =>
        assertMcpToolResultWithinBudget({ content: [], structuredContent } as CallToolResult),
      ).toThrow("DataHub MCP tool result exceeded the application boundary.");
      expect(getOwnPropertyNames.mock.calls.some(([value]) => value === structuredContent)).toBe(
        false,
      );
    } finally {
      getOwnPropertyNames.mockRestore();
    }
  });

  it("rejects oversized ignored content", () => {
    const result = {
      content: [{ type: "image", data: "x".repeat(1_048_576), mimeType: "image/png" }],
      structuredContent: { safe: true },
    } as CallToolResult;

    expect(() => assertMcpToolResultWithinBudget(result)).toThrow(
      "DataHub MCP tool result exceeded the application boundary.",
    );
  });

  it("accepts container depth 64 and rejects depth 65", () => {
    const atLimit = {
      content: [],
      structuredContent: { nested: nestedArrays(62) },
    } as CallToolResult;
    const overLimit = {
      content: [],
      structuredContent: { nested: nestedArrays(63) },
    } as CallToolResult;

    expect(() => assertMcpToolResultWithinBudget(atLimit)).not.toThrow();
    expect(() => assertMcpToolResultWithinBudget(overLimit)).toThrow(
      "DataHub MCP tool result exceeded the application boundary.",
    );
  });

  it("accepts 100,000 visited values and rejects 100,001", () => {
    const atLimit = {
      content: [],
      structuredContent: { values: Array.from({ length: 99_996 }, () => null) },
    } as CallToolResult;
    const overLimit = {
      content: [],
      structuredContent: { values: Array.from({ length: 99_997 }, () => null) },
    } as CallToolResult;

    expect(() => assertMcpToolResultWithinBudget(atLimit)).not.toThrow();
    expect(() => assertMcpToolResultWithinBudget(overLimit)).toThrow(
      "DataHub MCP tool result exceeded the application boundary.",
    );
  });

  it("rejects cycles but accepts repeated acyclic references", () => {
    const shared = { value: "safe" };
    const repeated = {
      content: [],
      structuredContent: { first: shared, second: shared },
    } as CallToolResult;
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => assertMcpToolResultWithinBudget(repeated)).not.toThrow();
    expect(() =>
      assertMcpToolResultWithinBudget({
        content: [],
        structuredContent: cyclic,
      } as CallToolResult),
    ).toThrow("DataHub MCP tool result exceeded the application boundary.");
  });

  it.each([
    ["undefined", undefined],
    ["bigint", 1n],
    ["symbol", Symbol("unsafe")],
    ["function", () => undefined],
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
    ["custom prototype", new Date()],
    ["sparse array", Array(1)],
    [
      "accessor",
      Object.defineProperty({}, "secret", {
        enumerable: true,
        get: () => "unsafe",
      }),
    ],
    [
      "non-enumerable property",
      Object.defineProperty({}, "hidden", {
        enumerable: false,
        value: "unsafe",
      }),
    ],
    [
      "non-enumerable accessor",
      Object.defineProperty({}, "hidden", {
        enumerable: false,
        get: () => "unsafe",
      }),
    ],
    [
      "extra array property",
      Object.defineProperty([], "hidden", {
        enumerable: true,
        value: "unsafe",
      }),
    ],
  ])("rejects non-JSON structured value %s", (_label, value) => {
    const result = {
      content: [],
      structuredContent: { value },
    } as CallToolResult;

    expect(() => assertMcpToolResultWithinBudget(result)).toThrow(
      "DataHub MCP tool result exceeded the application boundary.",
    );
  });
});
