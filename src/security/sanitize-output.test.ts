import { describe, expect, it } from "vitest";
import {
  sanitizeBoundaryText,
  sanitizeMarkdownTableCell,
  sanitizeMarkdownText,
  sanitizeTerminalText,
} from "./sanitize-output.js";

describe("output sanitization", () => {
  it("neutralizes HTML, Markdown links, terminal controls, and Unicode line separators", () => {
    const external = "<b>[x](javascript:1)</b>\u001b\n\u2028";
    const safeMarkdown = "&lt;b&gt;\\[x\\](javascript:1)&lt;/b&gt;\\\\u001B\\\\n\\\\u2028";

    expect(sanitizeMarkdownText(external)).toBe(safeMarkdown);
    expect(sanitizeMarkdownTableCell(external)).toBe(safeMarkdown);
    expect(sanitizeTerminalText(external)).toBe("<b>[x](javascript:1)</b>\\u001B\\n\\u2028");
  });

  it("redacts every known secret literal before formatting an output boundary", () => {
    const external = "before longer-secret and secret after";
    const secrets = ["secret", "longer-secret"];

    expect(sanitizeMarkdownText(external, secrets)).toBe(
      "before \\[REDACTED\\] and \\[REDACTED\\] after",
    );
    expect(sanitizeMarkdownTableCell(external, secrets)).toBe(
      "before \\[REDACTED\\] and \\[REDACTED\\] after",
    );
    expect(sanitizeTerminalText(external, secrets)).toBe("before [REDACTED] and [REDACTED] after");
  });
});

describe("structured boundary sanitization", () => {
  it("redacts known and realistic credential shapes longest-first", () => {
    const value =
      "long-secret secret sk-proj-1234567890abcdefghijkl github_pat_1234567890abcdefghijklmnop Bearer abc.def-123";
    expect(sanitizeBoundaryText(value, ["secret", "long-secret"], 500)).not.toMatch(
      /long-secret|\bsecret\b|sk-proj-|github_pat_|Bearer\s/,
    );
  });

  it("makes controls visible, normalizes NFC, and applies a positive character cap", () => {
    expect(sanitizeBoundaryText("e\u0301\n\u001b[2Jabcdef", [], 8)).toBe("é\\n\\u001");
    expect(sanitizeBoundaryText("abc", [], 0)).toBe("");
  });

  it("redacts private-key blocks without retaining their body", () => {
    const privateKey = "-----BEGIN PRIVATE KEY-----\nsecret-body\n-----END PRIVATE KEY-----";
    expect(sanitizeBoundaryText(privateKey, [], 500)).toBe("[REDACTED]");
  });
});
