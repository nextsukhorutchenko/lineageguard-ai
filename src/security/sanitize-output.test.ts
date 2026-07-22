import { describe, expect, it } from "vitest";
import {
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
